import * as THREE from 'three';

// Fully procedural audio: synthesised buffers + generative music bed.
// Spatialised through THREE.AudioListener so it tracks the XR headset.

export class AudioEngine {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.out = this.listener.getInput();
    this.buffers = {};
    this.ready = false;
    this.active = 0;
    this.musicGain = null;
  }

  async init() {
    if (this.ready) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const sr = this.ctx.sampleRate;
    this.buffers.boomBig = this._boom(sr, 4.0, 0.9, 38);
    this.buffers.boom = this._boom(sr, 2.6, 1.6, 55);
    this.buffers.pop = this._boom(sr, 1.4, 3.5, 90);
    this.buffers.launch = this._launch(sr);
    this.buffers.siren = this._siren(sr);
    this.buffers.beep = this._tone(sr, 0.09, 1320, 'sine', 0.5);
    this.buffers.tick = this._tone(sr, 0.05, 1900, 'square', 0.18);
    this.buffers.empty = this._tone(sr, 0.18, 180, 'square', 0.25);
    this.buffers.alert = this._alert(sr);
    this.buffers.bonus = this._tone(sr, 0.12, 880, 'triangle', 0.4);
    this.buffers.whistle = this._whistle(sr);
    this.ready = true;
    this._startMusic();
  }

  // ---------------------------------------------------------------- synthesis
  _noise(n) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1;
    return a;
  }

  _boom(sr, dur, decay, subHz) {
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const nz = this._noise(n);
      let lp = 0, lp2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t * decay) * Math.min(1, t * 300);
        // cutoff sweeps down over time
        const k = 0.02 + 0.35 * Math.exp(-t * 6);
        lp += (nz[i] - lp) * k;
        lp2 += (lp - lp2) * k;
        const crackle = Math.random() < 0.002 * Math.exp(-t * 2) ? (Math.random() - 0.5) * 1.5 : 0;
        const sub = Math.sin(2 * Math.PI * subHz * t * (1 - t * 0.15)) * Math.exp(-t * 5) * 0.9;
        d[i] = (lp2 * 2.8 + sub + crackle) * env;
      }
    }
    return buf;
  }

  _launch(sr) {
    const dur = 1.6;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, hp = 0, prev = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.min(1, t * 60) * Math.exp(-t * 2.2);
        const x = Math.random() * 2 - 1;
        const k = 0.08 + 0.25 * Math.exp(-t * 3);
        lp += (x - lp) * k;
        hp = 0.97 * (hp + lp - prev);
        prev = lp;
        const tone = Math.sin(2 * Math.PI * (300 + 900 * t) * t) * 0.08 * Math.exp(-t * 4);
        const thump = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 18) * 0.8;
        d[i] = (hp * 1.6 + tone + thump) * env;
      }
    }
    return buf;
  }

  _siren(sr) {
    const dur = 3.6;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const sweep = 0.5 - 0.5 * Math.cos((t / dur) * Math.PI * 2);
      const f = 240 + 460 * sweep;
      ph += (2 * Math.PI * f) / sr;
      const env = Math.min(1, t * 2) * Math.min(1, (dur - t) * 2);
      d[i] = (Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.2 + Math.sin(ph * 3) * 0.1) * env * 0.5;
    }
    return buf;
  }

  _tone(sr, dur, f, type, vol) {
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const ph = 2 * Math.PI * f * t;
      let s = Math.sin(ph);
      if (type === 'square') s = Math.sign(s) * 0.6;
      if (type === 'triangle') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
      const env = Math.min(1, t * 400) * Math.max(0, 1 - t / dur);
      d[i] = s * env * vol;
    }
    return buf;
  }

  _alert(sr) {
    const dur = 0.5;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = t < 0.25 ? 988 : 740;
      const lt = t % 0.25;
      const env = Math.min(1, lt * 200) * Math.max(0, 1 - lt / 0.25);
      d[i] = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.18 * env;
    }
    return buf;
  }

  _whistle(sr) {
    const dur = 2.2;
    const n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 1800 - 1100 * (t / dur);
      ph += (2 * Math.PI * f) / sr;
      const env = Math.min(1, t * 3) * Math.min(1, (dur - t) * 6);
      d[i] = (Math.sin(ph) + (Math.random() - 0.5) * 0.25) * env * 0.12;
    }
    return buf;
  }

  // -------------------------------------------------------------------- play
  play(name, { pos = null, volume = 1, rate = 1, ref = 25 } = {}) {
    if (!this.ready || !this.buffers[name]) return;
    if (this.active > 28) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    if (pos) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.rolloffFactor = 1;
      p.maxDistance = 2000;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      p.connect(this.out);
    } else {
      g.connect(this.out);
    }
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
      g.disconnect();
    };
    src.start();
  }

  // Generative dark ambient bed with an intensity-controlled pulse layer.
  _startMusic() {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(this.out);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4);
    this.musicGain = master;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 4;
    lp.connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();

    const notes = [36.71, 55.0, 73.42, 87.31]; // D1 A1 D2 F2
    for (const f of notes) {
      for (const det of [-6, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.035;
        o.connect(g).connect(lp);
        o.start();
      }
    }

    // Pulse layer (heartbeat) – gain driven by setIntensity.
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseGain.connect(master);
    this.intensity = 0;
    const beat = () => {
      if (!this.ready) return;
      const t = ctx.currentTime + 0.05;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(this.pulseGain);
      o.start(t);
      o.stop(t + 0.4);
      // second softer beat
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(80, t + 0.22);
      o2.frequency.exponentialRampToValueAtTime(36, t + 0.45);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t + 0.22);
      g2.gain.exponentialRampToValueAtTime(0.5, t + 0.23);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o2.connect(g2).connect(this.pulseGain);
      o2.start(t + 0.22);
      o2.stop(t + 0.6);
      const period = 1.05 - this.intensity * 0.45;
      setTimeout(beat, period * 1000);
    };
    beat();
  }

  setIntensity(v) {
    this.intensity = v;
    if (this.pulseGain) this.pulseGain.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.5);
  }
}
