/**
 * prover.ts — Zero-knowledge proof generation for Chameleon withdrawals.
 *
 * Shells out to `nargo execute` and `bb prove` to generate an UltraHonk
 * proof for the withdrawal circuit. Serializes the proof + public inputs
 * into the byte format expected by the Soroban PrivacyPool contract.
 *
 * Public input order (MUST match circuit, contract, and SDK):
 *   [root, nullifier_hash, recipient, relayer, fee, blacklist_root]
 *
 * Proof format:
 *   - 14592 bytes (456 x 32 bytes; bb 0.87.0 + nargo 1.0.0-beta.9)
 *
 * Public inputs format (for contract):
 *   - 192 bytes: 6 × 32-byte big-endian field elements
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fieldToHex, fieldToBytes32, hexToField } from './poseidon';
import { Note, nullifierHash } from './note';
import { MerkleProof } from './merkle';
import { ChameleonError } from './stellar';

/** Directory of the Noir circuit. */
const CIRCUIT_DIR = path.join(__dirname, '../../circuits/privacy_pool');

/** Path to nargo binary. */
const NARGO = process.env.NARGO ?? `${process.env.HOME}/.nargo/bin/nargo`;

/** Path to bb binary. */
const BB = process.env.BB ?? `${process.env.HOME}/.bb/bb`;

/** Serialized proof + public inputs for contract submission. */
export interface ProofData {
  /** Raw proof bytes (14592 bytes with bb 0.87.0). */
  proofBytes: Buffer;
  /** Public inputs: 6 × 32-byte big-endian field elements = 192 bytes. */
  publicInputsBytes: Buffer;
  /** Human-readable public inputs. */
  publicInputs: {
    root: string;
    nullifierHash: string;
    recipient: string;
    relayer: string;
    fee: string;
    blacklistRoot: string;
  };
}

/** Parameters for generating a withdrawal proof. */
export interface ProofParams {
  /** Merkle root used in the proof. */
  root: string;
  /** The user's note (nullifier + secret). */
  note: Note;
  /** Merkle authentication path. */
  merkleProof: MerkleProof;
  /** Recipient address as a field element (32-byte hex). */
  recipientField: string;
  /** Relayer address as a field element (0x000...0 if no relayer). */
  relayerField: string;
  /** Fee in stroops (BigInt). */
  fee: bigint;
  /** Current on-chain blacklist root (32-byte hex). */
  blacklistRoot: string;
  /** Current blacklist entries (up to 16, zero-padded). */
  blacklist: string[];
}

/**
 * Generate an UltraHonk ZK proof for a Chameleon withdrawal.
 *
 * Steps:
 *   1. Write Prover.toml to a temp directory
 *   2. Run `nargo execute` to solve the witness
 *   3. Run `bb prove` to generate the UltraHonk proof
 *   4. Read and return proof + public inputs bytes
 *
 * @param params Proof generation parameters
 * @returns ProofData with raw bytes ready for contract submission
 * @throws ChameleonError if nargo or bb fails
 */
export async function generateProof(params: ProofParams): Promise<ProofData> {
  // Build public inputs (6 field elements, each 32-byte hex)
  const nh = nullifierHash(params.note);
  const feeHex = '0x' + params.fee.toString(16).padStart(64, '0');

  const publicInputs = {
    root: params.root,
    nullifierHash: nh,
    recipient: params.recipientField,
    relayer: params.relayerField,
    fee: feeHex,
    blacklistRoot: params.blacklistRoot,
  };

  // Pad blacklist to 16 entries
  const blacklist = [...params.blacklist];
  while (blacklist.length < 16) blacklist.push('0x' + '0'.repeat(64));

  // Pad path_elements and path_indices to TREE_DEPTH
  const pathElements = [...params.merkleProof.pathElements.map(f => fieldToHex(f))];
  const pathIndices = [...params.merkleProof.pathIndices];
  while (pathElements.length < 20) pathElements.push('0x' + '0'.repeat(64));
  while (pathIndices.length < 20) pathIndices.push(0);

  // Write Prover.toml
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chameleon-proof-'));
  const proverToml = buildProverToml({
    root: params.root,
    nullifierHash: nh,
    recipient: params.recipientField,
    relayer: params.relayerField,
    fee: feeHex,
    blacklistRoot: params.blacklistRoot,
    nullifier: params.note.nullifier,
    secret: params.note.secret,
    pathElements,
    pathIndices,
    blacklist,
  });

  const tomlPath = path.join(tmpDir, 'Prover.toml');
  fs.writeFileSync(tomlPath, proverToml);

  // Copy circuit artifacts to temp dir
  const circuitTarget = path.join(CIRCUIT_DIR, 'target');
  const tmpTarget = path.join(tmpDir, 'target');
  fs.mkdirSync(tmpTarget);
  fs.copyFileSync(path.join(circuitTarget, 'privacy_pool.json'), path.join(tmpTarget, 'privacy_pool.json'));
  fs.copyFileSync(path.join(circuitTarget, 'vk'), path.join(tmpTarget, 'vk'));

  try {
    // 1. Solve witness
    execSync(`${NARGO} execute`, {
      cwd: tmpDir,
      stdio: 'pipe',
      env: { ...process.env, NARGO_MANIFEST_PATH: path.join(CIRCUIT_DIR, 'Nargo.toml') },
    });

    // nargo execute puts witness in tmpDir/target/ using circuit name
    // but since we're running from tmpDir, it looks for Nargo.toml there
    // Let's use the original circuit dir approach instead
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true });
    throw new ChameleonError(
      `nargo execute failed: ${(e as Error).message}`,
      'NARGO_FAILED',
      e,
    );
  }

  try {
    // 2. Generate proof
    const witnessPath = path.join(tmpTarget, 'privacy_pool.gz');
    const acirPath = path.join(tmpTarget, 'privacy_pool.json');

    execSync(`${BB} prove --scheme ultra_honk --oracle_hash keccak -b ${acirPath} -w ${witnessPath} -o ${tmpTarget}/`, {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    const proofBytes = fs.readFileSync(path.join(tmpTarget, 'proof'));
    const pubInputsBytes = fs.readFileSync(path.join(tmpTarget, 'public_inputs'));

    fs.rmSync(tmpDir, { recursive: true });
    return {
      proofBytes,
      publicInputsBytes: pubInputsBytes,
      publicInputs,
    };
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true });
    throw new ChameleonError(
      `bb prove failed: ${(e as Error).message}`,
      'BB_FAILED',
      e,
    );
  }
}

