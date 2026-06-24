#!/usr/bin/env node
/**
 * index.ts — Chameleon CLI entry point.
 *
 * Commands:
 *   keygen               Generate a new note (nullifier + secret + commitment)
 *   deposit --note <f>   Deposit 100 XLM using the commitment in the note file
 *   sync                 Rebuild Merkle tree from on-chain deposit events
 *   prove --note <f> --to <addr>   Generate withdrawal proof
 *   withdraw --proof <f> Submit withdrawal transaction
 *   demo                 Run full demo (happy path + blacklisted path)
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { generateNote, loadNote, saveNote, nullifierHash } from './note';
import { MerkleTree, ZEROS, TREE_DEPTH, verifyMerkleProof } from './merkle';
import { generateProofInCircuitDir } from './prover';
import {
  makeServer,
  fundAccount,
  invokeContract,
  fetchDepositEvents,
  commitmentToScVal,
  addressToField,
  DENOMINATION_STROOPS,
  TESTNET_NETWORK,
  ChameleonError,
  readContract,
} from './stellar';
import {
  Keypair,
  xdr,
  nativeToScVal,
  scValToNative,
  Address as StellarAddress,
} from '@stellar/stellar-sdk';
import { hexToField, fieldToHex } from './poseidon';

/** Path to the synced tree state cache. */
const TREE_CACHE = path.join(process.cwd(), '.chameleon-tree.json');

/** Default contract ID (overridden by CHAMELEON_CONTRACT_ID env var). */
const CONTRACT_ID = process.env.CHAMELEON_CONTRACT_ID ?? '';

const program = new Command();

program
  .name('chameleon')
  .description('Chameleon — compliance-aware privacy pool CLI for Stellar')
  .version('0.1.0');

// ── keygen ────────────────────────────────────────────────────────────────────

program
  .command('keygen')
  .description('Generate a new deposit note (nullifier + secret + commitment)')
  .option('-o, --out <file>', 'Output note file path', 'my.note.json')
  .action((opts) => {
    const note = generateNote();
    saveNote(note, opts.out);
    console.log('=== Chameleon Note Generated ===');
    console.log(`Commitment:     ${note.commitment}`);
    console.log(`Nullifier hash: ${nullifierHash(note)}`);
    console.log('');
    console.log(`Note saved to: ${opts.out}`);
    console.log('');
    console.warn('⚠  WARNING: Keep this file safe and private!');
    console.warn('⚠  Losing the note means losing your 100 XLM. There is NO recovery.');
    console.warn('⚠  Never share your nullifier or secret with anyone.');
  });

// ── deposit ───────────────────────────────────────────────────────────────────

program
  .command('deposit')
  .description('Deposit 100 XLM using the commitment from a note file')
  .requiredOption('--note <file>', 'Path to note JSON file')
  .option('--secret <key>', 'Stellar secret key (or set STELLAR_SECRET env var)')
  .action(async (opts) => {
    const secret = opts.secret ?? process.env.STELLAR_SECRET;
    if (!secret) throw new ChameleonError('No secret key (--secret or STELLAR_SECRET)', 'MISSING_KEY');
    const contractId = CONTRACT_ID;
    if (!contractId) throw new ChameleonError('Set CHAMELEON_CONTRACT_ID env var', 'MISSING_CONTRACT');

    const note = loadNote(opts.note);
    const keypair = Keypair.fromSecret(secret);
    const server = makeServer();

    console.log(`Depositing 100 XLM for commitment: ${note.commitment}`);
    console.log(`From: ${keypair.publicKey()}`);

    const commitment = Buffer.from(note.commitment.slice(2), 'hex');
    const result = await invokeContract(server, keypair, contractId, 'deposit', [
      new StellarAddress(keypair.publicKey()).toScVal(),
      xdr.ScVal.scvBytes(commitment),
    ]);

    // Update note with tx hash
    // (we'd need to track tx hash from the response)
    console.log('Deposit submitted successfully!');
    console.log('Run `chameleon sync` to update your local Merkle tree.');
    saveNote(note, opts.note);
  });

// ── sync ──────────────────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Rebuild Merkle tree from on-chain deposit events')
  .option('--start-ledger <n>', 'Start ledger for event scan', '0')
  .action(async (opts) => {
    const contractId = CONTRACT_ID;
    if (!contractId) throw new ChameleonError('Set CHAMELEON_CONTRACT_ID env var', 'MISSING_CONTRACT');

    console.log('Syncing Merkle tree from on-chain deposits...');
    const deposits = await fetchDepositEvents(contractId, parseInt(opts.startLedger));

    const tree = new MerkleTree(TREE_DEPTH);
    for (const dep of deposits) {
      const leaf = hexToField(dep.commitment);
      tree.insert(leaf);
    }

    // Save tree state
    const state = tree.serialize();
    fs.writeFileSync(TREE_CACHE, JSON.stringify(state, null, 2));

    console.log(`Synced ${deposits.length} deposits.`);
    console.log(`Current root: ${fieldToHex(tree.getRoot())}`);
    console.log(`Tree cache: ${TREE_CACHE}`);
  });

// ── prove ─────────────────────────────────────────────────────────────────────

