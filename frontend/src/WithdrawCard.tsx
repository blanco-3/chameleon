/**
 * WithdrawCard.tsx — Withdraw 100 XLM from the Chameleon privacy pool.
 *
 * Flow:
 *   1. Load note file
 *   2. Enter recipient address
 *   3. Connect Freighter wallet
 *   4. Upload proof.json (drag & drop or file picker) or paste contents
 *   5. Submit withdrawal transaction (signed by Freighter)
 *
 * Note: Full proof generation (nargo + bb) cannot run in the browser.
 * The user generates proof.json with the CLI, then uploads or pastes it here.
 */

import React, { useState, useRef } from 'react';
import { rpc as SorobanRpc, Transaction, TransactionBuilder, Networks, Contract, BASE_FEE, xdr, nativeToScVal, Address } from '@stellar/stellar-sdk';
import { getAddress, signTransaction } from '@stellar/freighter-api';
import type { Note } from './NoteManager';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';

interface WithdrawCardProps {
  note: Note | null;
}

export const WithdrawCard: React.FC<WithdrawCardProps> = ({ note }) => {
  const [recipient, setRecipient] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [proofJson, setProofJson] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'setup' | 'proof-needed' | 'ready'>('setup');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleConnectWallet() {
    setStatus('Connecting to Freighter...');
    const result = await getAddress();
    if (result.error) {
      setStatus(`Wallet error: ${result.error}. Is Freighter installed?`);
      return;
    }
    setWalletAddress(result.address);
    if (!recipient) setRecipient(result.address);
    setStatus(`Connected: ${result.address}`);
  }

  function handleFileRead(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setProofJson(ev.target?.result as string);
      setStatus(`Loaded ${file.name}`);
    };
    reader.readAsText(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileRead(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }

  function handleGenerateProofInstructions() {
    if (!note) { setStatus('Load a note first.'); return; }
    if (!recipient) { setStatus('Enter a recipient address.'); return; }
    setStep('proof-needed');
    setStatus('Generate the proof with the CLI, then upload or paste proof.json below.');
  }

  async function handleWithdraw() {
    if (!proofJson) { setStatus('Upload or paste proof.json first.'); return; }
    if (!walletAddress) { setStatus('Connect your Freighter wallet first.'); return; }
    if (!CONTRACT_ID) { setStatus('Set VITE_CONTRACT_ID in .env'); return; }

    setLoading(true);
    setStatus('Preparing withdrawal...');

    try {
      const proof = JSON.parse(proofJson);
      const pi = proof.humanReadable;

      const server = new SorobanRpc.Server(TESTNET_RPC);
      const account = await server.getAccount(walletAddress);

      const contract = new Contract(CONTRACT_ID);
      const proofBytes = Buffer.from(proof.proof, 'hex');
      const piBytes = Buffer.from(proof.publicInputs, 'hex');
      const rootBytes = Buffer.from(pi.root.slice(2), 'hex');
      const nhBytes = Buffer.from(pi.nullifierHash.slice(2), 'hex');
      const blRootBytes = Buffer.from(pi.blacklistRoot.slice(2), 'hex');
      const fee = BigInt(proof.fee ?? 0);

      const recipientAddr = recipient;
      if (!recipientAddr) { setStatus('Enter a recipient address first.'); return; }
      const relayerAddr = walletAddress;

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call(
          'withdraw',
          xdr.ScVal.scvBytes(rootBytes),
          xdr.ScVal.scvBytes(nhBytes),
          new Address(recipientAddr).toScVal(),
          new Address(relayerAddr).toScVal(),
          nativeToScVal(fee, { type: 'i128' }),
          xdr.ScVal.scvBytes(blRootBytes),
          xdr.ScVal.scvBytes(proofBytes),
          xdr.ScVal.scvBytes(piBytes),
        ))
        .setTimeout(60)
        .build();

      setStatus('Simulating withdrawal...');
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      const assembled = SorobanRpc.assembleTransaction(tx, sim).build();

      setStatus('Waiting for Freighter signature...');
      const signed = await signTransaction(assembled.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      if (signed.error) throw new Error(`Freighter signing failed: ${signed.error}`);

      setStatus('Submitting withdrawal...');
      const signedTx = new Transaction(signed.signedTxXdr, Networks.TESTNET);
      const send = await server.sendTransaction(signedTx);
      if (send.status === 'ERROR') throw new Error(`Tx error: ${JSON.stringify(send)}`);

      setStatus(`Withdrawal submitted! Tx: ${send.hash.slice(0, 16)}... 100 XLM released to ${recipientAddr}`);
      setStep('setup');
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.title}>Withdraw 100 XLM</h2>

      {!note && (
        <p style={styles.hint}>Load your note file using the Note Manager tab first.</p>
      )}

      {note && step === 'setup' && (
        <div>
          <p style={styles.noteInfo}>
            <strong>Commitment:</strong> <code style={styles.code}>{note.commitment.slice(0, 20)}...</code>
          </p>
          <label style={styles.label}>Recipient Address</label>
          <input
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="GDEST..."
            style={styles.input}
          />

          <div style={{ marginTop: 12 }}>
            {walletAddress ? (
              <div style={styles.walletConnected}>
                <span style={{ color: '#4ade80' }}>✓ Connected:</span>{' '}
                <code style={{ fontSize: 12 }}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-6)}</code>
              </div>
            ) : (
              <button onClick={handleConnectWallet} style={styles.walletBtn}>
                🔗 Connect Freighter Wallet
              </button>
            )}
          </div>

          <button onClick={handleGenerateProofInstructions} style={{ ...styles.primaryBtn, marginTop: 12 }}>
            Continue to Proof Generation
          </button>
        </div>
      )}

      {note && step === 'proof-needed' && (
        <div>
          <div style={styles.infoBox}>
            <strong>Generate your proof with the CLI:</strong>
            <pre style={styles.pre}>{`# 1. Sync the tree
chameleon sync

# 2. Generate proof
chameleon prove \\
  --note your.note.json \\
  --to ${recipient} \\
  --out proof.json

# 3. Upload or paste proof.json below`}</pre>
          </div>

          <label style={styles.label}>Upload proof.json or paste contents below:</label>

          {/* Drag & drop / file picker */}
          <div
            style={{ ...styles.dropZone, ...(isDragOver ? styles.dropZoneActive : {}) }}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {proofJson
              ? <span style={{ color: '#4ade80' }}>✓ proof.json loaded</span>
              : <span>📁 Drop proof.json here or <u>click to browse</u></span>
            }
          </div>

          {/* Textarea paste fallback */}
          <textarea
            value={proofJson}
            onChange={e => setProofJson(e.target.value)}
            rows={5}
            placeholder='{"proof": "...", "publicInputs": "...", ...}'
            style={{ ...styles.input, fontFamily: 'monospace', fontSize: 11, marginTop: 8 }}
          />

          <div style={{ marginTop: 12 }}>
            {walletAddress ? (
              <div style={styles.walletConnected}>
                <span style={{ color: '#4ade80' }}>✓ Connected:</span>{' '}
                <code style={{ fontSize: 12 }}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-6)}</code>
              </div>
            ) : (
              <button onClick={handleConnectWallet} style={styles.walletBtn}>
                🔗 Connect Freighter Wallet
              </button>
            )}
          </div>

          <button
            onClick={handleWithdraw}
            disabled={!proofJson || !walletAddress || !recipient || loading}
            style={{ ...styles.primaryBtn, marginTop: 12, background: '#15803d', opacity: (!proofJson || !walletAddress || !recipient || loading) ? 0.5 : 1 }}
          >
            {loading ? 'Processing...' : 'Submit Withdrawal'}
          </button>
        </div>
      )}

      {status && <p style={styles.status}>{status}</p>}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: { background: '#1e293b', borderRadius: 12, padding: 24, maxWidth: 600, margin: '0 auto 24px' },
  title: { margin: '0 0 16px', color: '#4ade80' },
  hint: { color: '#64748b', fontSize: 14 },
  noteInfo: { fontSize: 13, color: '#94a3b8' },
  code: { fontSize: 11 },
  infoBox: { background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 },
  pre: { background: '#1e293b', padding: 8, borderRadius: 4, fontSize: 12, overflowX: 'auto' as const },
  label: { display: 'block', marginBottom: 6, fontSize: 13, color: '#94a3b8', marginTop: 8 },
  input: { width: '100%', padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' as const },
  dropZone: {
    border: '2px dashed #334155', borderRadius: 8, padding: '20px 16px',
    textAlign: 'center' as const, cursor: 'pointer', color: '#64748b', fontSize: 13,
    background: '#0f172a', transition: 'border-color 0.15s, color 0.15s',
  },
  dropZoneActive: { borderColor: '#38bdf8', color: '#38bdf8' },
  walletBtn: { padding: '10px 20px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  walletConnected: { background: '#0f172a', border: '1px solid #166534', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#94a3b8' },
  primaryBtn: { padding: '10px 20px', background: '#1d4ed8', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  status: { marginTop: 12, fontSize: 13, color: '#94a3b8', wordBreak: 'break-word' as const },
};