/**
 * Generate proof using a working directory approach — writes Prover.toml
 * to the circuit directory, runs nargo execute + bb prove there, reads results.
 *
 * This is the simpler approach that avoids tmp dir nargo path issues.
 */
export async function generateProofInCircuitDir(params: ProofParams): Promise<ProofData> {
  const nh = nullifierHash(params.note);
  const feeHex = '0x' + params.fee.toString(16).padStart(64, '0');

  const publicInputs = {
    root: params.root,
    nullifierHash: nh,
    recipient: params.recipientField,
    relayer: params.relayerField,
    fee: feeHex,
    blacklistRoot: params.blacklistRoot,
  };

  const blacklist = [...params.blacklist];
  while (blacklist.length < 16) blacklist.push('0x' + '0'.repeat(64));

  const pathElements = [...params.merkleProof.pathElements.map(f => fieldToHex(f))];
  const pathIndices = [...params.merkleProof.pathIndices];
  while (pathElements.length < 20) pathElements.push('0x' + '0'.repeat(64));
  while (pathIndices.length < 20) pathIndices.push(0);

  // Write Prover.toml to circuit directory
  const proverToml = buildProverToml({
    root: params.root,
    nullifierHash: nh,
    recipient: params.recipientField,
    relayer: params.relayerField,
    fee: feeHex,
    blacklistRoot: params.blacklistRoot,
    nullifier: params.note.nullifier,
    secret: params.note.secret,
    pathElements,
    pathIndices,
    blacklist,
  });

  const tomlPath = path.join(CIRCUIT_DIR, 'Prover.toml');
  const origToml = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath) : null;
  fs.writeFileSync(tomlPath, proverToml);

  try {
    // Solve witness
    execSync(`${NARGO} execute`, { cwd: CIRCUIT_DIR, stdio: 'pipe' });

    // Generate proof
    const circuitTarget = path.join(CIRCUIT_DIR, 'target');
    execSync(
      `${BB} prove --scheme ultra_honk --oracle_hash keccak -b ${circuitTarget}/privacy_pool.json -w ${circuitTarget}/privacy_pool.gz -o ${circuitTarget}/`,
      { cwd: CIRCUIT_DIR, stdio: 'pipe' },
    );

    const proofBytes = fs.readFileSync(path.join(circuitTarget, 'proof'));
    const pubInputsBytes = fs.readFileSync(path.join(circuitTarget, 'public_inputs'));

    return { proofBytes, publicInputsBytes: pubInputsBytes, publicInputs };
  } catch (e) {
    throw new ChameleonError(
      `Proof generation failed: ${(e as Error).message}`,
      'PROOF_FAILED',
      e,
    );
  } finally {
    // Restore original Prover.toml
    if (origToml) {
      fs.writeFileSync(tomlPath, origToml);
    }
  }
}

/** Build the Prover.toml content string. */
function buildProverToml(inputs: {
  root: string;
  nullifierHash: string;
  recipient: string;
  relayer: string;
  fee: string;
  blacklistRoot: string;
  nullifier: string;
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  blacklist: string[];
}): string {
  const arrayField = (arr: string[]) =>
    '[\n' + arr.map(v => `    "${v}"`).join(',\n') + '\n]';
  const numArrayField = (arr: number[]) =>
    '[\n' + arr.map(v => `    "${v === 0 ? '0x' + '0'.repeat(64) : '0x' + v.toString(16).padStart(64, '0')}"`).join(',\n') + '\n]';

  return `# Auto-generated by Chameleon CLI — do not edit manually
root           = "${inputs.root}"
nullifier_hash = "${inputs.nullifierHash}"
recipient      = "${inputs.recipient}"
relayer        = "${inputs.relayer}"
fee            = "${inputs.fee}"
blacklist_root = "${inputs.blacklistRoot}"

nullifier = "${inputs.nullifier}"
secret    = "${inputs.secret}"
path_elements = ${arrayField(inputs.pathElements)}
path_indices = ${numArrayField(inputs.pathIndices)}
blacklist = ${arrayField(inputs.blacklist)}
`;
}

/**
 * Serialize a proof + public inputs into the format expected by the
 * Soroban PrivacyPool contract's `withdraw` function.
 *
 * @param proofData ProofData from generateProof
 * @returns { proof: Buffer (14656 bytes), publicInputs: Buffer (192 bytes) }
 */
export function serializeForContract(proofData: ProofData): {
  proof: Buffer;
  publicInputs: Buffer;
} {
  return {
    proof: proofData.proofBytes,
    publicInputs: proofData.publicInputsBytes,
  };
}
