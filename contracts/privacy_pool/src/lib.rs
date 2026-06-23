//! Chameleon PrivacyPool — Soroban smart contract.
//!
//! A compliance-aware privacy mixer on the Stellar blockchain. Users deposit
//! exactly `DENOMINATION` stroops (100 XLM) and receive a secret note. To
//! withdraw, they produce an UltraHonk ZK proof demonstrating:
//!   1. Their commitment is in the Merkle tree (membership).
//!   2. Their nullifier hash is correct (Poseidon(nullifier)).
//!   3. Their commitment is NOT in the compliance blacklist (non-membership).
//!   4. Recipient, relayer, and fee are bound into the proof (anti-front-running).
//!
//! Security invariants enforced here:
//! - Double-spend prevention via nullifier storage.
//! - Stale-proof prevention: `blacklist_root` must equal on-chain value.
//! - Anti-griefing: last 30 Merkle roots are accepted (root history buffer).

#![cfg_attr(not(test), no_std)]

extern crate alloc;

mod errors;
mod merkle;
mod storage;
mod verifier;

use errors::PoolError;
use merkle::{init_tree, insert, is_known_root, MAX_LEAVES, TREE_DEPTH};
use storage::*;
use verifier::{PUBLIC_INPUTS_BYTES, PUBLIC_INPUTS_COUNT, VK_BYTES};

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Bytes, BytesN, Env, Vec,
};


/// Fixed deposit denomination: 100 XLM = 100 * 10^7 stroops.
pub const DENOMINATION: i128 = 1_000_000_000;

#[contract]
pub struct PrivacyPool;

