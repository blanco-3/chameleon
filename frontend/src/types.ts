export type AppState = 'idle' | 'connected' | 'deposited' | 'proving' | 'withdrawn' | 'blocked';

export const STATES: Record<AppState, { c: string; label: string }> = {
  idle:      { c: '#7bbf8e', label: 'waiting' },
  connected: { c: '#6fb8d6', label: 'wallet connected' },
  deposited: { c: '#d6a85c', label: 'funds locked' },
  proving:   { c: '#b29bd6', label: 'generating proof' },
  withdrawn: { c: '#74c79a', label: 'released' },
  blocked:   { c: '#d98a82', label: 'proof rejected' },
};

export const PAL = {
  bg:          '#141a12',
  bg2:         '#192116',
  surface:     '#1d2619',
  sand:        '#a6bb7a',
  sandLt:      '#c4d69c',
  cream:       '#d9e1c4',
  creamDim:    '#9fb088',
  muted:       '#74815f',
  line:        'rgba(150,178,118,0.16)',
  lineStrong:  'rgba(150,178,118,0.34)',
  warnBg:      'rgba(166,187,122,0.08)',
  warnLine:    'rgba(166,187,122,0.32)',
};

export const FONTS = {
  handjet:  "'Handjet', monospace",
  chakra:   "'Chakra Petch', system-ui, sans-serif",
  serif:    "'Cormorant Garamond', Georgia, serif",
  sans:     "'Manrope', system-ui, sans-serif",
  mono:     'ui-monospace, Menlo, monospace',
};
