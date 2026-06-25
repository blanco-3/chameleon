/**
 * AppPage.tsx — Functional app page (launched from the hero).
 * Clear step-by-step UI with prominent TX hash display.
 */
import React, { useState, useRef } from 'react';
import { bn254 } from '@taceo/poseidon2';
import {
  rpc as SorobanRpc, TransactionBuilder, Transaction,
  Networks, Contract, BASE_FEE, xdr, nativeToScVal, Address,
} from '@stellar/stellar-sdk';
import { getAddress, signTransaction } from '@stellar/freighter-api';
import { PAL, FONTS, STATES, type AppState } from './types';
import type { Note } from './NoteManager';

const TESTNET_RPC   = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID   = import.meta.env.VITE_CONTRACT_ID ?? '';
const EXPLORER_BASE = 'https://stellar.expert/explorer/testnet/tx/';

const BN254_R = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const POW2_64 = 2n ** 64n;
const perm    = bn254.t4.permutation;

function hash2(a: bigint, b: bigint) { return perm([a % BN254_R, b % BN254_R, 0n, 2n * POW2_64])[0]; }
function randField() {
  const arr = new Uint8Array(32); crypto.getRandomValues(arr);
  let v = 0n; for (const b of arr) v = (v << 8n) | BigInt(b); return v % BN254_R;
}
function toHex(f: bigint) { return '0x' + f.toString(16).padStart(64, '0'); }

const C = '#d9e1c4';    // cream
const DIM = '#9fb088';  // cream-dim

/* ── small shared UI ── */
function Step({ n, title, done, children }: { n: string; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${PAL.line}`, paddingTop: 32, marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 22 }}>
        <span style={{
          fontFamily: FONTS.chakra, fontSize: 11, letterSpacing: '0.3em',
          color: done ? '#74c79a' : PAL.sand, fontWeight: 700,
        }}>
          {done ? '✓' : n}
        </span>
        <span style={{ fontFamily: FONTS.serif, fontSize: 24, fontWeight: 500, color: C }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        fontFamily: FONTS.sans, fontSize: 13, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        padding: '14px 28px', borderRadius: 4, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: danger
          ? (h ? '#b54a3e' : '#9b3d32')
          : (h && !disabled ? '#c4d69c' : PAL.sand),
        color: '#141a12',
        transition: 'all 0.18s ease',
      }}
    >
      {children}
    </button>
  );
}

function OutlineBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        fontFamily: FONTS.sans, fontSize: 13, fontWeight: 600,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        padding: '14px 28px', borderRadius: 4,
        border: `1px solid ${PAL.lineStrong}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: h && !disabled ? 'rgba(166,187,122,0.08)' : 'transparent',
        color: PAL.sand,
        transition: 'all 0.18s ease',
      }}
    >
      {children}
    </button>
  );
}

function TxHash({ hash, label }: { hash: string; label?: string }) {
  return (
    <div style={{
      marginTop: 16, padding: '18px 20px',
      background: 'rgba(116,199,154,0.08)',
      border: '1px solid rgba(116,199,154,0.35)',
      borderRadius: 6,
    }}>
      <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#74c79a', marginBottom: 10 }}>
        {label ?? '✓ Transaction confirmed'}
      </div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: C, wordBreak: 'break-all', marginBottom: 10 }}>
        {hash}
      </div>
      <a
        href={`${EXPLORER_BASE}${hash}`}
        target="_blank"
        rel="noreferrer"
        style={{ fontFamily: FONTS.sans, fontSize: 11, color: '#74c79a', letterSpacing: '0.1em' }}
      >
        View on Stellar Expert →
      </a>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ marginTop: 14, padding: '14px 18px', background: 'rgba(217,138,130,0.10)', border: '1px solid rgba(217,138,130,0.35)', borderRadius: 6, fontFamily: FONTS.sans, fontSize: 13, color: '#d98a82', lineHeight: 1.55, wordBreak: 'break-word' }}>
      {msg}
    </div>
  );
}

