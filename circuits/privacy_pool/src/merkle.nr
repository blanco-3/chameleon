// merkle.nr — Merkle tree path verification for the Chameleon circuit.
//
// Verifies a Merkle membership proof: given a leaf, a path of siblings,
// and a path of left/right indicators, recomputes the root from leaf to root
// and asserts it equals the expected root.
//
// Tree depth is 20 (set by TREE_DEPTH constant in main.nr).
// Hashing: Poseidon2 over BN254 (see hash.nr).

use crate::hash::hash_2;

/// Compute the Merkle root from a leaf and its authentication path.
///
/// # Arguments
/// - `leaf`          — The leaf value (Poseidon2(nullifier, secret))
/// - `path_elements` — [depth] sibling hashes along the path
/// - `path_indices`  — [depth] direction bits: 0 = leaf is left child, 1 = leaf is right child
///
/// # Returns
/// The computed Merkle root. The circuit asserts this equals the public `root` input.
pub fn merkle_root(
    leaf: Field,
    path_elements: [Field; 20],
    path_indices: [Field; 20],
) -> Field {
    let mut current = leaf;

    for i in 0..20 {
        let sibling = path_elements[i];
        let is_right = path_indices[i]; // 0 = current is left, 1 = current is right

        // Constrain path_indices[i] to be boolean
        assert(is_right * (is_right - 1) == 0);

        // Select left/right based on direction bit
        let left  = current * (1 - is_right) + sibling * is_right;
        let right = sibling * (1 - is_right) + current * is_right;

        current = hash_2(left, right);
    }

    current
}
