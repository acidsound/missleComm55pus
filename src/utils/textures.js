import * as THREE from 'three';
import { seeded } from './math.js';

// Procedurally generated textures (no external assets needed).

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const cache = {};

export function glowTexture() {
  return (cache.glow ??= canvasTex(128, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.15, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }));
}

export function smokeTexture() {
  return (cache.smoke ??= canvasTex(128, (g, s) => {
    const rng = seeded(42);
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * s * 0.2;
      const x = s / 2 + Math.cos(a) * d;
      const y = s / 2 + Math.sin(a) * d;
      const r = s * (0.12 + rng() * 0.22);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const al = 0.16 + rng() * 0.18;
      grd.addColorStop(0, `rgba(255,255,255,${al})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }));
}

export function sparkTexture() {
  return (cache.spark ??= canvasTex(64, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }));
}

export function flareTexture() {
  return (cache.flare ??= canvasTex(256, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.08, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    // anamorphic streak
    g.globalCompositeOperation = 'lighter';
    const lg = g.createLinearGradient(0, r, s, r);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(0, r - 2, s, 4);
    const lv = g.createLinearGradient(r, 0, r, s);
    lv.addColorStop(0, 'rgba(255,255,255,0)');
    lv.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    lv.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lv;
    g.fillRect(r - 1, 0, 2, s);
  }));
}

export function ringTexture() {
  return (cache.ring ??= canvasTex(128, (g, s) => {
    const r = s / 2;
    const grd = g.createRadialGradient(r, r, r * 0.55, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }));
}

export function reticleTexture() {
  return (cache.reticle ??= canvasTex(256, (g, s) => {
    const r = s / 2;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 6;
    g.shadowColor = 'white';
    g.shadowBlur = 10;
    // broken outer ring
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.25;
      g.beginPath();
      g.arc(r, r, r * 0.78, a, a + Math.PI / 2 - 0.5);
      g.stroke();
    }
    // ticks
    g.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      g.beginPath();
      g.moveTo(r + Math.cos(a) * r * 0.32, r + Math.sin(a) * r * 0.32);
      g.lineTo(r + Math.cos(a) * r * 0.55, r + Math.sin(a) * r * 0.55);
      g.stroke();
    }
    g.beginPath();
    g.arc(r, r, 6, 0, Math.PI * 2);
    g.fillStyle = 'white';
    g.fill();
  }));
}

export function crossTexture() {
  return (cache.cross ??= canvasTex(64, (g, s) => {
    g.strokeStyle = 'white';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.shadowColor = 'white';
    g.shadowBlur = 6;
    g.beginPath();
    g.moveTo(12, 12); g.lineTo(s - 12, s - 12);
    g.moveTo(s - 12, 12); g.lineTo(12, s - 12);
    g.stroke();
  }));
}