program
  .command('prove')
  .description('Generate a ZK withdrawal proof for a note')
  .requiredOption('--note <file>', 'Path to note JSON file')
  .requiredOption('--to <address>', 'Recipient Stellar address (G...)')
  .option('--relayer <address>', 'Relayer address (G...) — omit if no relayer')
  .option('--fee <stroops>', 'Fee in stroops (default: 0)', '0')
  .option('-o, --out <file>', 'Output proof file', 'proof.json')
  .action(async (opts) => {
    const note = loadNote(opts.note);
    const contractId = CONTRACT_ID;

    // Load synced tree
    if (!fs.existsSync(TREE_CACHE)) {
      throw new ChameleonError('Tree not synced. Run `chameleon sync` first.', 'NOT_SYNCED');
    }
    const treeState = JSON.parse(fs.readFileSync(TREE_CACHE, 'utf8'));
    const tree = MerkleTree.deserialize(treeState);

    // Find leaf index
    const commitment = hexToField(note.commitment);
    const leafIndex = tree.findLeafIndex(commitment);
    if (leafIndex === -1) {
      throw new ChameleonError(
        `Commitment not found in tree. Did you deposit and sync? (${note.commitment})`,
        'COMMITMENT_NOT_FOUND',
      );
    }

    // Generate Merkle path
    const merkleProof = tree.generateProof(leafIndex);

    // Query on-chain blacklist root via stellar CLI
    let blacklistRoot = '0x' + '0'.repeat(64);
    const blacklist: string[] = [];
    if (contractId) {
      try {
        const { execSync } = await import('child_process');
        const raw = execSync(
          `stellar contract invoke --id ${contractId} --source ${process.env.STELLAR_SECRET ?? 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'} --network testnet -- blacklist_root 2>/dev/null`,
          { encoding: 'utf8' },
        ).trim().replace(/['"]/g, '');
        if (raw && raw !== '0'.repeat(64)) {
          blacklistRoot = '0x' + raw;
          console.log(`On-chain blacklist root: ${blacklistRoot}`);
        }
      } catch { /* if query fails, use zero root */ }
    }

    const recipientField = addressToField(opts.to);
    const relayerField = opts.relayer ? addressToField(opts.relayer) : '0x' + '0'.repeat(64);
    const fee = BigInt(opts.fee);

    console.log(`Generating proof for leaf index ${leafIndex}...`);
    console.log(`Recipient: ${opts.to}`);
    console.log(`Fee: ${fee} stroops`);

    const proofData = await generateProofInCircuitDir({
      root: fieldToHex(merkleProof.root),
      note,
      merkleProof,
      recipientField,
      relayerField,
      fee,
      blacklistRoot,
      blacklist,
    });

    // Save proof to file
    const proofFile = {
      proof: proofData.proofBytes.toString('hex'),
      publicInputs: proofData.publicInputsBytes.toString('hex'),
      humanReadable: proofData.publicInputs,
      recipient: opts.to,
      relayer: opts.relayer ?? null,
      fee: opts.fee,
    };
    fs.writeFileSync(opts.out, JSON.stringify(proofFile, null, 2));

    console.log(`Proof generated and saved to: ${opts.out}`);
    console.log(`Public inputs: ${JSON.stringify(proofData.publicInputs, null, 2)}`);
  });

// ── withdraw ──────────────────────────────────────────────────────────────────

program
  .command('withdraw')
  .description('Submit a withdrawal using a generated proof')
  .requiredOption('--proof <file>', 'Path to proof JSON file')
  .requiredOption('--to <address>', 'Recipient Stellar address')
  .option('--relayer <address>', 'Relayer address (if applicable)')
  .option('--secret <key>', 'Stellar secret key (or STELLAR_SECRET env var)')
  .action(async (opts) => {
    const secret = opts.secret ?? process.env.STELLAR_SECRET;
    if (!secret) throw new ChameleonError('No secret key', 'MISSING_KEY');
    const contractId = CONTRACT_ID;
    if (!contractId) throw new ChameleonError('Set CHAMELEON_CONTRACT_ID env var', 'MISSING_CONTRACT');

    const proofFile = JSON.parse(fs.readFileSync(opts.proof, 'utf8'));
    const server = makeServer();
    const keypair = Keypair.fromSecret(secret);

    const pi = proofFile.humanReadable;
    const proofBytes = Buffer.from(proofFile.proof, 'hex');
    const publicInputsBytes = Buffer.from(proofFile.publicInputs, 'hex');

    const toAddress = new StellarAddress(opts.to);
    const relayerAddress = opts.relayer
      ? new StellarAddress(opts.relayer)
      : new StellarAddress(opts.to); // self-relayer if none

    const fee = BigInt(proofFile.fee ?? 0);

    console.log(`Withdrawing to: ${opts.to}`);
    console.log(`Fee: ${fee} stroops`);
    console.log(`Nullifier hash: ${pi.nullifierHash}`);

    const rootBytes = Buffer.from(pi.root.slice(2), 'hex');
    const nhBytes = Buffer.from(pi.nullifierHash.slice(2), 'hex');
    const blRootBytes = Buffer.from(pi.blacklistRoot.slice(2), 'hex');

    await invokeContract(server, keypair, contractId, 'withdraw', [
      xdr.ScVal.scvBytes(rootBytes),
      xdr.ScVal.scvBytes(nhBytes),
      toAddress.toScVal(),
      relayerAddress.toScVal(),
      nativeToScVal(fee, { type: 'i128' }),
      xdr.ScVal.scvBytes(blRootBytes),
      xdr.ScVal.scvBytes(proofBytes),
      xdr.ScVal.scvBytes(publicInputsBytes),
    ]);

    console.log('Withdrawal submitted successfully!');
    console.log(`${100 - Number(fee) / 1e7} XLM released to ${opts.to}`);
  });

// ── demo ─────────────────────────────────────────────────────────────────────

program
  .command('demo')
  .description('Run the full demo (happy path + blacklisted path)')
  .action(async () => {
    console.log('Run `bash scripts/demo.sh` for the full narrated demo.');
    process.exit(0);
  });

program.parseAsync(process.argv).catch(e => {
  if (e instanceof ChameleonError) {
    console.error(`[${e.code}] ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