function Commitment({ value }: { value: string }) {
  return (
    <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: DIM, background: PAL.bg2, border: `1px solid ${PAL.line}`, borderRadius: 4, padding: '12px 14px', wordBreak: 'break-all', lineHeight: 1.6 }}>
      {value}
    </div>
  );
}

function WalletChip({ address, onConnect }: { address: string; onConnect: () => void }) {
  if (address) return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: PAL.surface, border: `1px solid ${PAL.lineStrong}`, borderRadius: 4 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6fb8d6', boxShadow: '0 0 8px #6fb8d6', display: 'inline-block' }} />
      <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: DIM }}>{address.slice(0, 6)}…{address.slice(-6)}</span>
    </div>
  );
  return <OutlineBtn onClick={onConnect}>Connect Freighter</OutlineBtn>;
}

function StatusMsg({ msg }: { msg: string }) {
  return <p style={{ margin: '12px 0 0', fontFamily: FONTS.sans, fontSize: 13, color: PAL.sand, lineHeight: 1.55 }}>{msg}</p>;
}

/* ══════════════════════════════════════════════════════════════
   MAIN APP PAGE
══════════════════════════════════════════════════════════════ */
interface AppPageProps { onBack: () => void; }

export const AppPage: React.FC<AppPageProps> = ({ onBack }) => {
  const [appState, setAppState] = useState<AppState>('idle');
  const glow = STATES[appState].c;

  /* ── Note state ── */
  const [note, setNote]           = useState<Note | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteErr, setNoteErr]     = useState('');

  /* ── Deposit state ── */
  const [depWallet, setDepWallet]   = useState('');
  const [depStatus, setDepStatus]   = useState('');
  const [depErr, setDepErr]         = useState('');
  const [depTx, setDepTx]           = useState('');
  const [depLoading, setDepLoading] = useState(false);

  /* ── Withdraw state ── */
  const [wdNote, setWdNote]         = useState<Note | null>(null);
  const [recipient, setRecipient]   = useState('');
  const [wdWallet, setWdWallet]     = useState('');
  const [proofJson, setProofJson]   = useState('');
  const [proofLoaded, setProofLoaded] = useState(false);
  const [wdStep, setWdStep]         = useState<'setup' | 'proof' | 'done'>('setup');
  const [wdResult, setWdResult]     = useState<'withdrawn' | 'blocked' | null>(null);
  const [wdTx, setWdTx]             = useState('');
  const [wdStatus, setWdStatus]     = useState('');
  const [wdErr, setWdErr]           = useState('');
  const [wdLoading, setWdLoading]   = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Note Manager state ── */
  const [nmNote, setNmNote] = useState<Note | null>(null);
  const [nmSaved, setNmSaved] = useState(false);

  /* ─────────────────── DEPOSIT HANDLERS ─────────────────── */
  function generateNote() {
    const n = randField(), s = randField(), c = hash2(n, s);
    const newNote: Note = { nullifier: toHex(n), secret: toHex(s), commitment: toHex(c) };
    setNote(newNote); setNmNote(newNote); setWdNote(newNote);
    setNoteSaved(false); setNoteErr('');
  }

  async function connectDepWallet() {
    const r = await getAddress();
    if (r.error) { setDepErr(`Wallet error: ${r.error}`); return; }
    setDepWallet(r.address); setAppState('connected'); setDepErr('');
  }

  async function deposit() {
    if (!note) { setDepErr('Generate a note first.'); return; }
    if (!depWallet) { setDepErr('Connect wallet first.'); return; }
    if (!CONTRACT_ID) { setDepErr('VITE_CONTRACT_ID not set.'); return; }
    setDepLoading(true); setDepErr(''); setDepStatus('Connecting to testnet…');
    try {
      const server  = new SorobanRpc.Server(TESTNET_RPC);
      const account = await server.getAccount(depWallet);
      const commitment = Buffer.from(note.commitment.slice(2), 'hex');
      const contract   = new Contract(CONTRACT_ID);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('deposit', new Address(depWallet).toScVal(), xdr.ScVal.scvBytes(commitment)))
        .setTimeout(60).build();
      setDepStatus('Simulating…');
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
      setDepStatus('Waiting for Freighter signature…');
      const signed = await signTransaction(assembled.toXDR(), { networkPassphrase: Networks.TESTNET });
      if (signed.error) throw new Error(signed.error);
      setDepStatus('Submitting…');
      const send = await server.sendTransaction(new Transaction(signed.signedTxXdr, Networks.TESTNET));
      if (send.status === 'ERROR') throw new Error(JSON.stringify(send));
      setDepTx(send.hash); setAppState('deposited'); setDepStatus('');
    } catch (e) { setDepErr((e as Error).message); setDepStatus(''); }
    finally { setDepLoading(false); }
  }

  /* ─────────────────── WITHDRAW HANDLERS ─────────────────── */
  async function connectWdWallet() {
    const r = await getAddress();
    if (r.error) { setWdErr(`Wallet error: ${r.error}`); return; }
    setWdWallet(r.address);
    if (!recipient) setRecipient(r.address);
    setWdErr('');
  }

  function readProofFile(file: File) {
    const reader = new FileReader();
    reader.onload = ev => {
      setProofJson(ev.target?.result as string);
      setProofLoaded(true); setWdStatus(`Loaded: ${file.name}`);
    };
    reader.readAsText(file);
  }

  async function withdraw() {
    if (!proofJson) { setWdErr('Upload proof.json first.'); return; }
    if (!wdWallet)  { setWdErr('Connect wallet first.'); return; }
    if (!recipient) { setWdErr('Enter recipient address.'); return; }
    if (!CONTRACT_ID) { setWdErr('VITE_CONTRACT_ID not set.'); return; }
    setWdLoading(true); setWdErr(''); onStateChange('proving');
    setWdStatus('Preparing withdrawal…');
    try {
      const proof = JSON.parse(proofJson);
      const pi    = proof.humanReadable;
      const server  = new SorobanRpc.Server(TESTNET_RPC);
      const account = await server.getAccount(wdWallet);
      const contract  = new Contract(CONTRACT_ID);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('withdraw',
          xdr.ScVal.scvBytes(Buffer.from(pi.root.slice(2), 'hex')),
          xdr.ScVal.scvBytes(Buffer.from(pi.nullifierHash.slice(2), 'hex')),
          new Address(recipient).toScVal(),
          new Address(wdWallet).toScVal(),
          nativeToScVal(BigInt(proof.fee ?? 0), { type: 'i128' }),
          xdr.ScVal.scvBytes(Buffer.from(pi.blacklistRoot.slice(2), 'hex')),
          xdr.ScVal.scvBytes(Buffer.from(proof.proof, 'hex')),
          xdr.ScVal.scvBytes(Buffer.from(proof.publicInputs, 'hex')),
        )).setTimeout(60).build();
      setWdStatus('Simulating…');
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
      setWdStatus('Waiting for Freighter…');
      const signed = await signTransaction(assembled.toXDR(), { networkPassphrase: Networks.TESTNET });
      if (signed.error) throw new Error(signed.error);
      setWdStatus('Submitting…');
      const send = await server.sendTransaction(new Transaction(signed.signedTxXdr, Networks.TESTNET));
      if (send.status === 'ERROR') throw new Error(JSON.stringify(send));
      setWdTx(send.hash); setWdResult('withdrawn'); setWdStep('done'); setWdStatus('');
      onStateChange('withdrawn');
    } catch (e) {
      const msg = (e as Error).message;
      const blocked = msg.includes('StaleBlacklist') || msg.includes('InvalidProof') || msg.includes('#8)') || msg.includes('#9)');
      if (blocked) { setWdResult('blocked'); setWdStep('done'); onStateChange('blocked'); setWdStatus(''); }
      else { setWdErr(msg); onStateChange('connected'); setWdStatus(''); }
    }
    finally { setWdLoading(false); }
  }

  function onStateChange(s: AppState) { setAppState(s); }

  /* ─────────────────── NOTE MANAGER HANDLERS ─────────────────── */
  function saveNote(n: Note) {
    const blob = new Blob([JSON.stringify(n, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'chameleon.note.json'; a.click();
    URL.revokeObjectURL(url); setNmSaved(true);
  }

  function loadNoteFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Note;
        if (!parsed.nullifier || !parsed.secret || !parsed.commitment) { alert('Invalid note file.'); return; }
        setNmNote(parsed); setNote(parsed); setWdNote(parsed); setNmSaved(true);
      } catch { alert('Could not parse note file.'); }
    };
    reader.readAsText(file);
  }

  /* ═══════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: '100vh', background: PAL.bg }}>

      {/* ── Header bar ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 60,
        background: PAL.bg2, borderBottom: `1px solid ${PAL.line}`,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: 0 }}
        >
          <span style={{ fontFamily: FONTS.mono, fontSize: 14, color: PAL.sand }}>←</span>
          <span style={{ fontFamily: FONTS.chakra, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', color: C }}>CHAMELEON</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: glow, boxShadow: `0 0 10px ${glow}`, display: 'inline-block', transition: 'all 0.4s ease' }} />
          <span style={{ fontFamily: FONTS.sans, fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: DIM }}>
            {STATES[appState].label}
          </span>
        </div>
        <div style={{ fontFamily: FONTS.chakra, fontSize: 11, letterSpacing: '0.18em', color: PAL.muted }}>
          STELLAR TESTNET
        </div>
      </header>

      {/* ── Main content ── */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px 80px' }}>

        {/* Page title */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontFamily: FONTS.sans, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', color: PAL.muted, fontWeight: 600 }}>Privacy Pool</div>
          <h1 style={{ fontFamily: FONTS.serif, fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 500, color: C, margin: '10px 0 4px', lineHeight: 1.1 }}>
            Deposit. Prove. <span style={{ fontStyle: 'italic', color: PAL.sand }}>Vanish.</span>
          </h1>
          <p style={{ fontFamily: FONTS.sans, fontSize: 14, color: DIM, margin: 0, lineHeight: 1.6 }}>
            Fixed 100 XLM denomination · Zero-knowledge compliance proof · Stellar Testnet
          </p>
        </div>

        {/* ════════ STEP 1: Generate Note ════════ */}
        <Step n="01" title="Generate Note" done={!!note}>
          <p style={{ margin: '0 0 18px', fontFamily: FONTS.sans, fontSize: 14, color: DIM, lineHeight: 1.65 }}>
            Creates a cryptographic note (nullifier + secret → Poseidon2 commitment). This note is the only proof of your deposit — never share or lose it.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn onClick={generateNote}>{note ? 'Regenerate Note' : 'Generate Note'}</Btn>
            {note && <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: '#74c79a' }}>✓ Note ready</span>}
          </div>
          {note && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted, marginBottom: 8 }}>Commitment</div>
              <Commitment value={note.commitment} />
              {!noteSaved && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: PAL.warnBg, border: `1px solid ${PAL.warnLine}`, borderRadius: 4 }}>
                  <span style={{ color: PAL.sand }}>—</span>
                  <span style={{ fontFamily: FONTS.sans, fontSize: 12.5, color: C }}>
                    Save your note now — losing it means losing 100 XLM permanently.
                  </span>
                  <button
                    onClick={() => { if (note) { saveNote(note); setNoteSaved(true); } }}
                    style={{ marginLeft: 'auto', fontFamily: FONTS.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '8px 18px', background: PAL.sand, color: '#141a12', border: 'none', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Save Now
                  </button>
                </div>
              )}
              {noteSaved && <div style={{ marginTop: 10, fontFamily: FONTS.sans, fontSize: 12, color: '#74c79a' }}>✓ Note saved to file</div>}
            </div>
          )}
          {noteErr && <ErrorBox msg={noteErr} />}
        </Step>

        {/* ════════ STEP 2: Deposit 100 XLM ════════ */}
        <Step n="02" title="Deposit 100 XLM" done={!!depTx}>
          <p style={{ margin: '0 0 18px', fontFamily: FONTS.sans, fontSize: 14, color: DIM, lineHeight: 1.65 }}>
            Locks 100 XLM in the privacy pool and registers your commitment on-chain.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
            <WalletChip address={depWallet} onConnect={connectDepWallet} />
            <Btn onClick={deposit} disabled={!note || !depWallet || depLoading}>
              {depLoading ? 'Processing…' : 'Deposit 100 XLM'}
            </Btn>
          </div>
          {depStatus && <StatusMsg msg={depStatus} />}
          {depErr && <ErrorBox msg={depErr} />}
          {depTx && <TxHash hash={depTx} label="✓ Deposit confirmed" />}
        </Step>

        {/* ════════ STEP 3: Prove & Withdraw ════════ */}
        <Step n="03" title="Prove &amp; Withdraw" done={wdResult === 'withdrawn'}>
          <p style={{ margin: '0 0 20px', fontFamily: FONTS.sans, fontSize: 14, color: DIM, lineHeight: 1.65 }}>
            Generate a zero-knowledge proof off-chain using the CLI, then submit it here to withdraw 100 XLM to any address.
          </p>

          {wdStep === 'setup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ width: '100%' }}>
                <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted, marginBottom: 8 }}>
                  Recipient address
                </div>
                <input
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="GDEST…"
                  style={{ width: '100%', padding: '13px 16px', fontFamily: FONTS.mono, fontSize: 13, color: C, background: PAL.bg2, border: `1px solid ${PAL.line}`, borderRadius: 4, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <WalletChip address={wdWallet} onConnect={connectWdWallet} />
              <Btn onClick={() => setWdStep('proof')} disabled={!recipient}>Continue to Proof Upload</Btn>
            </div>
          )}

          {wdStep === 'proof' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start', width: '100%' }}>
              {/* CLI snippet */}
              <div style={{ width: '100%' }}>
                <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted, marginBottom: 8 }}>
                  Generate proof with the CLI
                </div>
                <pre style={{ margin: 0, fontFamily: FONTS.mono, fontSize: 12, color: DIM, background: PAL.bg2, border: `1px solid ${PAL.line}`, borderRadius: 4, padding: '14px 16px', overflowX: 'auto', lineHeight: 1.7 }}>
{`chameleon sync
chameleon prove \\
  --note chameleon.note.json \\
  --to ${recipient.slice(0,6) || 'GDEST'}… \\
  --out proof.json`}
                </pre>
              </div>

              {/* Drop zone */}
              <div style={{ width: '100%' }}>
                <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted, marginBottom: 8 }}>
                  Upload proof.json
                </div>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={e => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) readProofFile(f); }}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '28px 20px', textAlign: 'center',
                    border: `2px dashed ${proofLoaded ? '#74c79a' : isDragOver ? PAL.sandLt : PAL.lineStrong}`,
                    borderRadius: 6, cursor: 'pointer', background: PAL.bg2,
                    fontFamily: FONTS.sans, fontSize: 13, color: proofLoaded ? '#74c79a' : DIM,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) readProofFile(f); }} />
                  {proofLoaded ? '✓  proof.json loaded — ready to submit' : '⬆  Drop proof.json here or click to browse'}
                </div>
              </div>

              {/* Or paste */}
              <div style={{ width: '100%' }}>
                <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted, marginBottom: 8 }}>
                  Or paste JSON
                </div>
                <textarea
                  value={proofJson}
                  onChange={e => { setProofJson(e.target.value); setProofLoaded(e.target.value.trim().length > 0); }}
                  rows={4}
                  placeholder='{"proof":"…","publicInputs":"…","humanReadable":{…}}'
                  style={{ width: '100%', boxSizing: 'border-box', padding: '13px 16px', fontFamily: FONTS.mono, fontSize: 11, color: DIM, background: PAL.bg2, border: `1px solid ${PAL.line}`, borderRadius: 4, outline: 'none', resize: 'vertical' }}
                />
              </div>

              <WalletChip address={wdWallet} onConnect={connectWdWallet} />

              <div style={{ display: 'flex', gap: 12 }}>
                <Btn onClick={withdraw} disabled={!proofLoaded || !wdWallet || !recipient || wdLoading}>
                  {wdLoading ? 'Verifying proof…' : 'Submit Withdrawal'}
                </Btn>
                <OutlineBtn onClick={() => setWdStep('setup')}>← Back</OutlineBtn>
              </div>
              {wdStatus && <StatusMsg msg={wdStatus} />}
              {wdErr && <ErrorBox msg={wdErr} />}
            </div>
          )}

          {wdStep === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {wdResult === 'withdrawn' ? (
                <>
                  <div style={{ fontFamily: FONTS.serif, fontSize: 28, fontWeight: 500, color: '#74c79a', lineHeight: 1.2 }}>
                    100 XLM released to {recipient.slice(0, 6)}…{recipient.slice(-6)}.
                  </div>
                  <p style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 14, color: DIM }}>
                    The nullifier is spent on-chain. This note cannot be reused.
                  </p>
                  {wdTx && <TxHash hash={wdTx} label="✓ Withdrawal confirmed" />}
                </>
              ) : (
                <>
                  <div style={{ fontFamily: FONTS.serif, fontSize: 28, fontWeight: 500, color: '#d98a82', lineHeight: 1.2 }}>
                    Withdrawal blocked — proof rejected.
                  </div>
                  <p style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 14, color: DIM }}>
                    StaleBlacklist or InvalidProof. No funds moved.
                  </p>
                </>
              )}
              <OutlineBtn onClick={() => { setWdStep('setup'); setProofJson(''); setProofLoaded(false); setWdResult(null); setWdTx(''); setWdStatus(''); setWdErr(''); }}>
                Start over
              </OutlineBtn>
            </div>
          )}
        </Step>

        {/* ════════ NOTE MANAGER ════════ */}
        <Step n="—" title="Note Manager">
          <p style={{ margin: '0 0 18px', fontFamily: FONTS.sans, fontSize: 14, color: DIM, lineHeight: 1.65 }}>
            Save your note to a file for safekeeping, or load an existing note.
          </p>
          {nmNote ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted, marginBottom: 8 }}>Commitment</div>
                <Commitment value={nmNote.commitment} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <Btn onClick={() => { saveNote(nmNote); }}>Save to File</Btn>
                <label style={{ display: 'inline-block' }}>
                  <OutlineBtn onClick={() => {}}>Load from File</OutlineBtn>
                  <input type="file" accept=".json,.note.json" style={{ display: 'none' }} onChange={loadNoteFile} />
                </label>
              </div>
              {nmSaved && <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: '#74c79a' }}>✓ Saved</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
              <p style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 14, color: DIM }}>No note loaded. Generate one above or load a file.</p>
              <label style={{ display: 'inline-block' }}>
                <OutlineBtn onClick={() => {}}>Load Note from File</OutlineBtn>
                <input type="file" accept=".json,.note.json" style={{ display: 'none' }} onChange={loadNoteFile} />
              </label>
            </div>
          )}
        </Step>

      </main>
    </div>
  );
};
