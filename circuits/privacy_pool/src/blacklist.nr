// blacklist.nr  - Non-membership check for the Chameleon compliance circuit.
//
// Implements the O(k) "none of the 16 blacklist slots equals my commitment" check.
// Zero entries are sentinels meaning "slot unused" and are skipped.
//
// This is the hackathon-scale variant. Production would use a Merkle non-membership
// proof (e.g. Semaphore-style indexed Merkle tree), but for 16 entries the linear
// scan is simpler and still sound.
//
// BLACKLIST_SIZE = 16 (must match the constant in main.nr and in the Soroban contract).

/// Assert that `commitment` is not present in `blacklist[0..16]`.
///
/// Slots containing Field(0) are treated as empty (unset) and skipped.
/// All non-zero slots are checked: if any equals `commitment`, the constraint fails.
///
/// # Arguments
/// - `commitment`  - The prover's commitment (Poseidon2(nullifier, secret))
/// - `blacklist`   - 16 commitments that are compliance-blacklisted (zero-padded)
pub fn assert_not_blacklisted(commitment: Field, blacklist: [Field; 16]) {
    for i in 0..16 {
        let entry = blacklist[i];
        // Skip zero sentinels (empty slot)
        if entry != 0 {
            // If commitment == entry, this fails
            assert(commitment != entry);
        }
    }
}
