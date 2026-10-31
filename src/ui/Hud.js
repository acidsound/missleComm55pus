import * as THREE from 'three';
import { BATTERY_NAMES, AMMO_PER_BATTERY } from '../config.js';

// ---------------------------------------------------------------------------
// DOM HUD (desktop / mobile)
// ---------------------------------------------------------------------------
export class DomHud {
  constructor() {
    this.el = document.getElementById('hud');
    this.score = document.getElementById('hud-score');
    this.wave = document.getElementById('hud-wave');
    this.mult = document.getElementById('hud-mult');
    this.hi = document.getElementById('hud-hi');
    this.msg = document.getElementById('hud-message');
    this.sub = document.getElementById('hud-sub');
    this.bats = document.getElementById('hud-batteries');
    this.batEls = BATTERY_NAMES.map((n) => {
      const d = document.createElement('div');
      d.className = 'battery';
      d.innerHTML = `<div class="bname"><span>${n}</span><span class="cnt">10</span></div><div class="pips">${'<div class="pip"></div>'.repeat(AMMO_PER_BATTERY)}</div>`;
      this.bats.appendChild(d);
      return d;
    });
    this._last = {};
  }

  show(v) {
    this.el.classList.toggle('hidden', !v);
  }

  update(state) {
    const L = this._last;
    if (L.score !== state.score) this.score.textContent = state.score.toLocaleString();
    if (L.wave !== state.wave) this.wave.textContent = state.wave;
    if (L.mult !== state.multiplier) this.mult.textContent = `×${state.multiplier} POINTS`;
    if (L.hi !== state.hiScore) this.hi.textContent = state.hiScore.toLocaleString();
    Object.assign(L, { score: state.score, wave: state.wave, mult: state.multiplier, hi: state.hiScore });
    state.batteries.forEach((b, i) => {
      const key = `${b.alive}-${b.ammo}`;
      if (L['b' + i] === key) return;
      L['b' + i] = key;
      const el = this.batEls[i];
      el.classList.toggle('dead', !b.alive);
      el.classList.toggle('low', b.alive && b.ammo <= 3);
      el.querySelector('.cnt').textContent = b.alive ? (b.ammo === 0 ? 'OUT' : b.ammo) : 'DOWN';
      el.querySelectorAll('.pip').forEach((p, k) => p.classList.toggle('off', !b.alive || k >= b.ammo));
    });
  }

  message(text, sub = '') {
    if (text) {
      this.msg.textContent = text;
      this.msg.classList.add('show');
    } else this.msg.classList.remove('show');
    if (sub) {
      this.sub.textContent = sub;
      this.sub.classList.add('show');
    } else this.sub.classList.remove('show');
  }
}

// ---------------------------------------------------------------------------
// Canvas-backed world-space panels (VR HUD)
// ---------------------------------------------------------------------------
function makePanel(w, h, pxPerM = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * pxPerM);
  canvas.height = Math.round(h * pxPerM);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 40;
  return { canvas, ctx, tex, mesh };
}

const FONT = "'Orbitron', 'Share Tech Mono', monospace";

export class VrHud {
  constructor(scene, consoleAnchor, deckHeight) {
    // Console screen
    this.console = makePanel(1.3, 0.5, 512);
    this.console.mesh.position.copy(consoleAnchor).add(new THREE.Vector3(0, 0.035, 0));
    this.console.mesh.rotation.x = -Math.PI / 2 + 0.55;
    scene.add(this.console.mesh);

    // Floating message board
    this.board = makePanel(9, 3.2, 128);
    this.board.mesh.position.set(0, deckHeight + 4.2, -11);
    this.board.mesh.material.depthTest = false;
    this.board.mesh.visible = false;
    scene.add(this.board.mesh);
    this._key = '';
    this._msgKey = '';
  }

