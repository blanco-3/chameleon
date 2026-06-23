/**
 * NoteManager.tsx — Save/load Chameleon note files.
 *
 * WARNING: The note contains your nullifier and secret. If you lose the note,
 * you permanently lose access to your 100 XLM deposit. There is NO recovery mechanism.
 */

import React, { useState } from 'react';

export interface Note {
  nullifier: string;
  secret: string;
  commitment: string;
  depositTxHash?: string;
  leafIndex?: number;
}

interface NoteManagerProps {
  note: Note | null;
  onNoteLoaded: (note: Note) => void;
  onNoteSaved: () => void;
}

export const NoteManager: React.FC<NoteManagerProps> = ({ note, onNoteLoaded, onNoteSaved }) => {
  const [warning, setWarning] = useState(false);

  function handleSave() {
    if (!note) return;
    const json = JSON.stringify(note, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chameleon.note.json';
    a.click();
    URL.revokeObjectURL(url);
    onNoteSaved();
  }

  function handleLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Note;
        if (!parsed.nullifier || !parsed.secret || !parsed.commitment) {
          alert('Invalid note file: missing required fields.');
          return;
        }
        onNoteLoaded(parsed);
      } catch {
        alert('Could not parse note file. Make sure it is a valid JSON note.');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Note Manager</h3>

      {note && (
        <div style={styles.warningBox}>
          <strong>⚠ WARNING:</strong> Your note contains your private nullifier and secret.
          <br />
          <strong>Losing this note = losing your 100 XLM. There is NO recovery.</strong>
          <br />
          Store it securely offline. Never share it with anyone.
        </div>
      )}

      {note && (
        <div style={styles.noteInfo}>
          <p><strong>Commitment:</strong></p>
          <code style={styles.code}>{note.commitment}</code>
          {note.leafIndex !== undefined && (
            <p><strong>Leaf index:</strong> {note.leafIndex}</p>
          )}
          {note.depositTxHash && (
            <p><strong>Deposit Tx:</strong> <code>{note.depositTxHash.slice(0, 20)}...</code></p>
          )}
        </div>
      )}

      <div style={styles.buttons}>
        <button onClick={handleSave} disabled={!note} style={styles.btn}>
          Save Note to File
        </button>
        <label style={{ ...styles.btn, cursor: 'pointer', display: 'inline-block', textAlign: 'center' }}>
          Load Note from File
          <input type="file" accept=".json,.note.json" onChange={handleLoad} style={{ display: 'none' }} />
        </label>
      </div>

      {!note && (
        <p style={styles.hint}>No note loaded. Use the Deposit tab to generate a new note, or load an existing one.</p>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '16px', border: '1px solid #334155', borderRadius: '8px', marginBottom: '16px' },
  title: { margin: '0 0 12px', color: '#94a3b8' },
  warningBox: {
    background: '#7c2d12',
    border: '1px solid #ea580c',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '12px',
    fontSize: '14px',
    lineHeight: '1.5',
  },
  noteInfo: { marginBottom: '12px', fontSize: '13px' },
  code: { display: 'block', wordBreak: 'break-all', background: '#1e293b', padding: '6px', borderRadius: '4px', fontSize: '12px' },
  buttons: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  btn: {
    padding: '8px 16px',
    background: '#1e40af',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  hint: { color: '#64748b', fontSize: '13px', marginTop: '8px' },
};
