/**
 * test_crypto.ts — Cross-implementation Poseidon2 consistency test.
 *
 * Verifies that the TypeScript Poseidon2 implementation in poseidon.ts produces
 * outputs byte-identical to the Noir circuit (confirmed by `bb verify` passing)
 * and the Soroban contract (confirmed by passing Rust tests).
 *
 * Reference vectors:
 *   inputs: nullifier=1, secret=2
 *   commitment    = Poseidon2([1,2]) = 0x038682aa...
 *   nullifier_hash = Poseidon2([1])  = 0x168758...
 *
 * Run with: `make test-crypto` or `npx ts-node src/test_crypto.ts`
 */

import { hash1, hash2, fieldToHex } from './poseidon';

// Reference values produced by `nargo execute` on the sample Prover.toml
// and verified by `bb verify`. These MUST also match the Soroban contract tests.
const REFERENCE_VECTORS = [
  {
    name: 'Poseidon2([1, 2]) — commitment for nullifier=1, secret=2',
    inputs: [1n, 2n],
    fn: () => hash2(1n, 2n),
    expected: '0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383',
  },
  {
    name: 'Poseidon2([1]) — nullifier_hash for nullifier=1',
    inputs: [1n],
    fn: () => hash1(1n),
    expected: '0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373',
  },
  {
    name: 'Poseidon2([42, 999]) — additional test vector',
    inputs: [42n, 999n],
    fn: () => hash2(42n, 999n),
    expected: null, // computed and printed; not in circuit but useful for future parity
  },
];

let passed = 0;
let failed = 0;

console.log('=== Chameleon: Cross-implementation Poseidon2 test ===\n');

for (const v of REFERENCE_VECTORS) {
  const result = fieldToHex(v.fn());
  if (v.expected === null) {
    console.log(`  [INFO] ${v.name}`);
    console.log(`         result: ${result}`);
    console.log();
    continue;
  }
  const ok = result === v.expected;
  if (ok) {
    passed++;
    console.log(`  [PASS] ${v.name}`);
    console.log(`         ${result}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${v.name}`);
    console.error(`         expected: ${v.expected}`);
    console.error(`         got:      ${result}`);
  }
  console.log();
}

// Merkle tree parity: compute Merkle root for commitment of (nullifier=1, secret=2)
// with all-zero siblings, depth 20. Must match circuit output.
console.log('--- Merkle tree root parity ---');
const DEPTH = 20;
const commitment = hash2(1n, 2n);
let cur = commitment;
for (let i = 0; i < DEPTH; i++) {
  cur = hash2(cur, 0n); // left child (index 0), sibling is zero
}
const computedRoot = fieldToHex(cur);
const expectedRoot = '0x10aa62d7b67baf5d681c99eba7feaae6d35e760ea7c77e5e7d2628793369d3ff';
const rootOk = computedRoot === expectedRoot;
if (rootOk) {
  passed++;
  console.log(`  [PASS] Merkle root (depth=20, all-zero path)`);
  console.log(`         ${computedRoot}`);
} else {
  failed++;
  console.error(`  [FAIL] Merkle root mismatch`);
  console.error(`         expected: ${expectedRoot}`);
  console.error(`         got:      ${computedRoot}`);
}
console.log();

// Summary
console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('\nCRITICAL: Poseidon2 outputs do NOT match between implementations!');
  console.error('This means the circuit, contract, and SDK will produce incompatible proofs.');
  process.exit(1);
} else {
  console.log('\nAll cross-implementation Poseidon2 outputs are byte-identical. Safe to proceed.');
}
