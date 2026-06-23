/**
 * App.tsx — Chameleon Privacy Pool frontend.
 *
 * Minimal React UI with three tabs:
 *   - Deposit: Generate note and deposit 100 XLM
 *   - Withdraw: Load note, generate proof (via CLI), submit withdrawal
 *   - Note: Save/load note files with safety warnings
 *
 * Network: Stellar Testnet.
 * Set VITE_CONTRACT_ID in .env to the deployed PrivacyPool contract address.
 */

import React, { useState } from 'react';
import { DepositCard } from './DepositCard';
import { WithdrawCard } from './WithdrawCard';
import { NoteManager, type Note } from './NoteManager';

type Tab = 'deposit' | 'withdraw' | 'note';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('deposit');
  const [note, setNote] = useState<Note | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  function handleNoteGenerated(n: Note) {
    setNote(n);
    setNoteSaved(false);
    setActiveTab('note'); // force user to see save warning
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={{ fontSize: 28 }}>🦎</span>
          <span style={styles.logoText}>Chameleon</span>
        </div>
        <span style={styles.tagline}>Compliance-aware privacy pool on Stellar</span>
        <span style={styles.network}>Testnet</span>
      </header>

      {/* Warning banner */}
      {note && !noteSaved && (
        <div style={styles.globalWarning}>
          ⚠ You have an unsaved note! Save it immediately — losing the note means losing 100 XLM permanently.
          <button onClick={() => setActiveTab('note')} style={styles.warnBtn}>Save Note</button>
        </div>
      )}

      {/* Tabs */}
      <nav style={styles.tabs}>
        {(['deposit', 'withdraw', 'note'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.activeTab : {}),
            }}
          >
            {tab === 'deposit' ? '⬇ Deposit' : tab === 'withdraw' ? '⬆ Withdraw' : '🗝 Note'}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={styles.main}>
        {activeTab === 'deposit' && (
          <DepositCard onNoteGenerated={handleNoteGenerated} />
        )}
        {activeTab === 'withdraw' && (
          <WithdrawCard note={note} />
        )}
        {activeTab === 'note' && (
          <NoteManager
            note={note}
            onNoteLoaded={n => { setNote(n); setNoteSaved(true); }}
            onNoteSaved={() => setNoteSaved(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>Chameleon — Hackathon demo on Stellar Testnet. Not audited. Do not use for real funds.</p>
        <p style={{ fontSize: 11 }}>
          ZK proof: Noir UltraHonk | Contract: Soroban | Verifier: rs-soroban-ultrahonk (mock for demo)
        </p>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', color: '#e2e8f0' },
  header: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px',
    borderBottom: '1px solid #1e293b', background: '#0f172a',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoText: { fontSize: 22, fontWeight: 700, color: '#38bdf8' },
  tagline: { flex: 1, fontSize: 13, color: '#64748b' },
  network: { padding: '3px 10px', background: '#1e40af', borderRadius: 12, fontSize: 11, fontWeight: 600 },
  globalWarning: {
    background: '#7c2d12', padding: '10px 24px', fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #ea580c',
  },
  warnBtn: { padding: '4px 12px', background: '#ea580c', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer', fontSize: 12 },
  tabs: { display: 'flex', padding: '0 24px', borderBottom: '1px solid #1e293b', background: '#0f172a' },
  tab: { padding: '12px 20px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, borderBottom: '2px solid transparent' },
  activeTab: { color: '#38bdf8', borderBottom: '2px solid #38bdf8' },
  main: { flex: 1, padding: 24, maxWidth: 800, width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  footer: { padding: '16px 24px', borderTop: '1px solid #1e293b', color: '#475569', fontSize: 12, textAlign: 'center' },
};
