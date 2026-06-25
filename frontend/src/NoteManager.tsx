import React from 'react';
import { PAL, FONTS } from './types';
import { ForestBtn, WarnLine, Labeled, Mono } from './DepositCard';

export interface Note {
  nullifier: string;
  secret: string;
  commitment: string;
  depositTxHash?: string;
  leafIndex?: number;
}

interface Props {
  note: Note | null;
  onNoteLoaded: (note: Note) => void;
  onNoteSaved: () => void;
}

export const NoteManager: React.FC<Props> = ({ note, onNoteLoaded, onNoteSaved }) => {
  function handleSave() {
    if (!note) return;
    const blob = new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'chameleon.note.json'; a.click();
    URL.revokeObjectURL(url);
    onNoteSaved();
  }

  function handleLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Note;
        if (!parsed.nullifier || !parsed.secret || !parsed.commitment) {
          alert('Invalid note file: missing required fields.');
          return;
        }
        onNoteLoaded(parsed);
      } catch {
        alert('Could not parse note file.');
      }
    };
    reader.readAsText(file);
  }

  if (!note) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <p style={{ margin: 0, fontFamily: FONTS.sans, fontSize: 14, lineHeight: 1.65, color: PAL.creamDim }}>
          No note loaded. Generate one in the Deposit tab, or load an existing note file.
        </p>
        <label style={{ alignSelf: 'flex-start', display: 'block' }}>
          <ForestBtn variant="outline" onClick={() => {}}>Load Note from File</ForestBtn>
          <input type="file" accept=".json,.note.json" onChange={handleLoad} style={{ display: 'none' }} />
        </label>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <WarnLine>
        Your note holds your nullifier and secret. Losing it = losing 100 XLM. Store it offline; never share it.
      </WarnLine>
      <Labeled label="Commitment">
        <Mono>{note.commitment}</Mono>
      </Labeled>
      {note.leafIndex !== undefined && (
        <Labeled label="Leaf index">
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: PAL.creamDim }}>{note.leafIndex}</span>
        </Labeled>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <ForestBtn onClick={handleSave}>Save Note</ForestBtn>
        <label style={{ display: 'inline-block' }}>
          <ForestBtn variant="outline" onClick={() => {}}>Load Note</ForestBtn>
          <input type="file" accept=".json,.note.json" onChange={handleLoad} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
};
