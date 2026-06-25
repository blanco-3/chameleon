import React, { useState, useRef } from 'react';
import {
  rpc as SorobanRpc, Transaction, TransactionBuilder,
  Networks, Contract, BASE_FEE, xdr, nativeToScVal, Address,
} from '@stellar/stellar-sdk';
import { getAddress, signTransaction } from '@stellar/freighter-api';
import type { Note } from './NoteManager';
import type { AppState } from './types';
import { PAL, FONTS } from './types';
import { ForestBtn, WarnLine, Labeled, Mono, StatusLine, WalletRow } from './DepositCard';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';

interface Props {
  note: Note | null;
  onStateChange: (s: AppState) => void;
}

export const WithdrawCard: React.FC<Props> = ({ note, onStateChange }) => {
  const [recipient, setRecipient] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [proofJson, setProofJson] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'setup' | 'proof' | 'done'>('setup');
  const [withdrawResult, setWithdrawResult] = useState<'withdrawn' | 'blocked' | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shorten = (s: string, a = 6, b = 4) => s ? `${s.slice(0, a)}…${s.slice(-b)}` : '';

  async function handleConnectWallet() {
    const result = await getAddress();
    if (result.error) { setStatus(`Wallet error: ${result.error}`); return; }
    setWalletAddress(result.address);
    if (!recipient) setRecipient(result.address);
    setStatus('');
    onStateChange('connected');
  }

  function handleFileRead(file: File) {
    const reader = new FileReader();
    reader.onload = ev => { setProofJson(ev.target?.result as string); setStatus(`Loaded ${file.name}`); };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files?.[0]; if (file) handleFileRead(file);
  }

  async function handleWithdraw() {
    if (!proofJson) { setStatus('Upload proof.json first.'); return; }
    if (!walletAddress) { setStatus('Connect your Freighter wallet first.'); return; }
    if (!recipient) { setStatus('Enter a recipient address first.'); return; }
    if (!CONTRACT_ID) { setStatus('Set VITE_CONTRACT_ID in .env'); return; }

    setLoading(true);
    onStateChange('proving');
    setStatus('Preparing withdrawal...');

    try {
      const proof = JSON.parse(proofJson);
      const pi = proof.humanReadable;

      const server = new SorobanRpc.Server(TESTNET_RPC);
      const account = await server.getAccount(walletAddress);
      const contract = new Contract(CONTRACT_ID);

      const proofBytes  = Buffer.from(proof.proof,        'hex');
      const piBytes     = Buffer.from(proof.publicInputs,  'hex');
      const rootBytes   = Buffer.from(pi.root.slice(2),           'hex');
      const nhBytes     = Buffer.from(pi.nullifierHash.slice(2),  'hex');
      const blRootBytes = Buffer.from(pi.blacklistRoot.slice(2),  'hex');
      const fee         = BigInt(proof.fee ?? 0);
      const relayerAddr = walletAddress;

      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call(
          'withdraw',
          xdr.ScVal.scvBytes(rootBytes),
          xdr.ScVal.scvBytes(nhBytes),
          new Address(recipient).toScVal(),
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
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);

      const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
      setStatus('Waiting for Freighter signature...');
      const signed = await signTransaction(assembled.toXDR(), { networkPassphrase: Networks.TESTNET });
      if (signed.error) throw new Error(`Signing failed: ${signed.error}`);

      setStatus('Submitting withdrawal...');
      const signedTx = new Transaction(signed.signedTxXdr, Networks.TESTNET);
      const send = await server.sendTransaction(signedTx);
      if (send.status === 'ERROR') throw new Error(`Tx error: ${JSON.stringify(send)}`);

      onStateChange('withdrawn');
      setWithdrawResult('withdrawn');
      setStep('done');
      setStatus(`Tx: ${send.hash.slice(0, 16)}…`);
    } catch (e) {
      const msg = (e as Error).message;
      const isBlocked = msg.includes('StaleBlacklist') || msg.includes('InvalidProof') || msg.includes('Error(Contract, #8)') || msg.includes('Error(Contract, #9)');
      if (isBlocked) {
        onStateChange('blocked');
        setWithdrawResult('blocked');
        setStep('done');
        setStatus('');
      } else {
        onStateChange('connected');
        setStatus(`Error: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setStep('setup'); setProofJson(''); setWithdrawResult(null);
    setStatus(''); onStateChange('connected');
  }

  const CREAM = '#d9e1c4';
  const SERIF = FONTS.serif;
  const SANS  = FONTS.sans;

  if (!note) {
    return (
      <p style={{ margin: 0, fontFamily: SANS, fontSize: 14, lineHeight: 1.65, color: PAL.creamDim }}>
        Load your note in the <span style={{ color: PAL.sand }}>Note</span> tab to withdraw.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* ── Setup step ── */}
      {step === 'setup' && (
        <>
          <Labeled label="Note commitment">
            <Mono>{shorten(note.commitment, 12, 10)}</Mono>
          </Labeled>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: SANS, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted }}>Recipient address</span>
            <input
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="GDEST…"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '13px 16px',
                fontFamily: FONTS.mono, fontSize: 13, color: CREAM,
                background: PAL.bg, border: `1px solid ${PAL.line}`,
                borderRadius: 2, outline: 'none',
              }}
            />
          </div>
          <WalletRow address={walletAddress} onConnect={handleConnectWallet} />
          <ForestBtn disabled={!recipient} onClick={() => { setStep('proof'); setStatus('Generate the proof with the CLI, then upload proof.json.'); }}>
            Continue to Proof
          </ForestBtn>
        </>
      )}

      {/* ── Proof step ── */}
      {step === 'proof' && (
        <>
          <Labeled label="Generate the proof with the CLI">
            <Mono block>{`chameleon sync\nchameleon prove \\\n  --note my.note.json \\\n  --to ${shorten(recipient, 6, 4)}`}</Mono>
          </Labeled>

          {/* drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `1px dashed ${proofJson ? PAL.sand : isDragOver ? PAL.sandLt : PAL.lineStrong}`,
              borderRadius: 2, padding: '22px', textAlign: 'center', cursor: 'pointer',
              fontFamily: SANS, fontSize: 12, letterSpacing: '0.08em',
              color: proofJson ? PAL.sand : PAL.muted,
              background: PAL.bg, transition: 'all 0.2s ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileRead(f); }}
            />
            {proofJson ? '✓  proof.json loaded' : 'Drop proof.json — or click to browse'}
          </div>

          {/* paste fallback */}
          <textarea
            value={proofJson}
            onChange={e => setProofJson(e.target.value)}
            rows={4}
            placeholder='{"proof":"…","publicInputs":"…"}'
            style={{
              width: '100%', boxSizing: 'border-box', padding: '13px 16px', resize: 'vertical',
              fontFamily: FONTS.mono, fontSize: 11, color: PAL.creamDim,
              background: PAL.bg, border: `1px solid ${PAL.line}`,
              borderRadius: 2, outline: 'none',
            }}
          />

          <WalletRow address={walletAddress} onConnect={handleConnectWallet} />

          <ForestBtn
            disabled={!proofJson || !walletAddress || !recipient || loading}
            onClick={handleWithdraw}
          >
            {loading ? 'Verifying…' : 'Submit Withdrawal'}
          </ForestBtn>
        </>
      )}

      {/* ── Done step ── */}
      {step === 'done' && (
        <>
          <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 500, lineHeight: 1.15, color: withdrawResult === 'withdrawn' ? CREAM : '#d98a82' }}>
            {withdrawResult === 'withdrawn'
              ? <>100 XLM released to <span style={{ color: PAL.sand }}>{shorten(recipient, 6, 4)}</span>.</>
              : 'Withdrawal blocked — the proof was rejected.'}
          </div>
          <p style={{ margin: 0, fontFamily: SANS, fontSize: 14, lineHeight: 1.65, color: PAL.creamDim }}>
            {withdrawResult === 'withdrawn'
              ? 'The nullifier is now spent on-chain; the note cannot be reused.'
              : 'The commitment matched a blacklist entry (StaleBlacklist / InvalidProof). No funds moved.'}
          </p>
          <ForestBtn variant="outline" onClick={handleReset}>Start over</ForestBtn>
          {status && <StatusLine>{status}</StatusLine>}
        </>
      )}

      {step !== 'done' && status && <StatusLine>{status}</StatusLine>}
    </div>
  );
};