  update(state) {
    const key = JSON.stringify([state.score, state.wave, state.multiplier, state.hiScore, state.cities, state.batteries.map((b) => [b.alive, b.ammo])]);
    if (key === this._key) return;
    this._key = key;
    const { ctx, canvas, tex } = this.console;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(4,14,24,0.92)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(95,246,255,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = '#5ff6ff';
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText('SCORE', 30, 52);
    ctx.fillText('WAVE', W * 0.45, 52);
    ctx.fillText('HI', W * 0.72, 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 54px ${FONT}`;
    ctx.fillText(state.score.toLocaleString(), 30, 112);
    ctx.fillText(`${state.wave}`, W * 0.45, 112);
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(state.hiScore.toLocaleString(), W * 0.72, 108);
    ctx.fillStyle = '#ffb547';
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(`×${state.multiplier}`, W * 0.45 + 70, 108);

    // batteries
    const bw = (W - 80) / 3;
    state.batteries.forEach((b, i) => {
      const x = 30 + i * (bw + 10), y = 150;
      ctx.strokeStyle = b.alive ? 'rgba(95,246,255,0.6)' : 'rgba(255,74,61,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, bw, 90);
      ctx.fillStyle = b.alive ? '#5ff6ff' : '#ff4a3d';
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText(BATTERY_NAMES[i], x + 12, y + 30);
      ctx.textAlign = 'right';
      ctx.fillText(b.alive ? (b.ammo === 0 ? 'OUT' : String(b.ammo)) : 'DOWN', x + bw - 12, y + 30);
      ctx.textAlign = 'left';
      for (let k = 0; k < AMMO_PER_BATTERY; k++) {
        const on = b.alive && k < b.ammo;
        ctx.fillStyle = on ? (b.ammo <= 3 ? '#ffb547' : '#5ff6ff') : 'rgba(95,246,255,0.12)';
        ctx.fillRect(x + 12 + k * ((bw - 24) / AMMO_PER_BATTERY), y + 46, (bw - 24) / AMMO_PER_BATTERY - 5, 32);
      }
    });
    // cities
    ctx.fillStyle = '#5ff6ff';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText('CITIES', 30, 290);
    state.cities.forEach((alive, i) => {
      const x = 160 + i * 52;
      ctx.fillStyle = alive ? '#ffd08a' : 'rgba(255,74,61,0.5)';
      // little skyline glyph
      ctx.fillRect(x, 270, 10, 22);
      ctx.fillRect(x + 12, 262, 10, 30);
      ctx.fillRect(x + 24, 276, 10, 16);
    });
    ctx.fillStyle = 'rgba(223,249,255,0.5)';
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText('TRIGGER: LAUNCH  ·  GRIP: PAUSE', 30, H - 22);
    tex.needsUpdate = true;
  }

  message(text, sub = '') {
    const key = text + '|' + sub;
    if (key === this._msgKey) return;
    this._msgKey = key;
    const { ctx, canvas, tex, mesh } = this.board;
    if (!text && !sub) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255,100,40,0.9)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffffff';
    let size = 130;
    ctx.font = `900 ${size}px ${FONT}`;
    while (ctx.measureText(text).width > W * 0.92 && size > 40) {
      size -= 6;
      ctx.font = `900 ${size}px ${FONT}`;
    }
    ctx.fillText(text, W / 2, H * 0.32);
    if (sub) {
      ctx.shadowColor = 'rgba(255,181,71,0.9)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffb547';
      ctx.font = `700 44px ${FONT}`;
      sub.split('\n').forEach((line, i) => ctx.fillText(line, W / 2, H * 0.62 + i * 56));
    }
    tex.needsUpdate = true;
  }

  setVisible(v) {
    this.console.mesh.visible = v;
  }
}

// ---------------------------------------------------------------------------
// Floating world-space score popups
// ---------------------------------------------------------------------------
const textCache = new Map();
function textTexture(text, color) {
  const key = text + color;
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.font = `900 56px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 48);
  g.shadowBlur = 0;
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeText(text, 128, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textCache.set(key, t);
  return t;
}

export class FloatingTexts {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  spawn(pos, text, color = '#ffb547', scale = 1) {
    const mat = new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.renderOrder = 50;
    this.scene.add(s);
    this.items.push({ s, age: 0, life: 1.4, scale });
  }

  update(dt, camPos) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) {
        this.scene.remove(it.s);
        it.s.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.s.position.y += dt * 4;
      const d = camPos.distanceTo(it.s.position);
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - Math.min(0.2, (t - 0.15));
      const k = d * 0.06 * it.scale * pop;
      it.s.scale.set(k * 2.67, k, 1);
      it.s.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }
  }

  clear() {
    for (const it of this.items) {
      this.scene.remove(it.s);
      it.s.material.dispose();
    }
    this.items.length = 0;
  }
}
