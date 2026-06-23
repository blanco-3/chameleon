//! Typed error codes for the Chameleon PrivacyPool contract.
//!
//! All public-facing errors are mapped to `PoolError`, a `#[contracterror]` enum
//! that Soroban surfaces to callers as a `ScVal::Error` with the numeric code.
//! Never add silent failures — every rejection must map to one of these variants.

use soroban_sdk::contracterror;

/// Errors returned by the PrivacyPool contract.
///
/// Codes are stable: do not renumber them once deployed.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    /// Contract has already been initialized; `initialize` may only be called once.
    AlreadyInitialized = 1,
    /// Contract has not been initialized; all other operations require initialization.
    NotInitialized = 2,
    /// Deposit amount does not equal the fixed denomination (100 XLM).
    InvalidDenomination = 3,
    /// A deposit with this commitment already exists in the tree.
    CommitmentExists = 4,
    /// Merkle tree is full (2^depth leaves have been inserted).
    TreeFull = 5,
    /// The Merkle root in the proof is not in the root history ring buffer.
    UnknownRoot = 6,
    /// The nullifier has already been spent; double-spend attempt.
    NullifierSpent = 7,
    /// The ZK proof failed on-chain verification.
    InvalidProof = 8,
    /// The blacklist root in the proof does not match the current on-chain blacklist root.
    StaleBlacklist = 9,
    /// Caller is not the admin; requires `require_auth` from admin.
    Unauthorized = 10,
    /// `public_inputs` slice has wrong length (expected 6 × 32 bytes).
    InvalidPublicInputs = 11,
    /// Fee exceeds denomination (would result in zero or negative payout).
    FeeTooHigh = 12,
}
