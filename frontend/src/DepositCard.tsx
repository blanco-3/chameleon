import React, { useState } from 'react';
import { bn254 } from '@taceo/poseidon2';
import {
  rpc as SorobanRpc, TransactionBuilder, Transaction,
  Networks, Contract, BASE_FEE, xdr, Address,
} from '@stellar/stellar-sdk';
import { getAddress, signTransaction } from '@stellar/freighter-api';
import type { Note } from './NoteManager';
import type { AppState } from './types';
import { PAL, FONTS } from './types';

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
  return { nullifier: fieldToHex(nullifier), secret: fieldToHex(secret), commitment: fieldToHex(commitment) };
}

interface Props {
  onNoteGenerated: (note: Note) => void;
  onStateChange: (s: AppState) => void;
}

export const DepositCard: React.FC<Props> = ({ onNoteGenerated, onStateChange }) => {
  const [walletAddress, setWalletAddress] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(false);

  function handleGenerateNote() {
    const n = generateNote();
    setNote(n);
    onNoteGenerated(n);
    setStatus('Note generated — save it before depositing.');
  }

  async function handleConnectWallet() {
    setStatus('Connecting to Freighter...');
    const result = await getAddress();
    if (result.error) {
      setStatus(`Wallet error: ${result.error}`);
      return;
    }
    setWalletAddress(result.address);
    onStateChange('connected');
    setStatus('');
  }

  async function handleDeposit() {
    if (!note) { setStatus('Generate a note first.'); return; }
    if (!walletAddress) { setStatus('Connect your Freighter wallet first.'); return; }
    if (!CONTRACT_ID) { setStatus('Set VITE_CONTRACT_ID in .env'); return; }

    setLoading(true);
    setStatus('Connecting to testnet...');
    try {
      const server = new SorobanRpc.Server(TESTNET_RPC);
      const account = await server.getAccount(walletAddress);
      const commitment = Buffer.from(note.commitment.slice(2), 'hex');
      const contract = new Contract(CONTRACT_ID);

      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('deposit', new Address(walletAddress).toScVal(), xdr.ScVal.scvBytes(commitment)))
        .setTimeout(60)
        .build();

      setStatus('Simulating...');
      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);

      const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
      setStatus('Waiting for Freighter signature...');
      const signed = await signTransaction(assembled.toXDR(), { networkPassphrase: Networks.TESTNET });
      if (signed.error) throw new Error(`Signing failed: ${signed.error}`);

      setStatus('Submitting...');
      const signedTx = new Transaction(signed.signedTxXdr, Networks.TESTNET);
      const send = await server.sendTransaction(signedTx);
      if (send.status === 'ERROR') throw new Error(`Tx error: ${JSON.stringify(send)}`);

      onStateChange('deposited');
      setStatus(`Deposit submitted! Tx: ${send.hash.slice(0, 16)}… Sync the tree before proving.`);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const CREAM = '#d9e1c4';
  const SERIF = FONTS.serif;
  const SANS = FONTS.sans;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* denomination */}
      <div>
        <div style={{ fontFamily: SANS, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', color: PAL.muted, fontWeight: 600, marginBottom: 8 }}>
          fixed denomination
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 46, fontWeight: 500, color: CREAM, lineHeight: 1 }}>
          100 <span style={{ color: PAL.sand }}>XLM</span>
        </div>
      </div>

      {!note ? (
        <>
          <p style={{ margin: 0, fontFamily: SANS, fontSize: 14, lineHeight: 1.65, color: PAL.creamDim }}>
            Generate a secret note first. It holds your nullifier and secret — the only key to your deposit.
          </p>
          <ForestBtn onClick={handleGenerateNote}>Generate Note</ForestBtn>
        </>
      ) : (
        <>
          <WarnLine>Save your note now — losing it means losing 100 XLM, with no recovery.</WarnLine>
          <Labeled label="Commitment">
            <Mono>{note.commitment}</Mono>
          </Labeled>
          <WalletRow address={walletAddress} onConnect={handleConnectWallet} />
          <ForestBtn
            onClick={handleDeposit}
            disabled={!walletAddress || loading}
          >
            {loading ? 'Processing...' : 'Deposit 100 XLM'}
          </ForestBtn>
        </>
      )}

      {status && <StatusLine>{status}</StatusLine>}
    </div>
  );
};

/* ── Shared primitives (forest palette) ── */

export function ForestBtn({ children, onClick, disabled, variant = 'solid', style }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'solid' | 'outline';
  style?: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const base: React.CSSProperties = {
    fontFamily: FONTS.sans, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase',
    fontWeight: 600, padding: '14px 26px', borderRadius: 2,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'all 0.25s ease',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
    alignSelf: 'flex-start',
  };
  const varStyle: React.CSSProperties = variant === 'solid'
    ? { background: hover && !disabled ? PAL.sandLt : PAL.sand, color: '#1a150e' }
    : { background: hover && !disabled ? 'rgba(168,148,116,0.10)' : 'transparent', color: PAL.sand, border: `1px solid ${PAL.lineStrong}` };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...varStyle, ...style }}
    >
      {children}
    </button>
  );
}

export function WarnLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '13px 16px', background: PAL.warnBg, border: `1px solid ${PAL.warnLine}`, borderRadius: 2 }}>
      <span style={{ color: PAL.sand, fontSize: 13 }}>—</span>
      <span style={{ fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 1.55, color: '#d9e1c4' }}>{children}</span>
    </div>
  );
}

export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <span style={{ fontFamily: FONTS.sans, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: PAL.muted }}>{label}</span>
      {children}
    </div>
  );
}

export function Mono({ children, block }: { children: React.ReactNode; block?: boolean }) {
  const Tag = block ? 'pre' : 'div';
  return (
    <Tag style={{
      margin: 0, fontFamily: FONTS.mono, fontSize: 11, lineHeight: 1.6,
      color: PAL.creamDim, background: PAL.bg, border: `1px solid ${PAL.line}`,
      borderRadius: 2, padding: block ? '14px 16px' : '11px 14px',
      wordBreak: block ? 'normal' : 'break-all',
      whiteSpace: block ? 'pre' : 'normal',
      overflowX: block ? 'auto' : 'visible',
    }}>
      {children}
    </Tag>
  );
}

export function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 12, letterSpacing: '0.04em', color: PAL.sand, wordBreak: 'break-word' }}>
      {children}
    </p>
  );
}

export function WalletRow({ address, onConnect }: { address: string; onConnect: () => void }) {
  if (address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: FONTS.sans, fontSize: 12, color: PAL.creamDim }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: PAL.sand, display: 'inline-block' }} />
        <span style={{ fontFamily: FONTS.mono }}>{address.slice(0, 6)}…{address.slice(-6)}</span>
      </div>
    );
  }
  return <ForestBtn variant="outline" onClick={onConnect}>Connect Freighter</ForestBtn>;
}
