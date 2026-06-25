import React, { useState, useRef } from 'react';
import { PixelChameleon } from './PixelChameleon';
import { DepositCard } from './DepositCard';
import { WithdrawCard } from './WithdrawCard';
import { NoteManager, type Note } from './NoteManager';
import { type AppState, STATES, PAL, FONTS } from './types';
import { AppPage } from './AppPage';

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? 'CD4B6JWALP4F256PZXCSOQN4GIKIMVBSI7A4VMK7NXZVMRIUYK3TYP5V';
const PANEL = '#1b2418';
const CREAM = '#d9e1c4';
const CREAM_DIM = '#9fb088';
const STATE_ORDER: AppState[] = ['idle', 'connected', 'deposited', 'proving', 'withdrawn', 'blocked'];

type Tab = 'deposit' | 'withdraw' | 'note';

function PixelLogo() {
  const bars = [10, 20, 14, 26, 16, 30, 12, 22];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 32 }}>
      {bars.map((h, i) => (
        <span key={i} style={{ width: 5, height: h, background: CREAM, opacity: 0.92, display: 'block' }} />
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<'hero' | 'app'>('hero');
  const [appState, setAppState] = useState<AppState>('idle');
  const [tab, setTab] = useState<Tab>('deposit');
  const [note, setNote] = useState<Note | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const flowRef = useRef<HTMLDivElement>(null);

  if (view === 'app') return <AppPage onBack={() => setView('hero')} />;

  const glow = STATES[appState].c;

  function handleNoteGenerated(n: Note) {
    setNote(n);
    setNoteSaved(false);
  }

  function scrollToFlow() {
    flowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const ribbedPage: React.CSSProperties = {
    background: '#aab184',
    backgroundImage: 'repeating-linear-gradient(90deg, rgba(34,46,26,0.17) 0px, rgba(34,46,26,0.17) 1px, transparent 1px, transparent 5px)',
    minHeight: '100vh',
  };

  return (
    <div style={ribbedPage}>
      {/* ── Poster hero ── */}
      <section style={{ padding: '18px 20px', minHeight: '100vh' }}>
        <div style={{
          position: 'relative',
          height: 'calc(100vh - 36px)',
          minHeight: 560,
          background: PANEL,
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 4px)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: 'inset 0 0 120px rgba(0,0,0,0.45)',
        }}>
          {/* top-left: logo + couplet */}
          <div style={{ position: 'absolute', top: '7%', left: '4%', zIndex: 4 }}>
            <PixelLogo />
            <div style={{
              marginTop: 18, fontFamily: FONTS.chakra, fontSize: 13,
              fontWeight: 500, letterSpacing: '0.14em', lineHeight: 1.45, color: CREAM,
            }}>
              I AM EVERY COLOUR AT ONCE<br />SEE YOU IN THE NOISE
            </div>
          </div>

          {/* top-right: connection state label */}
          <div style={{
            position: 'absolute', top: '7%', right: '4%', zIndex: 4,
            fontFamily: FONTS.chakra, fontSize: 12, fontWeight: 600,
            letterSpacing: '0.18em', color: appState !== 'idle' ? glow : CREAM,
            transition: 'color 0.6s ease',
          }}>
            {appState !== 'idle' ? '[ CONNECTED ]' : '[ CONNECT ↓ ]'}
          </div>

          {/* center: animated pixel chameleon */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 2,
          }}>
            <div style={{
              position: 'absolute', width: '48%', height: '42%', borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(150,180,110,0.10) 0%, transparent 68%)',
              filter: 'blur(10px)',
            }} />
            <div style={{ position: 'relative', width: 'min(620px, 52vw)' }}>
              <PixelChameleon scale={6} />
            </div>
          </div>

          {/* bottom block: labels + giant wordmark clipped by panel edge */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4%', marginBottom: 10 }}>
              <div style={{ lineHeight: 1.25 }}>
                <div style={{ fontFamily: FONTS.chakra, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: CREAM }}>PRIVACY POOL</div>
                <div style={{ fontFamily: FONTS.chakra, fontSize: 12, fontWeight: 500, letterSpacing: '0.12em', color: CREAM_DIM }}>STELLAR — TESTNET</div>
              </div>
              <div style={{ lineHeight: 1.25, textAlign: 'right' }}>
                <div style={{ fontFamily: FONTS.chakra, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: CREAM }}>PRIVACY POOL</div>
                <div style={{ fontFamily: FONTS.chakra, fontSize: 12, fontWeight: 500, letterSpacing: '0.12em', color: CREAM_DIM }}>STELLAR — TESTNET</div>
              </div>
            </div>
            <div style={{ textAlign: 'center', overflow: 'hidden' }}>
              <div style={{
                fontFamily: FONTS.handjet,
                fontWeight: 800,
                fontVariationSettings: "'ELGR' 2, 'ELSH' 0",
                fontSize: 'clamp(82px, 15.2vw, 224px)',
                lineHeight: 0.74,
                letterSpacing: '0.005em',
                color: CREAM,
                whiteSpace: 'nowrap',
                marginBottom: '-0.1em',
              }}>
                CHAMELEON
              </div>
            </div>
          </div>

          {/* Launch App button — prominent CTA */}
          <button
            onClick={() => setView('app')}
            style={{
              position: 'absolute', left: '50%', bottom: 72,
              transform: 'translateX(-50%)', zIndex: 6,
              fontFamily: FONTS.chakra, fontSize: 13, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              padding: '14px 34px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: PAL.sand, color: '#141a12',
              boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
              whiteSpace: 'nowrap',
            }}
          >
            Launch App →
          </button>

          {/* scroll badge: state dot, click → scroll to design section */}
          <button
            onClick={scrollToFlow}
            title="See states"
            style={{
              position: 'absolute', left: '50%', bottom: 14,
              transform: 'translateX(-50%)', zIndex: 6,
              width: 46, height: 46, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: '#1f1c18', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: glow,
              boxShadow: `0 0 10px ${glow}`,
              animation: appState === 'proving' ? 'cham-pulse 1.1s ease-in-out infinite' : 'none',
              transition: 'background 0.6s ease, box-shadow 0.6s ease',
            }} />
          </button>
        </div>
      </section>

      {/* ── Lower dark panel ── */}
      <div ref={flowRef} style={{ padding: '0 20px 22px' }}>
        <div style={{ background: PAL.bg, borderRadius: 8, overflow: 'hidden' }}>

          {/* States strip */}
          <section style={{ padding: '72px 6% 60px' }}>
            <div style={{ fontFamily: FONTS.sans, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', color: PAL.muted, fontWeight: 600 }}>
              The tell
            </div>
            <h2 style={{ fontFamily: FONTS.serif, fontWeight: 500, fontStyle: 'italic', color: CREAM, fontSize: 'clamp(26px,3.2vw,42px)', margin: '12px 0 6px' }}>
              The chameleon shows its state.
            </h2>
            <p style={{ fontFamily: FONTS.sans, fontSize: 14, color: CREAM_DIM, maxWidth: 440, margin: '0 0 40px', lineHeight: 1.6 }}>
              Every step in the pool gives the creature a new colour. Hover a state to preview it.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', borderTop: `1px solid ${PAL.line}` }}>
              {STATE_ORDER.map((s, i) => (
                <div
                  key={s}
                  onMouseEnter={() => setAppState(s)}
                  style={{
                    padding: '24px 16px 28px',
                    borderRight: i < 5 ? `1px solid ${PAL.line}` : 'none',
                    cursor: 'pointer',
                    background: appState === s ? 'rgba(168,148,116,0.06)' : 'transparent',
                    transition: 'background 0.3s ease',
                  }}
                >
                  <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: PAL.muted }}>0{i + 1}</div>
                  <span style={{
                    display: 'block', width: 9, height: 9, borderRadius: '50%',
                    background: STATES[s].c, boxShadow: `0 0 14px ${STATES[s].c}`,
                    margin: '18px 0 14px',
                  }} />
                  <div style={{ fontFamily: FONTS.serif, fontSize: 20, color: CREAM }}>{s}</div>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 11.5, color: CREAM_DIM, marginTop: 4 }}>{STATES[s].label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Flow section */}
          <section style={{
            padding: '24px 6% 96px',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
            gap: '6vw',
            alignItems: 'start',
            borderTop: `1px solid ${PAL.line}`,
          }}>
            {/* Sticky left intro */}
            <div style={{ position: 'sticky', top: 40 }}>
              <div style={{ fontFamily: FONTS.sans, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', color: PAL.muted, fontWeight: 600 }}>
                Move through the pool
              </div>
              <h2 style={{ fontFamily: FONTS.serif, fontWeight: 500, color: CREAM, fontSize: 'clamp(32px, 4vw, 56px)', lineHeight: 1.04, margin: '14px 0 0' }}>
                Deposit. Prove.{' '}
                <span style={{ fontStyle: 'italic', color: PAL.sand }}>Vanish.</span>
              </h2>
              <p style={{ fontFamily: FONTS.sans, fontSize: 14.5, lineHeight: 1.7, color: CREAM_DIM, maxWidth: 380, margin: '24px 0 0' }}>
                A fixed 100 XLM denomination and a zero-knowledge compliance proof. Your withdrawal proves you are not on the blacklist — without revealing which deposit is yours.
              </p>
              <div style={{
                marginTop: 32, paddingTop: 22, borderTop: `1px solid ${PAL.line}`,
                fontFamily: FONTS.mono, fontSize: 11, color: PAL.muted, lineHeight: 1.9,
              }}>
                <div style={{ letterSpacing: '0.16em', textTransform: 'uppercase', color: PAL.sand, marginBottom: 8, fontFamily: FONTS.sans, fontSize: 10 }}>
                  Pool contract
                </div>
                {CONTRACT_ID.slice(0, 28)}<br />{CONTRACT_ID.slice(28)}
              </div>
            </div>

            {/* Right: tab panel */}
            <div style={{
              border: `1px solid ${PAL.line}`,
              background: `linear-gradient(180deg, ${PAL.surface} 0%, ${PAL.bg2} 100%)`,
              padding: '34px 36px 38px',
              borderRadius: 2,
            }}>
              {/* Tab rail */}
              <div style={{ display: 'flex', gap: 30, borderBottom: `1px solid ${PAL.line}`, marginBottom: 30 }}>
                {(['deposit', 'withdraw', 'note'] as Tab[]).map((v, i) => (
                  <button
                    key={v}
                    onClick={() => setTab(v)}
                    style={{
                      background: 'none', border: 'none', padding: '0 0 16px',
                      cursor: 'pointer', fontFamily: FONTS.sans, fontSize: 12,
                      letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 600,
                      color: tab === v ? CREAM : PAL.muted,
                      borderBottom: `1px solid ${tab === v ? PAL.sand : 'transparent'}`,
                      marginBottom: -1, transition: 'color 0.2s ease',
                    }}
                  >
                    <span style={{ color: PAL.sand, marginRight: 8 }}>0{i + 1}</span>
                    {v === 'deposit' ? 'Deposit' : v === 'withdraw' ? 'Withdraw' : 'Note'}
                  </button>
                ))}
              </div>

              {tab === 'deposit' && (
                <DepositCard
                  onNoteGenerated={handleNoteGenerated}
                  onStateChange={setAppState}
                />
              )}
              {tab === 'withdraw' && (
                <WithdrawCard
                  note={note}
                  onStateChange={setAppState}
                />
              )}
              {tab === 'note' && (
                <NoteManager
                  note={note}
                  onNoteLoaded={n => { setNote(n); setNoteSaved(true); }}
                  onNoteSaved={() => setNoteSaved(true)}
                />
              )}

              {/* unsaved note reminder inside panel */}
              {note && !noteSaved && tab !== 'note' && (
                <div style={{
                  marginTop: 24, padding: '11px 14px',
                  background: PAL.warnBg, border: `1px solid ${PAL.warnLine}`,
                  borderRadius: 2, display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <span style={{ color: PAL.sand, fontSize: 13 }}>—</span>
                  <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: CREAM }}>
                    Note unsaved.{' '}
                    <button onClick={() => setTab('note')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PAL.sand, fontFamily: FONTS.sans, fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                      Save it now.
                    </button>
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ padding: '10px 6% 50px', display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, fontFamily: FONTS.handjet, fontWeight: 700, fontSize: 30, color: '#3c4a2e', letterSpacing: '0.02em' }}>
          SEE YOU IN THE NOISE
        </div>
        <div style={{ fontFamily: FONTS.chakra, fontSize: 11, fontWeight: 500, letterSpacing: '0.16em', color: '#58623f', textAlign: 'right', lineHeight: 1.9 }}>
          CHAMELEON<br />
          STELLAR TESTNET · NOT AUDITED<br />
          NOIR ULTRAHONK · SOROBAN
        </div>
      </footer>
    </div>
  );
}
