// hash.nr  - Poseidon2 hash wrappers for the Chameleon circuit.
//
// Uses the Noir stdlib `std::hash::poseidon2_permutation` (t=4, BN254) to implement
// the Poseidon2 sponge construction matching the `Poseidon2Hasher` in the Noir stdlib,
// which in turn matches `soroban-poseidon`'s `poseidon2_hash::<4, BnScalar>`.
//
// Sponge parameters (t=4, RATE=3):
//   - state size: 4 (capacity=1)
//   - IV: input_length << 64  (= input_length * 2^64)
//   - initial state: [0, 0, 0, IV]
//   - absorb in chunks of RATE=3; for partial block, add to first N slots
//   - squeeze: permute final state, output state[0]
//
// CROSS-IMPLEMENTATION CONTRACT:
//   hash_2(a, b) == poseidon2_hash::<4,BnScalar>(&env, [a,b]) in Soroban
//               == poseidon2([a,b]) in TypeScript (poseidon2-bn254 npm package)
// Verified by `make test-crypto`.
//
// Note: `std::hash::poseidon2` module is pub(crate) in Noir 1.0.0-beta.22,
// so we use `poseidon2_permutation` directly and replicate the sponge construction.

// Poseidon2 state size (t=4). MUST equal soroban-poseidon's generic parameter.
global STATE_SIZE: u32 = 4;

// Sponge RATE = t - 1 = 3.
global RATE: u32 = 3;

// 2^64 used in IV calculation: IV = input_len * 2^64
global POW2_64: Field = 18446744073709551616;

/// Compute Poseidon2([a, b]) for two field elements.
///
/// Used for:
///   - commitment derivation: C = Poseidon2([nullifier, secret])
///   - Merkle tree node hashing: hash(left, right)
pub fn hash_2(a: Field, b: Field) -> Field {
    // input_length = 2; IV = 2 * 2^64
    let iv: Field = 2 * POW2_64;
    // Initial state
    let mut state: [Field; 4] = [0, 0, 0, iv];
    // No full RATE=3 blocks for 2 inputs (2 < 3)
    // Partial block: absorb 2 elements
    state[0] += a;
    state[1] += b;
    // Final permutation
    let out: [Field; 4] = std::hash::poseidon2_permutation(state, 4);
    out[0]
}

/// Compute Poseidon2([a]) for a single field element.
///
/// Used for nullifier hash: NH = Poseidon2([nullifier]).
pub fn hash_1(a: Field) -> Field {
    // input_length = 1; IV = 1 * 2^64
    let iv: Field = 1 * POW2_64;
    let mut state: [Field; 4] = [0, 0, 0, iv];
    // No full RATE=3 blocks; partial block: 1 element
    state[0] += a;
    let out: [Field; 4] = std::hash::poseidon2_permutation(state, 4);
    out[0]
}
