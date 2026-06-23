/**
 * DepositCard.tsx — Deposit 100 XLM into the Chameleon privacy pool.
 *
 * Flow:
 *   1. Generate a new note (nullifier + secret + commitment)
 *   2. Display strong save warning
 *   3. Submit deposit transaction
 */

import React, { useState } from 'react';
import { bn254 } from '@taceo/poseidon2';
import { Keypair, rpc as SorobanRpc, TransactionBuilder, Networks, Contract, BASE_FEE, xdr, nativeToScVal, Address } from '@stellar/stellar-sdk';
import type { Note } from './NoteManager';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';
const BN254_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const POW2_64 = 2n ** 64n;
const perm = bn254.t4.permutation;

function hash2(a: bigint, b: bigint): bigint {
  return perm([a % BN254_R, b % BN254_R, 0n, 2n * POW2_64])[0];
}

function randField(): bigint {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let v = 0n;
  for (const b of arr) v = (v << 8n) | BigInt(b);
  return v % BN254_R;
}

function fieldToHex(f: bigint): string {
  return '0x' + f.toString(16).padStart(64, '0');
}

function generateNote(): Note {
  const nullifier = randField();
  const secret = randField();
  const commitment = hash2(nullifier, secret);
  return {
    nullifier: fieldToHex(nullifier),
    secret: fieldToHex(secret),
    commitment: fieldToHex(commitment),
  };
}

interface DepositCardProps {
  onNoteGenerated: (note: Note) => void;
}

export const DepositCard: React.FC<DepositCardProps> = ({ onNoteGenerated }) => {
  const [secretKey, setSecretKey] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);

  function handleGenerateNote() {
    const n = generateNote();
    setNote(n);
    onNoteGenerated(n);
    setStatus('Note generated. SAVE IT NOW before depositing!');
  }

  async function handleDeposit() {
    if (!note) { setStatus('Generate a note first!'); return; }
    if (!secretKey) { setStatus('Enter your Stellar secret key.'); return; }
    if (!CONTRACT_ID) { setStatus('Set VITE_CONTRACT_ID in .env'); return; }

    setLoading(true);
    setStatus('Connecting to testnet...');

    try {
      const server = new SorobanRpc.Server(TESTNET_RPC);
      const keypair = Keypair.fromSecret(secretKey);
      const account = await server.getAccount(keypair.publicKey());

      const commitment = Buffer.from(note.commitment.slice(2), 'hex');
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call(
          'deposit',
          new Address(keypair.publicKey()).toScVal(),
          xdr.ScVal.scvBytes(commitment),
        ))
        .setTimeout(60)
        .build();

      setStatus('Simulating transaction...');
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
      assembled.sign(keypair);

      setStatus('Submitting deposit...');
      const send = await server.sendTransaction(assembled);
      if (send.status === 'ERROR') throw new Error(`Tx error: ${JSON.stringify(send)}`);

      setStatus(`Deposit submitted! Tx: ${send.hash.slice(0, 16)}... Sync the tree before proving.`);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.title}>Deposit 100 XLM</h2>

      {!note ? (
        <div>
          <p style={styles.hint}>
            First, generate a secret note. You MUST save this file — it is the only way to withdraw.
          </p>
          <button onClick={handleGenerateNote} style={styles.primaryBtn}>
            Generate Note
          </button>
        </div>
      ) : (
        <div style={styles.noteBox}>
          <div style={styles.warning}>
            ⚠ <strong>SAVE YOUR NOTE NOW!</strong> Losing it means losing 100 XLM permanently.
          </div>
          <p style={{ fontSize: 13 }}><strong>Commitment:</strong></p>
          <code style={styles.code}>{note.commitment}</code>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <label style={styles.label}>Stellar Secret Key (S...)</label>
        <input
          type="password"
          value={secretKey}
          onChange={e => setSecretKey(e.target.value)}
          placeholder="SXXXXXXXXXXXXXXXXXXXXXXX..."
          style={styles.input}
        />
      </div>

      <button
        onClick={handleDeposit}
        disabled={!note || loading}
        style={{ ...styles.primaryBtn, opacity: (!note || loading) ? 0.5 : 1, marginTop: 16 }}
      >
        {loading ? 'Processing...' : 'Deposit 100 XLM'}
      </button>

      {status && <p style={styles.status}>{status}</p>}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: { background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, margin: '0 auto 24px' },
  title: { margin: '0 0 16px', color: '#38bdf8' },
  hint: { color: '#94a3b8', fontSize: 14 },
  warning: { background: '#7c2d12', border: '1px solid #ea580c', borderRadius: 6, padding: 12, marginBottom: 12, fontSize: 13 },
  noteBox: { background: '#0f172a', borderRadius: 8, padding: 12 },
  code: { display: 'block', wordBreak: 'break-all', fontSize: 11, color: '#86efac', background: '#0f172a', padding: 8, borderRadius: 4 },
  label: { display: 'block', marginBottom: 6, fontSize: 13, color: '#94a3b8' },
  input: { width: '100%', padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' },
  primaryBtn: { padding: '10px 20px', background: '#1d4ed8', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  status: { marginTop: 12, fontSize: 13, color: '#94a3b8', wordBreak: 'break-word' },
};