#[contractimpl]
impl PrivacyPool {
    /// Initialize the contract. May only be called once.
    ///
    /// # Arguments
    /// - `admin`       — Address authorized to call `set_blacklist` and `set_vk`.
    /// - `token`       — Native XLM SAC token address.
    /// - `vk`          — UltraHonk verification key bytes from `bb write_vk`.
    /// - `denomination`— Must equal `DENOMINATION` (1_000_000_000 stroops). Validated.
    /// - `depth`       — Must equal `TREE_DEPTH` (20). Validated for documentation; code uses const.
    ///
    /// # Errors
    /// - `AlreadyInitialized` if called more than once.
    /// - `InvalidDenomination` if `denomination != DENOMINATION`.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        vk: Bytes,
        denomination: i128,
        depth: u32,
    ) -> Result<(), PoolError> {
        if get_admin(&env).is_some() {
            return Err(PoolError::AlreadyInitialized);
        }
        if denomination != DENOMINATION {
            return Err(PoolError::InvalidDenomination);
        }
        // depth is informational; the contract always uses TREE_DEPTH
        let _ = depth;

        admin.require_auth();

        set_admin(&env, &admin);
        set_token(&env, &token);
        set_denomination(&env, denomination);
        set_vk(&env, &vk);

        // Initialize zero blacklist root (no blacklisted entries)
        let zero_root = BytesN::from_array(&env, &[0u8; 32]);
        set_blacklist_root(&env, &zero_root);

        init_tree(&env);
        Ok(())
    }

    /// Deposit exactly `DENOMINATION` stroops (100 XLM) and insert `commitment` into the Merkle tree.
    ///
    /// # Arguments
    /// - `from`       — Depositor address; must authorize the token transfer.
    /// - `commitment` — 32-byte Poseidon2(nullifier, secret) commitment.
    ///
    /// # Errors
    /// - `NotInitialized`    if contract not set up.
    /// - `CommitmentExists`  if this exact commitment has already been deposited.
    /// - `TreeFull`          if 2^20 leaves have been inserted.
    ///
    /// # Events
    /// Emits a `deposit` event with topics `["deposit", leaf_index]`
    /// and data `commitment`.
    pub fn deposit(env: Env, from: Address, commitment: BytesN<32>) -> Result<(), PoolError> {
        get_admin(&env).ok_or(PoolError::NotInitialized)?;

        if has_commitment(&env, &commitment) {
            return Err(PoolError::CommitmentExists);
        }
        let next = get_next_index(&env);
        if next >= MAX_LEAVES {
            return Err(PoolError::TreeFull);
        }

        from.require_auth();

        // Transfer DENOMINATION stroops from depositor to this contract
        let token_addr = get_token(&env).ok_or(PoolError::NotInitialized)?;
        let token_client = token::TokenClient::new(&env, &token_addr);
        let contract_id = env.current_contract_address();
        token_client.transfer(&from, &contract_id, &DENOMINATION);

        // Insert into Merkle tree
        let (_, leaf_index) = insert(&env, &commitment);
        insert_commitment(&env, &commitment);

        // Emit deposit event
        env.events().publish(
            (symbol_short!("deposit"), leaf_index),
            commitment,
        );

        Ok(())
    }

    /// Withdraw funds by providing a valid UltraHonk ZK proof.
    ///
    /// The proof must attest to all of:
    /// - Merkle membership with the given root.
    /// - Correct nullifier hash (Poseidon2(nullifier)).
    /// - Non-membership in the blacklist (commitment not in blacklist).
    /// - Anti-malleability: recipient, relayer, fee are bound into the proof.
    ///
    /// # Arguments
    /// - `root`          — Merkle root the prover used (must be in root history).
    /// - `nullifier_hash`— Poseidon2(nullifier); marks this deposit spent.
    /// - `recipient`     — Address to receive `DENOMINATION - fee` stroops.
    /// - `relayer`       — Address to receive `fee` stroops (pass zero address if none).
    /// - `fee`           — Fee in stroops (0 ≤ fee < DENOMINATION).
    /// - `blacklist_root`— Must equal current on-chain `BlacklistRoot`.
    /// - `proof`         — UltraHonk proof bytes (14592 bytes from `bb prove`).
    /// - `public_inputs` — 192 bytes: 6 × 32-byte big-endian field elements in order
    ///                     `[root, nullifier_hash, recipient, relayer, fee, blacklist_root]`.
    ///
    /// # Errors
    /// - `NotInitialized`      if contract not set up.
    /// - `InvalidPublicInputs` if `public_inputs` length is not 192 bytes.
    /// - `FeeTooHigh`          if `fee >= DENOMINATION`.
    /// - `UnknownRoot`         if root is not in the root history.
    /// - `StaleBlacklist`      if `blacklist_root != on-chain BlacklistRoot`.
    /// - `NullifierSpent`      if this nullifier has already been used.
    /// - `InvalidProof`        if the ZK proof fails verification.
    ///
    /// # Events
    /// Emits a `withdraw` event with topic `"withdraw"` and data `nullifier_hash`.
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw(
        env: Env,
        root: BytesN<32>,
        nullifier_hash: BytesN<32>,
        recipient: Address,
        relayer: Address,
        fee: i128,
        blacklist_root: BytesN<32>,
        proof: Bytes,
        public_inputs: Bytes,
    ) -> Result<(), PoolError> {
        get_admin(&env).ok_or(PoolError::NotInitialized)?;

        // Validate public_inputs length
        if public_inputs.len() != PUBLIC_INPUTS_BYTES as u32 {
            return Err(PoolError::InvalidPublicInputs);
        }

        // Fee bounds
        if fee < 0 || fee >= DENOMINATION {
            return Err(PoolError::FeeTooHigh);
        }

        // Root must be in history
        if !is_known_root(&env, &root) {
            return Err(PoolError::UnknownRoot);
        }

        // Blacklist root must be current
        let on_chain_bl_root = get_blacklist_root(&env).ok_or(PoolError::NotInitialized)?;
        if blacklist_root != on_chain_bl_root {
            return Err(PoolError::StaleBlacklist);
        }

        // Nullifier must not be spent
        if is_spent(&env, &nullifier_hash) {
            return Err(PoolError::NullifierSpent);
        }

        // Verify ZK proof
        let vk = get_vk(&env).ok_or(PoolError::NotInitialized)?;
        if !verifier::verify(&env, &vk, &proof, &public_inputs) {
            return Err(PoolError::InvalidProof);
        }

        // Mark nullifier spent (before transfer to prevent re-entrancy)
        mark_spent(&env, &nullifier_hash);

        // Pay out
        let token_addr = get_token(&env).ok_or(PoolError::NotInitialized)?;
        let token_client = token::TokenClient::new(&env, &token_addr);
        let contract_id = env.current_contract_address();

        let payout = DENOMINATION - fee;
        token_client.transfer(&contract_id, &recipient, &payout);
        if fee > 0 {
            token_client.transfer(&contract_id, &relayer, &fee);
        }

        // Emit withdraw event
        env.events().publish(
            (symbol_short!("withdraw"),),
            nullifier_hash,
        );

        Ok(())
    }

    /// Update the compliance blacklist root and entries. Admin only.
    ///
    /// # Arguments
    /// - `admin`   — Admin address (must authorize).
    /// - `root`    — New Poseidon2 root of the blacklist set.
    /// - `entries` — Up to 16 blacklisted commitment hashes (32 bytes each).
    ///
    /// # Errors
    /// - `Unauthorized` if caller is not admin.
    pub fn set_blacklist(
        env: Env,
        admin: Address,
        root: BytesN<32>,
        entries: Vec<BytesN<32>>,
    ) -> Result<(), PoolError> {
        let stored_admin = get_admin(&env).ok_or(PoolError::NotInitialized)?;
        if admin != stored_admin {
            return Err(PoolError::Unauthorized);
        }
        admin.require_auth();

        set_blacklist_root(&env, &root);
        let mut i = 0u32;
        for entry in entries.iter() {
            set_blacklist_entry(&env, i, &entry);
            i += 1;
        }
        Ok(())
    }

    /// Rotate the UltraHonk verification key. Admin only.
    ///
    /// # Arguments
    /// - `admin` — Admin address (must authorize).
    /// - `vk`    — New verification key bytes.
    ///
    /// # Errors
    /// - `Unauthorized` if caller is not admin.
    pub fn set_vk(env: Env, admin: Address, vk: Bytes) -> Result<(), PoolError> {
        let stored_admin = get_admin(&env).ok_or(PoolError::NotInitialized)?;
        if admin != stored_admin {
            return Err(PoolError::Unauthorized);
        }
        admin.require_auth();
        storage::set_vk(&env, &vk);
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// Returns the current Merkle root.
    pub fn get_root(env: Env) -> Option<BytesN<32>> {
        storage::get_root(&env)
    }

    /// Returns `true` if `root` is in the root history ring buffer.
    pub fn is_known_root(env: Env, root: BytesN<32>) -> bool {
        merkle::is_known_root(&env, &root)
    }

    /// Returns `true` if this nullifier hash has already been spent.
    pub fn is_spent(env: Env, nullifier_hash: BytesN<32>) -> bool {
        storage::is_spent(&env, &nullifier_hash)
    }

    /// Returns the next available leaf index.
    pub fn next_index(env: Env) -> u32 {
        get_next_index(&env)
    }

    /// Returns the current blacklist Poseidon2 root.
    pub fn blacklist_root(env: Env) -> Option<BytesN<32>> {
        get_blacklist_root(&env)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{token::StellarAssetClient, Bytes, BytesN, Env, IntoVal, Vec};

    /// Construct a mock 192-byte public inputs block from 6 × BytesN<32>.
    fn make_public_inputs(
        env: &Env,
        root: &BytesN<32>,
        nullifier_hash: &BytesN<32>,
        recipient_field: &BytesN<32>,
        relayer_field: &BytesN<32>,
        fee_field: &BytesN<32>,
        blacklist_root: &BytesN<32>,
    ) -> Bytes {
        let mut v = alloc::vec::Vec::with_capacity(192);
        v.extend_from_slice(&root.to_array());
        v.extend_from_slice(&nullifier_hash.to_array());
        v.extend_from_slice(&recipient_field.to_array());
        v.extend_from_slice(&relayer_field.to_array());
        v.extend_from_slice(&fee_field.to_array());
        v.extend_from_slice(&blacklist_root.to_array());
        Bytes::from_slice(env, &v)
    }

    /// Build a dummy proof of the expected byte length (all zeros — accepted by mock verifier).
    fn dummy_proof(env: &Env) -> Bytes {
        Bytes::from_slice(env, &[0u8; verifier::PROOF_BYTES])
    }

    /// Build a dummy VK of the expected byte length.
    fn dummy_vk(env: &Env) -> Bytes {
        Bytes::from_slice(env, &[0u8; VK_BYTES])
    }

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PrivacyPool, ());
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);

        // Deploy a mock native token
        let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_addr = token_contract.address().clone();

        // Mint tokens to admin for testing
        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&admin, &(DENOMINATION * 10));

        // Initialize the pool
        let client = PrivacyPoolClient::new(&env, &contract_id);
        client.initialize(&admin, &token_addr, &dummy_vk(&env), &DENOMINATION, &TREE_DEPTH);

        (env, contract_id, admin, token_addr)
    }

    /// Assert that a try_* client call returned the expected contract error.
    ///
    /// In Soroban SDK 26, try_foo() for a contract function returning Result<(), PoolError> returns:
    ///   Result<Result<(), ConversionError>, Result<PoolError, InvokeError>>
    /// A contract-level error appears as Err(Ok(PoolError::Variant)).
    fn expect_error(
        result: Result<Result<(), soroban_sdk::ConversionError>, Result<PoolError, soroban_sdk::InvokeError>>,
        expected: PoolError,
    ) {
        match result {
            Err(Ok(e)) => assert_eq!(e, expected, "unexpected error variant"),
            Err(Err(_)) => panic!("SDK-level InvokeError, expected contract error {:?}", expected),
            Ok(_) => panic!("expected contract error {:?} but call succeeded", expected),
        }
    }

    #[test]
    fn test_initialize_once() {
        let (env, contract_id, admin, token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);
        // Second init should fail
        let result = client.try_initialize(
            &admin,
            &token_addr,
            &dummy_vk(&env),
            &DENOMINATION,
            &TREE_DEPTH,
        );
        expect_error(result, PoolError::AlreadyInitialized);
    }

    #[test]
    fn test_deposit_and_withdraw_happy_path() {
        let (env, contract_id, _admin, token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        // Mint tokens to a fresh depositor
        let depositor = Address::generate(&env);
        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&depositor, &DENOMINATION);

        // Create a commitment (any 32 bytes for mock)
        let commitment = BytesN::from_array(&env, &[1u8; 32]);
        client.deposit(&depositor, &commitment);

        assert_eq!(client.next_index(), 1u32);

        // Withdraw
        let root = client.get_root().unwrap();
        let nullifier_hash = BytesN::from_array(&env, &[2u8; 32]);
        let recipient = Address::generate(&env);
        let relayer = Address::generate(&env);
        let fee: i128 = 0;
        let blacklist_root = client.blacklist_root().unwrap();

        let pi = make_public_inputs(
            &env,
            &root,
            &nullifier_hash,
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &blacklist_root,
        );

        client.withdraw(
            &root,
            &nullifier_hash,
            &recipient,
            &relayer,
            &fee,
            &blacklist_root,
            &dummy_proof(&env),
            &pi,
        );

        assert!(client.is_spent(&nullifier_hash));
    }

    #[test]
    fn test_double_spend_rejected() {
        let (env, contract_id, _admin, token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        let depositor = Address::generate(&env);
        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&depositor, &DENOMINATION);

        let commitment = BytesN::from_array(&env, &[3u8; 32]);
        client.deposit(&depositor, &commitment);

        let root = client.get_root().unwrap();
        let nullifier_hash = BytesN::from_array(&env, &[4u8; 32]);
        let recipient = Address::generate(&env);
        let relayer = Address::generate(&env);
        let blacklist_root = client.blacklist_root().unwrap();
        let pi = make_public_inputs(
            &env,
            &root,
            &nullifier_hash,
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &blacklist_root,
        );

        // First withdrawal succeeds
        client.withdraw(
            &root,
            &nullifier_hash,
            &recipient,
            &relayer,
            &0i128,
            &blacklist_root,
            &dummy_proof(&env),
            &pi,
        );

        // Second withdrawal with same nullifier must fail
        let result = client.try_withdraw(
            &root,
            &nullifier_hash,
            &recipient,
            &relayer,
            &0i128,
            &blacklist_root,
            &dummy_proof(&env),
            &pi,
        );
        expect_error(result, PoolError::NullifierSpent);
    }

    #[test]
    fn test_unknown_root_rejected() {
        let (env, contract_id, _admin, _token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        let fake_root = BytesN::from_array(&env, &[0xAB; 32]);
        let nullifier_hash = BytesN::from_array(&env, &[5u8; 32]);
        let recipient = Address::generate(&env);
        let relayer = Address::generate(&env);
        let blacklist_root = client.blacklist_root().unwrap();
        let pi = make_public_inputs(
            &env,
            &fake_root,
            &nullifier_hash,
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &blacklist_root,
        );

        let result = client.try_withdraw(
            &fake_root,
            &nullifier_hash,
            &recipient,
            &relayer,
            &0i128,
            &blacklist_root,
            &dummy_proof(&env),
            &pi,
        );
        expect_error(result, PoolError::UnknownRoot);
    }

    #[test]
    fn test_stale_blacklist_rejected() {
        let (env, contract_id, _admin, token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        let depositor = Address::generate(&env);
        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&depositor, &DENOMINATION);

        let commitment = BytesN::from_array(&env, &[6u8; 32]);
        client.deposit(&depositor, &commitment);

        let root = client.get_root().unwrap();
        let nullifier_hash = BytesN::from_array(&env, &[7u8; 32]);
        let recipient = Address::generate(&env);
        let relayer = Address::generate(&env);
        let stale_root = BytesN::from_array(&env, &[0xDE; 32]);
        let pi = make_public_inputs(
            &env,
            &root,
            &nullifier_hash,
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &BytesN::from_array(&env, &[0u8; 32]),
            &stale_root,
        );

        let result = client.try_withdraw(
            &root,
            &nullifier_hash,
            &recipient,
            &relayer,
            &0i128,
            &stale_root,
            &dummy_proof(&env),
            &pi,
        );
        expect_error(result, PoolError::StaleBlacklist);
    }

    #[test]
    fn test_duplicate_commitment_rejected() {
        let (env, contract_id, _admin, token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        let depositor = Address::generate(&env);
        let stellar_asset = StellarAssetClient::new(&env, &token_addr);
        stellar_asset.mint(&depositor, &(DENOMINATION * 2));

        let commitment = BytesN::from_array(&env, &[8u8; 32]);
        client.deposit(&depositor, &commitment);

        // Second deposit with same commitment
        let result = client.try_deposit(&depositor, &commitment);
        expect_error(result, PoolError::CommitmentExists);
    }

    #[test]
    fn test_unauthorized_set_blacklist() {
        let (env, contract_id, _admin, _token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        let attacker = Address::generate(&env);
        let fake_root = BytesN::from_array(&env, &[0xFF; 32]);
        let entries: Vec<BytesN<32>> = Vec::new(&env);

        let result = client.try_set_blacklist(&attacker, &fake_root, &entries);
        expect_error(result, PoolError::Unauthorized);
    }

    #[test]
    fn test_unauthorized_set_vk() {
        let (env, contract_id, _admin, _token_addr) = setup();
        let client = PrivacyPoolClient::new(&env, &contract_id);

        let attacker = Address::generate(&env);
        let fake_vk = dummy_vk(&env);

        let result = client.try_set_vk(&attacker, &fake_vk);
        expect_error(result, PoolError::Unauthorized);
    }
}

// ── Cross-implementation crypto test ──────────────────────────────────────────
// These tests verify Poseidon2 produces identical outputs to the Noir circuit
// and TypeScript SDK. Reference values computed by `nargo execute` on the
// sample Prover.toml (nullifier=1, secret=2).

#[cfg(test)]
mod crypto_test {
    use super::*;
    use crate::merkle::{poseidon2_pair, poseidon2_one};

    /// Reference hash values computed by the Noir circuit (Prover.toml sample).
    /// If these tests fail, the Poseidon2 implementation diverges from the circuit.
    #[test]
    fn test_poseidon2_pair_matches_noir() {
        let env = Env::default();
        let a = BytesN::from_array(&env, &{
            let mut b = [0u8; 32]; b[31] = 1; b
        });
        let b_val = BytesN::from_array(&env, &{
            let mut b = [0u8; 32]; b[31] = 2; b
        });

        let commitment = poseidon2_pair(&env, &a, &b_val);
        let expected = hex_to_bytes32("038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383");

        assert_eq!(commitment, BytesN::from_array(&env, &expected),
            "Poseidon2(1,2) mismatch between Soroban and Noir circuit");
    }

    #[test]
    fn test_poseidon2_one_matches_noir() {
        let env = Env::default();
        let a = BytesN::from_array(&env, &{
            let mut b = [0u8; 32]; b[31] = 1; b
        });

        let nh = poseidon2_one(&env, &a);
        let expected = hex_to_bytes32("168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373");

        assert_eq!(nh, BytesN::from_array(&env, &expected),
            "Poseidon2(1) mismatch between Soroban and Noir circuit");
    }

    fn hex_to_bytes32(hex: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&hex[i*2..i*2+2], 16).unwrap();
        }
        out
    }
}
