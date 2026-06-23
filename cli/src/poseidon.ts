/**
 * poseidon.ts — Poseidon2 hash wrapper for the Chameleon CLI.
 *
 * Implements the same sponge construction as:
 *   - Noir circuit: `std::hash::poseidon2_permutation` (t=4)
 *   - Soroban contract: `soroban_poseidon::poseidon2_hash::<4, BnScalar>`
 *
 * Cross-implementation contract:
 *   hash2(1n, 2n) == 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383
 *   hash1(1n)     == 0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373
 * Verified by `make test-crypto`.
 *
 * Sponge parameters (matches Noir stdlib Poseidon2Hasher):
 *   t = 4 (state size), RATE = 3
 *   IV = input_length * 2^64
 *   initial state: [0, 0, 0, IV]
 *   absorb: chunks of RATE into state[0..RATE]; permute after each full chunk
 *   partial block: add remaining inputs to state[0..N]; then final permute
 *   output: permuted_state[0]
 */

import { bn254 } from '@taceo/poseidon2';

/** BN254 scalar field modulus */
export const BN254_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

/** 2^64 for IV computation */
const POW2_64 = 2n ** 64n;

/** Poseidon2 permutation over BN254 with t=4 state */
const perm = bn254.t4.permutation;

/**
 * Compute Poseidon2([a, b]) — two-element absorption.
 *
 * Used for:
 *   - Commitment derivation: C = hash2(nullifier, secret)
 *   - Merkle tree hashing: hash2(left, right)
 *
 * @param a First field element (< BN254_R)
 * @param b Second field element (< BN254_R)
 * @returns Hash output field element
 */
export function hash2(a: bigint, b: bigint): bigint {
  // IV = 2 * 2^64 (input_length=2)
  const state: bigint[] = [
    a % BN254_R,
    b % BN254_R,
    0n,
    2n * POW2_64,
  ];
  // No full RATE=3 chunks for 2 inputs. Partial block already absorbed.
  // Final permutation.
  return perm(state)[0];
}

/**
 * Compute Poseidon2([a]) — single-element absorption.
 *
 * Used for nullifier hash: NH = hash1(nullifier).
 *
 * @param a Field element (< BN254_R)
 * @returns Hash output field element
 */
export function hash1(a: bigint): bigint {
  // IV = 1 * 2^64 (input_length=1)
  const state: bigint[] = [
    a % BN254_R,
    0n,
    0n,
    1n * POW2_64,
  ];
  return perm(state)[0];
}

/**
 * Convert a hex string (with or without 0x) to a BigInt field element.
 * Reduces mod BN254_R to ensure the value is in-range.
 */
export function hexToField(hex: string): bigint {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + (s || '0')) % BN254_R;
}

/**
 * Convert a BigInt field element to a 0x-prefixed 64-character hex string.
 */
export function fieldToHex(f: bigint): string {
  return '0x' + (f % BN254_R).toString(16).padStart(64, '0');
}

/**
 * Convert a BigInt field element to a 32-byte big-endian Uint8Array.
 */
export function fieldToBytes32(f: bigint): Uint8Array {
  const hex = (f % BN254_R).toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Convert a 32-byte Uint8Array (big-endian) to a BigInt field element.
 */
export function bytes32ToField(b: Uint8Array): bigint {
  let hex = '';
  for (const byte of b) hex += byte.toString(16).padStart(2, '0');
  return BigInt('0x' + hex) % BN254_R;
}
