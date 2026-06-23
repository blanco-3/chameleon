//! Storage key definitions and typed getters/setters for the PrivacyPool contract.
//!
//! All on-chain state is accessed through this module to keep storage key naming
//! centralized. Keys are defined as a `DataKey` enum which serializes to compact
//! discriminant values. Getters return `Option<T>` so callers can distinguish
//! "not set" from errors.

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env};

/// Canonical storage keys for all contract state.
///
/// Variants with tuple payloads create per-entry sub-keys (e.g. `FilledSubtree(level)`).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address; can call `initialize`, `set_blacklist`, `set_vk`.
    Admin,
    /// Native XLM SAC token address used for deposits/withdrawals.
    Token,
    /// Fixed deposit/withdrawal denomination in stroops (1_000_000_000 for 100 XLM).
    Denomination,
    /// Next available leaf index in the Merkle tree (u32).
    NextIndex,
    /// `filled_subtrees[level]` — the current filled hash at tree level `level`.
    FilledSubtree(u32),
    /// Current Merkle root (BytesN<32>).
    Root,
    /// Ring-buffer slot `idx` (0..ROOT_HISTORY_SIZE) storing a historical root.
    RootHistory(u32),
    /// Current write position in the root-history ring buffer.
    RootHistoryCurrent,
    /// Tracks whether a commitment has been deposited. Key exists iff deposited.
    Commitment(BytesN<32>),
    /// Tracks whether a nullifier hash has been spent. Key exists iff spent.
    Nullifier(BytesN<32>),
    /// Serialized UltraHonk verification key (from `bb write_vk`).
    VerificationKey,
    /// Poseidon root of the current blacklist set.
    BlacklistRoot,
    /// Individual blacklist entry at position `i` (0..BLACKLIST_SIZE).
    BlacklistEntry(u32),
}

// ── Admin ──────────────────────────────────────────────────────────────────────

/// Store the admin address.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Retrieve the admin address, or `None` if contract is uninitialized.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

// ── Token ──────────────────────────────────────────────────────────────────────

/// Store the native XLM SAC token address.
pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

/// Retrieve the token address.
pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Token)
}

// ── Denomination ───────────────────────────────────────────────────────────────

/// Store the fixed denomination.
pub fn set_denomination(env: &Env, d: i128) {
    env.storage().instance().set(&DataKey::Denomination, &d);
}

/// Retrieve the denomination.
pub fn get_denomination(env: &Env) -> Option<i128> {
    env.storage().instance().get(&DataKey::Denomination)
}

// ── Next index ─────────────────────────────────────────────────────────────────

/// Store the next available leaf index.
pub fn set_next_index(env: &Env, idx: u32) {
    env.storage().instance().set(&DataKey::NextIndex, &idx);
}

/// Retrieve the next available leaf index (default 0).
pub fn get_next_index(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::NextIndex)
        .unwrap_or(0)
}

// ── Merkle tree ────────────────────────────────────────────────────────────────

/// Store `filled_subtrees[level]`.
pub fn set_filled_subtree(env: &Env, level: u32, hash: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::FilledSubtree(level), hash);
}

/// Retrieve `filled_subtrees[level]`.
pub fn get_filled_subtree(env: &Env, level: u32) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::FilledSubtree(level))
}

/// Store the current Merkle root.
pub fn set_root(env: &Env, root: &BytesN<32>) {
    env.storage().instance().set(&DataKey::Root, root);
}

/// Retrieve the current Merkle root.
pub fn get_root(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::Root)
}

// ── Root history ring buffer ───────────────────────────────────────────────────

/// Store a root at ring-buffer position `idx`.
pub fn set_root_history(env: &Env, idx: u32, root: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::RootHistory(idx), root);
}

/// Retrieve the root at ring-buffer position `idx`.
pub fn get_root_history(env: &Env, idx: u32) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::RootHistory(idx))
}

/// Store the current write position in the root history ring buffer.
pub fn set_root_history_current(env: &Env, pos: u32) {
    env.storage()
        .instance()
        .set(&DataKey::RootHistoryCurrent, &pos);
}

/// Retrieve the current write position (default 0).
pub fn get_root_history_current(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::RootHistoryCurrent)
        .unwrap_or(0)
}

// ── Commitments ────────────────────────────────────────────────────────────────

/// Mark a commitment as deposited.
pub fn insert_commitment(env: &Env, commitment: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(commitment.clone()), &true);
}

/// Return `true` if this commitment has been deposited.
pub fn has_commitment(env: &Env, commitment: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Commitment(commitment.clone()))
}

// ── Nullifiers ─────────────────────────────────────────────────────────────────

/// Mark a nullifier hash as spent.
pub fn mark_spent(env: &Env, nullifier_hash: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Nullifier(nullifier_hash.clone()), &true);
}

/// Return `true` if this nullifier hash has been spent.
pub fn is_spent(env: &Env, nullifier_hash: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Nullifier(nullifier_hash.clone()))
}

// ── Verification key ──────────────────────────────────────────────────────────

/// Store the UltraHonk verification key bytes.
pub fn set_vk(env: &Env, vk: &Bytes) {
    env.storage().instance().set(&DataKey::VerificationKey, vk);
}

/// Retrieve the verification key bytes.
pub fn get_vk(env: &Env) -> Option<Bytes> {
    env.storage().instance().get(&DataKey::VerificationKey)
}

// ── Blacklist ─────────────────────────────────────────────────────────────────

/// Store the Poseidon root of the blacklist set.
pub fn set_blacklist_root(env: &Env, root: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&DataKey::BlacklistRoot, root);
}

/// Retrieve the blacklist root.
pub fn get_blacklist_root(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::BlacklistRoot)
}

/// Store an individual blacklist commitment at position `i`.
pub fn set_blacklist_entry(env: &Env, i: u32, entry: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::BlacklistEntry(i), entry);
}

/// Retrieve the blacklist entry at position `i`.
pub fn get_blacklist_entry(env: &Env, i: u32) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::BlacklistEntry(i))
}
