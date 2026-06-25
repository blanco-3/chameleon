import React, { useRef, useState, useEffect, useMemo } from 'react';

const CHAM_PALETTES = [
  { body: '#5f9e44', belly: '#8cc265', dark: '#22381a' },
  { body: '#8f8a4c', belly: '#bcb673', dark: '#2c2a13' },
  { body: '#3f8757', belly: '#74b585', dark: '#142e1e' },
  { body: '#9c7e3c', belly: '#c7a85f', dark: '#2a2010' },
  { body: '#6b7f3a', belly: '#9aa75d', dark: '#23270f' },
];

const EYE = '#f3efe2';
const PUP = '#12140c';
const LW = 92;
const LH = 54;
const UP = 6;

type Pal = typeof CHAM_PALETTES[0];

function drawCham(ctx: CanvasRenderingContext2D, pal: Pal, frame: boolean) {
  ctx.clearRect(0, 0, LW * UP, LH * UP);
  ctx.save();
  ctx.scale(UP, UP);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const sw = frame ? 1 : -1;

  function leg(hx: number, hy: number, kx: number, ky: number, fx: number, fy: number) {
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(kx, ky, fx, fy);
    ctx.strokeStyle = pal.dark; ctx.lineWidth = 4.4; ctx.stroke();
    ctx.strokeStyle = pal.body; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.strokeStyle = pal.dark; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + 2.5, fy + 1.5);
    ctx.moveTo(fx, fy); ctx.lineTo(fx - 1.5, fy + 2);
    ctx.stroke();
  }

  // far legs
  leg(62, 31, 65, 38, 68 - sw * 2, 44);
  leg(45, 33, 48, 39, 50 + sw * 2, 44);

  // coiled tail
  const tailPts: [number, number][] = [];
  const cx = 22, cy = 39;
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const ang = -0.35 + t * 1.25 * Math.PI * 2;
    const r = 11 * (1 - t * 0.7);
    tailPts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  ctx.beginPath(); ctx.moveTo(34, 29);
  tailPts.forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.strokeStyle = pal.dark; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = pal.body; ctx.lineWidth = 3.2; ctx.stroke();

  // body path helper
  function bodyPath() {
    ctx.beginPath();
    ctx.moveTo(34, 26);
    ctx.bezierCurveTo(42, 14, 58, 14, 66, 18);
    ctx.bezierCurveTo(68, 14, 72, 12, 75, 17);
    ctx.bezierCurveTo(78, 19, 83, 22, 87, 25);
    ctx.lineTo(87.5, 27);
    ctx.bezierCurveTo(85, 29, 80, 29.4, 77, 29);
    ctx.bezierCurveTo(70, 32, 54, 35, 42, 34);
    ctx.bezierCurveTo(36, 33, 31, 30, 34, 26);
    ctx.closePath();
  }

  bodyPath(); ctx.fillStyle = pal.body; ctx.fill();

  ctx.save(); bodyPath(); ctx.clip();
  // belly highlight
  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.moveTo(34, 27); ctx.bezierCurveTo(48, 40, 74, 35, 86, 25);
  ctx.lineTo(90, 37); ctx.lineTo(30, 37); ctx.closePath(); ctx.fill();
  // stipple (engraving) on upper flank
  ctx.fillStyle = pal.dark;
  for (let gy = 14; gy < 33; gy += 2.4) {
    for (let gx = 34; gx < 86; gx += 2.4) {
      const off = (Math.round(gy / 2.4) % 2) * 1.2;
      const yline = 30 - (gx - 34) * 0.05;
      if (gy > yline - 1.5) continue;
      ctx.beginPath(); ctx.arc(gx + off, gy, 0.6, 0, 7); ctx.fill();
    }
  }
  ctx.restore();

  bodyPath(); ctx.strokeStyle = pal.dark; ctx.lineWidth = 1.7; ctx.stroke();

  // dorsal crest sawtooth
  ctx.fillStyle = pal.dark;
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    const x = 37 + t * 27;
    const y = 24 - Math.pow(t, 0.85) * 8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.4, y - 2.6); ctx.lineTo(x + 2.8, y); ctx.closePath(); ctx.fill();
  }

  // near legs (in front of body)
  leg(66, 32, 64, 39, 62 + sw * 2, 45);
  leg(47, 34, 44, 40, 42 - sw * 2, 45);

  // eye
  ctx.fillStyle = EYE; ctx.beginPath(); ctx.arc(80, 21, 3.1, 0, 7); ctx.fill();
  ctx.fillStyle = PUP; ctx.beginPath(); ctx.arc(80, 21, 1.45, 0, 7); ctx.fill();
  // mouth
  ctx.strokeStyle = pal.dark; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(87.5, 27); ctx.lineTo(78, 26); ctx.stroke();

  ctx.restore();
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function snapFrame(pal: Pal, frame: boolean): HTMLCanvasElement {
  const hi = document.createElement('canvas');
  hi.width = LW * UP; hi.height = LH * UP;
  drawCham(hi.getContext('2d')!, pal, frame);

  const lo = document.createElement('canvas');
  lo.width = LW; lo.height = LH;
  const lx = lo.getContext('2d')!;
  lx.imageSmoothingEnabled = true;
  lx.drawImage(hi, 0, 0, LW, LH);

  const id = lx.getImageData(0, 0, LW, LH);
  const d = id.data;
  const pal5 = [pal.dark, pal.body, pal.belly, EYE, PUP].map(hexToRgb);

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 115) { d[i + 3] = 0; continue; }
    let best = 0, bd = 1e9;
    for (let p = 0; p < pal5.length; p++) {
      const dr = d[i] - pal5[p][0];
      const dg = d[i + 1] - pal5[p][1];
      const db = d[i + 2] - pal5[p][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bd) { bd = dist; best = p; }
    }
    d[i] = pal5[best][0]; d[i + 1] = pal5[best][1]; d[i + 2] = pal5[best][2]; d[i + 3] = 255;
  }
  lx.putImageData(id, 0, 0);
  return lo;
}

export const PixelChameleon: React.FC<{ scale?: number }> = ({ scale = 6 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ci, setCi] = useState(0);
  const [frame, setFrame] = useState(false);
  const sprites = useMemo(() => [
    snapFrame(CHAM_PALETTES[ci], false),
    snapFrame(CHAM_PALETTES[ci], true),
  ], [ci]);

  useEffect(() => {
    const g = setInterval(() => setFrame(f => !f), 230);
    const c = setInterval(() => setCi(i => (i + 1) % CHAM_PALETTES.length), 3400);
    return () => { clearInterval(g); clearInterval(c); };
  }, []);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const x = cv.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    x.clearRect(0, 0, cv.width, cv.height);
    x.drawImage(sprites[frame ? 1 : 0], 0, 0, LW, LH, 0, 0, cv.width, cv.height);
  }, [frame, sprites]);

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <canvas
        ref={ref}
        width={LW * scale}
        height={LH * scale}
        style={{
          width: LW * scale,
          height: LH * scale,
          imageRendering: 'pixelated',
          animation: 'cham-bob 0.46s steps(2) infinite',
          filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.35))',
        }}
      />
    </div>
  );
};
