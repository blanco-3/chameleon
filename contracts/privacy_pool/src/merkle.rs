//! Incremental Merkle tree implementation (Tornado pattern) for the PrivacyPool.
//!
//! Uses Poseidon2 over BN254 scalar field (via `soroban-poseidon`) for hashing.
//! The tree is depth 20, supporting up to 2^20 = 1,048,576 leaves.
//!
//! State stored on-chain:
//! - `filled_subtrees[i]` — the "frontier" node at level `i`
//! - Root history ring buffer (last `ROOT_HISTORY_SIZE` roots)
//!
//! IMPORTANT: The Poseidon2 parameters here (t=4, BnScalar) MUST match those used
//! in the Noir circuit (`std::hash::poseidon2`) and the TypeScript SDK.
//! Cross-implementation test (`make test-crypto`) verifies this.

extern crate alloc;
use alloc::vec::Vec;

use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{crypto::BnScalar, Bytes, BytesN, Env, U256, Vec as SorobanVec};

use crate::storage::{
    get_filled_subtree, get_next_index, get_root_history_current, set_filled_subtree,
    set_next_index, set_root, set_root_history, set_root_history_current,
};

/// Merkle tree depth. Supports 2^20 = 1,048,576 leaves.
pub const TREE_DEPTH: u32 = 20;

/// Maximum number of leaves.
pub const MAX_LEAVES: u32 = 1u32 << TREE_DEPTH;

/// Number of historical roots to store (ring buffer). Provers have this many
/// deposits of "breathing room" before their root becomes stale.
pub const ROOT_HISTORY_SIZE: u32 = 30;

/// Compute Poseidon2(left, right) → 32-byte hash.
///
/// Uses `soroban-poseidon` with `t=4` (absorption width) over the BN254 scalar field.
/// Inputs are treated as field elements (32-byte big-endian, reduced mod p).
pub fn poseidon2_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let modulus = <BnScalar as Field>::modulus(env);
    let la = Bytes::from_array(env, &left.to_array());
    let ra = Bytes::from_array(env, &right.to_array());
    let mut inputs: SorobanVec<U256> = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &la).rem_euclid(&modulus));
    inputs.push_back(U256::from_be_bytes(env, &ra).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let out_bytes = out.to_be_bytes();
    let mut arr = [0u8; 32];
    out_bytes.copy_into_slice(&mut arr);
    BytesN::from_array(env, &arr)
}

/// Compute Poseidon2([input]) → 32-byte hash (single-element absorption).
///
/// Used for nullifier hash: `NH = Poseidon2([nullifier])`.
pub fn poseidon2_one(env: &Env, input: &BytesN<32>) -> BytesN<32> {
    let modulus = <BnScalar as Field>::modulus(env);
    let ia = Bytes::from_array(env, &input.to_array());
    let mut inputs: SorobanVec<U256> = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &ia).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let out_bytes = out.to_be_bytes();
    let mut arr = [0u8; 32];
    out_bytes.copy_into_slice(&mut arr);
    BytesN::from_array(env, &arr)
}

/// Precompute the zero values for all levels of the Merkle tree.
///
/// `zeros[0]` = `[0u8; 32]` (empty leaf sentinel)
/// `zeros[i+1]` = `Poseidon2(zeros[i], zeros[i])`
///
/// These are deterministic and used during `insert` to fill unpopulated siblings.
/// Called once during `initialize`.
pub fn compute_zeros(env: &Env) -> Vec<BytesN<32>> {
    let mut zeros: Vec<BytesN<32>> = Vec::with_capacity((TREE_DEPTH + 1) as usize);
    let mut cur = BytesN::from_array(env, &[0u8; 32]);
    zeros.push(cur.clone());
    for _ in 0..TREE_DEPTH {
        cur = poseidon2_pair(env, &cur, &cur);
        zeros.push(cur.clone());
    }
    zeros
}

/// Initialize the incremental Merkle tree.
///
/// Computes and stores the initial `filled_subtrees` (all equal to `zeros[level]`)
/// and the initial root (`zeros[TREE_DEPTH]`).
/// Also writes the initial root into ring-buffer position 0.
///
/// Must be called exactly once during contract `initialize`.
pub fn init_tree(env: &Env) {
    let zeros = compute_zeros(env);
    for level in 0..TREE_DEPTH {
        set_filled_subtree(env, level, &zeros[level as usize]);
    }
    let initial_root = &zeros[TREE_DEPTH as usize];
    set_root(env, initial_root);
    set_root_history(env, 0, initial_root);
    set_next_index(env, 0);
    set_root_history_current(env, 0);
}

/// Insert a new leaf into the Merkle tree and update roots.
///
/// Implements the incremental update from Tornado Cash:
/// - Traverses from leaf to root, replacing the filled subtree at each level.
/// - Emits the new root into the ring buffer.
///
/// # Arguments
/// - `env`    — Soroban environment
/// - `leaf`   — 32-byte commitment to insert
///
/// # Returns
/// - `(new_root, leaf_index)` where `leaf_index` is the position of the inserted leaf
///
/// # Errors
/// Returns `(zero_root, u32::MAX)` if the tree is full — caller must check next_index before calling.
pub fn insert(env: &Env, leaf: &BytesN<32>) -> (BytesN<32>, u32) {
    let zeros = compute_zeros(env);
    let current_index = get_next_index(env);

    let mut current_level_hash = leaf.clone();
    let mut left;
    let mut right;
    let mut filled_index = current_index;

    for i in 0..TREE_DEPTH {
        if filled_index % 2 == 0 {
            // left node: store current as the new filled subtree, pair with zero
            left = current_level_hash.clone();
            right = zeros[i as usize].clone();
            set_filled_subtree(env, i, &current_level_hash);
        } else {
            // right node: pair with the stored filled subtree
            left = get_filled_subtree(env, i).unwrap_or_else(|| zeros[i as usize].clone());
            right = current_level_hash.clone();
        }
        current_level_hash = poseidon2_pair(env, &left, &right);
        filled_index /= 2;
    }

    // Update root and root history
    let new_root = current_level_hash;
    set_root(env, &new_root);

    let hist_pos = get_root_history_current(env);
    let next_hist_pos = (hist_pos + 1) % ROOT_HISTORY_SIZE;
    set_root_history(env, next_hist_pos, &new_root);
    set_root_history_current(env, next_hist_pos);

    set_next_index(env, current_index + 1);

    (new_root, current_index)
}

/// Check if a root is in the ring buffer of recently accepted roots.
///
/// Returns `true` if `root` matches any of the last `ROOT_HISTORY_SIZE` roots.
/// The initial root is stored at position 0 during `init_tree`.
pub fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    // Fast path: check current root
    if let Some(current) = crate::storage::get_root(env) {
        if &current == root {
            return true;
        }
    }
    // Scan ring buffer
    for i in 0..ROOT_HISTORY_SIZE {
        if let Some(h) = crate::storage::get_root_history(env, i) {
            if &h == root {
                return true;
            }
        }
    }
    false
}
