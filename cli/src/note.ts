/**
 * note.ts — Chameleon note (secret key) generation and serialization.
 *
 * A "note" is the user's secret data that proves ownership of a deposit.
 * LOSING THE NOTE MEANS LOSING YOUR 100 XLM. There is no recovery mechanism.
 *
 * Note format (stored as JSON):
 * {
 *   "nullifier":     "0x...",   // 32-byte random field element
 *   "secret":        "0x...",   // 32-byte random field element
 *   "commitment":    "0x...",   // Poseidon2([nullifier, secret])
 *   "depositTxHash": "...",     // Stellar tx hash (filled after deposit)
 *   "leafIndex":     0          // Merkle tree position (filled after deposit)
 * }
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import { hash1, hash2, fieldToHex, hexToField, BN254_R } from './poseidon';

/** Chameleon note — user's secret for a single 100 XLM deposit. */
export interface Note {
  /** Random secret field element: the nullifier. Never share this. */
  nullifier: string;
  /** Random secret field element: the secret. Never share this. */
  secret: string;
  /** Poseidon2([nullifier, secret]) — the on-chain deposit commitment. */
  commitment: string;
  /** Stellar transaction hash of the deposit (filled after deposit). */
  depositTxHash?: string;
  /** Merkle tree leaf index (filled after deposit). */
  leafIndex?: number;
}

/**
 * Generate a new Chameleon note with a fresh cryptographically random
 * nullifier and secret. Computes the commitment.
 *
 * @returns A new Note with nullifier, secret, and commitment
 */
export function generateNote(): Note {
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  const commitment = hash2(nullifier, secret);
  return {
    nullifier: fieldToHex(nullifier),
    secret: fieldToHex(secret),
    commitment: fieldToHex(commitment),
  };
}

/**
 * Compute the nullifier hash (Poseidon2([nullifier])) for a given note.
 * This is the spend marker stored on-chain when withdrawing.
 */
export function nullifierHash(note: Note): string {
  return fieldToHex(hash1(hexToField(note.nullifier)));
}

/**
 * Write a note to a JSON file.
 *
 * @param note The note to serialize
 * @param filePath Destination file path
 * @throws If the file cannot be written
 */
export function saveNote(note: Note, filePath: string): void {
  const json = JSON.stringify(note, null, 2);
  fs.writeFileSync(filePath, json, { mode: 0o600 }); // owner-only read/write
}

/**
 * Read and parse a note from a JSON file.
 *
 * @param filePath Path to the note JSON file
 * @returns Parsed Note
 * @throws If file is missing, unreadable, or malformed
 */
export function loadNote(filePath: string): Note {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Note file not found: ${filePath}`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read note file ${filePath}: ${e}`);
  }
  let note: Note;
  try {
    note = JSON.parse(raw) as Note;
  } catch (e) {
    throw new Error(`Note file is not valid JSON: ${filePath}`);
  }
  validateNote(note);
  return note;
}

/**
 * Validate that a note object has the required fields in the correct format.
 *
 * @throws If any required field is missing or malformed
 */
function validateNote(note: unknown): asserts note is Note {
  const n = note as Record<string, unknown>;
  if (typeof n.nullifier !== 'string' || !n.nullifier.startsWith('0x')) {
    throw new Error('Note missing or invalid nullifier field');
  }
  if (typeof n.secret !== 'string' || !n.secret.startsWith('0x')) {
    throw new Error('Note missing or invalid secret field');
  }
  if (typeof n.commitment !== 'string' || !n.commitment.startsWith('0x')) {
    throw new Error('Note missing or invalid commitment field');
  }
  // Verify commitment matches
  const expectedCommitment = fieldToHex(hash2(hexToField(n.nullifier as string), hexToField(n.secret as string)));
  if (expectedCommitment !== n.commitment) {
    throw new Error('Note commitment does not match Poseidon2(nullifier, secret) — note may be corrupted');
  }
}

/**
 * Generate a cryptographically random BN254 field element.
 * Uses rejection sampling to ensure uniform distribution in [0, BN254_R).
 */
function randomFieldElement(): bigint {
  // Generate 32 bytes (256 bits) and reduce mod BN254_R
  // Loop in case the sample is in the bias region (very unlikely)
  while (true) {
    const bytes = crypto.randomBytes(32);
    const val = BigInt('0x' + bytes.toString('hex'));
    if (val < BN254_R) return val;
    // With BN254_R ≈ 2^254, rejection probability is < 2^-2 per attempt
  }
}
