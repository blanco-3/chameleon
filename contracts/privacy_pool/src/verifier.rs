//! UltraHonk proof verifier wrapper for the PrivacyPool contract.
//!
//! Two compilation modes are available via Cargo features:
//!
//! - **`real-verifier`** (default off): uses the vendored `ultrahonk_soroban_verifier` crate
//!   to run full on-chain UltraHonk verification. Requires the crate to build for
//!   `wasm32-unknown-unknown`.
//!
//! - **`mock`** (default on): performs only structural validation (correct byte lengths) and
//!   always returns `true` for a structurally valid proof. Safe for integration tests.
//!   **Do not deploy with `mock` feature enabled on mainnet.**
//!
//! TODO(verifier): Once `ultrahonk_soroban_verifier` build for wasm32 is confirmed stable,
//! switch the default feature from `mock` to `real-verifier` in Cargo.toml.
//! The swap path: remove `default = ["mock"]`, add `default = ["real-verifier"]`.

use soroban_sdk::{Bytes, Env};

/// Expected size of the UltraHonk verification key produced by `bb write_vk`.
///
/// Measured from `bb 5.0.0-nightly.20260522` output: 3680 bytes.
/// NOTE: the vendored `ultrahonk_soroban_verifier` was written for bb v0.82.2 which
/// produced 1760-byte VKs. The sizes differ because the proof system changed.
/// TODO(verifier): update when rs-soroban-ultrahonk supports the current bb version.
pub const VK_BYTES: usize = 3680;

/// Expected size of the UltraHonk proof produced by `bb prove`.
///
/// Measured from `bb 5.0.0-nightly.20260522` output: 14656 bytes (458 × 32 + 64 bytes header).
/// NOTE: `ultrahonk_soroban_verifier` expects 456 × 32 = 14592 bytes (older format).
/// TODO(verifier): update when rs-soroban-ultrahonk supports the current bb version.
pub const PROOF_BYTES: usize = 14656;

/// Number of public inputs for Chameleon circuit:
///   root, nullifier_hash, recipient, relayer, fee, blacklist_root = 6
pub const PUBLIC_INPUTS_COUNT: usize = 6;

/// Expected byte length of the public inputs vector (6 × 32 bytes big-endian field elements).
pub const PUBLIC_INPUTS_BYTES: usize = PUBLIC_INPUTS_COUNT * 32; // 192

/// Verify an UltraHonk proof.
///
/// # Arguments
/// - `env`           — Soroban execution environment
/// - `vk`            — Verification key bytes (1760 bytes from `bb write_vk`)
/// - `proof`         — Proof bytes (14592 bytes from `bb prove`)
/// - `public_inputs` — 192 bytes: 6 field elements, each 32 bytes big-endian, in order:
///                     `[root, nullifier_hash, recipient, relayer, fee, blacklist_root]`
///
/// # Returns
/// - `true`  — proof is valid
/// - `false` — proof failed verification (structural or cryptographic)
///
/// # Feature gates
/// Compiled with `mock`: always returns `true` for inputs of correct byte length.
/// Compiled with `real-verifier`: delegates to `UltraHonkVerifier::verify`.
#[cfg(feature = "mock")]
pub fn verify(env: &Env, vk: &Bytes, proof: &Bytes, public_inputs: &Bytes) -> bool {
    // Mock verifier: structural checks only.
    // Validates that byte lengths are correct so the rest of the contract logic is exercised.
    // NEVER use in production: this does not actually validate the ZK proof.
    let _ = env;
    vk.len() == VK_BYTES as u32
        && proof.len() == PROOF_BYTES as u32
        && public_inputs.len() == PUBLIC_INPUTS_BYTES as u32
}

#[cfg(all(feature = "real-verifier", not(feature = "mock")))]
pub fn verify(env: &Env, vk: &Bytes, proof: &Bytes, public_inputs: &Bytes) -> bool {
    // Real verifier: full UltraHonk on-chain verification.
    // TODO(verifier): if the crate API changes, update here.
    use ultrahonk_soroban_verifier::UltraHonkVerifier;
    match UltraHonkVerifier::new(env, vk) {
        Ok(verifier) => verifier.verify(env, proof, public_inputs).is_ok(),
        Err(_) => false,
    }
}

#[cfg(all(not(feature = "real-verifier"), not(feature = "mock")))]
compile_error!(
    "privacy_pool must be compiled with either the `mock` or `real-verifier` feature. \
     Add `--features mock` for testing or `--features real-verifier` for production."
);
