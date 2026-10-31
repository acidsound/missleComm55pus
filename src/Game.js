import * as THREE from 'three';
import { City } from './entities/City.js';
import { Battery } from './entities/Battery.js';
import { EnemyMissile, SmartBomb, Flyer, Interceptor } from './entities/Missiles.js';
import { FX } from './fx/FX.js';
import { rand, randInt, choose } from './utils/math.js';
import { heightAt } from './World.js';
import {
  BATTERY_SLOTS, BATTERY_NAMES, CITY_NAMES, SLOT_COUNT, slotPosition, SPAWN_ALTITUDE, SPAWN_RADIUS, SPAWN_ARC,
  INTERCEPTOR, SCORE, waveConfig, AMMO_PER_BATTERY,
} from './config.js';

const HI_KEY = 'mcxr.hiscore';

export class Game {
  constructor({ scene, camera, rig, renderer, world, audio, hud, vrHud, texts }) {
    this.scene = scene;
    this.camera = camera;
    this.rig = rig;
    this.renderer = renderer;
    this.world = world;
    this.audio = audio;
    this.hud = hud;
    this.vrHud = vrHud;
    this.texts = texts;
    this.input = null; // assigned by main

    this.fx = new FX(scene);
    this.cameraWorldPos = new THREE.Vector3();

    this.cities = [];
    this.batteries = [];
    let ci = 0, bi = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const p = slotPosition(i);
      if (BATTERY_SLOTS.includes(i)) this.batteries.push(new Battery(scene, this.fx, p, bi, BATTERY_NAMES[bi++]));
      else this.cities.push(new City(scene, this.fx, p, ci, CITY_NAMES[ci++]));
    }

    this.enemies = [];
    this.interceptors = [];
    this.state = 'menu';
    this.paused = false;
    this.score = 0;
    this.wave = 0;
    this.multiplier = 1;
    this.hiScore = Number(localStorage.getItem(HI_KEY) || 0);
    this.nextBonusCity = SCORE.bonusCityEvery;
    this.bankedCities = 0;
    this.shake = 0;
    this.time = 0;
    this.stateTime = 0;
    this.queue = [];
    this.attractTimer = 1;
    this.onStateChange = null;
    this.stats = { kills: 0, shots: 0, maxChain: 0 };
  }

  // ----------------------------------------------------------------- state
  setState(s) {
    this.state = s;
    this.stateTime = 0;
    this.onStateChange?.(s);
  }

  get xr() {
    return this.renderer.xr.isPresenting;
  }

  message(text, sub = '') {
    this.hud.message(text, sub);
    this.vrHud.message(text, sub);
  }

  hudState() {
    return {
      score: this.score,
      wave: Math.max(1, this.wave),
      multiplier: this.multiplier,
      hiScore: Math.max(this.hiScore, this.score),
      batteries: this.batteries.map((b) => ({ alive: b.alive, ammo: b.ammo })),
      cities: this.cities.map((c) => c.alive),
    };
  }

  clearField() {
    for (const e of this.enemies) e.remove();
    for (const i of this.interceptors) i.remove();
    this.enemies.length = 0;
    this.interceptors.length = 0;
    this.fx.clear();
    this.texts.clear();
    this.queue.length = 0;
  }

  startGame() {
    this.audio.init();
    this.clearField();
    this.score = 0;
    this.wave = 0;
    this.nextBonusCity = SCORE.bonusCityEvery;
    this.bankedCities = 0;
    this.stats = { kills: 0, shots: 0, maxChain: 0 };
    this.cities.forEach((c) => c.rebuild());
    this.batteries.forEach((b) => b.refill());
    this.paused = false;
    this.nextWave();
  }

  nextWave() {
    this.wave++;
    this.cfg = waveConfig(this.wave);
    this.multiplier = this.cfg.multiplier;
    this.batteries.forEach((b) => b.refill());
    // spend banked bonus cities
    for (const c of this.cities) {
      if (!c.alive && this.bankedCities > 0) {
        this.bankedCities--;
        c.rebuild();
      }
    }
    this.setState('intro');
    const extras = [];
    if (this.cfg.mirvChance > 0 && this.wave === 2) extras.push('WARNING: MIRV WARHEADS');
    if (this.cfg.flyers > 0 && this.wave === 3) extras.push('WARNING: BOMBERS INBOUND');
    if (this.cfg.smart > 0 && this.wave === 5) extras.push('WARNING: SMART BOMBS — THEY EVADE');
    this.message(`WAVE ${this.wave}`, `${this.multiplier}× POINTS${extras.length ? '\n' + extras.join('\n') : '\nDEFEND THE CITIES'}`);
    this.audio.play('siren', { volume: 0.55 });
    this.toSpawn = this.cfg.missiles;
    this.flyersLeft = this.cfg.flyers;
    this.smartLeft = this.cfg.smart;
    this.spawnTimer = 0.8;
    this.flyerTimer = rand(6, 12);
    this.clearTimer = 0;
  }

  togglePause(force) {
    if (this.state === 'menu' || this.state === 'gameover') return;
    this.paused = force ?? !this.paused;
    this.onStateChange?.(this.state);
    if (this.xr) this.message(this.paused ? 'PAUSED' : '', this.paused ? 'GRIP TO RESUME' : '');
  }

  quitToMenu() {
    this.paused = false;
    this.saveHi();
    this.clearField();
    this.cities.forEach((c) => c.rebuild());
    this.batteries.forEach((b) => b.refill());
    this.message('');
    this.setState('menu');
  }

  saveHi() {
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      localStorage.setItem(HI_KEY, String(this.hiScore));
    }
  }

  // ----------------------------------------------------------------- input
  handleSqueeze() {
    if (this.state === 'playing' || this.state === 'intro' || this.state === 'tally') this.togglePause();
  }

  handleFire(pointer, batteryIdx) {
    if (this.paused) {
      if (this.xr) this.togglePause(false);
      return;
    }
    if (this.state === 'menu') {
      if (this.xr) this.startGame();
      return;
    }
    if (this.state === 'gameover') {
      if (this.xr && this.stateTime > 4) this.startGame();
      return;
    }
    if (this.state !== 'playing' && this.state !== 'intro') return;
    const target = pointer.point.clone();
    const ground = heightAt(target.x, target.z) + 1;
    if (target.y < ground) target.y = ground;

    let bat = null;
    if (batteryIdx >= 0) {
      bat = this.batteries[batteryIdx];
      if (!bat.canFire()) bat = null;
    } else {
      let best = Infinity;
      for (const b of this.batteries) {
        if (!b.canFire()) continue;
        const d = b.pos.distanceToSquared(target);
        if (d < best) { best = d; bat = b; }
      }
    }
    if (!bat) {
      this.audio.play('empty', { volume: 0.6 });
      this.input?.haptic(pointer, 0.2, 30);
      return;
    }
    this.fireFrom(bat, target);
    this.input?.haptic(pointer, 0.7, 70);
  }

  fireFrom(bat, target) {
    const muzzle = bat.aimAt(target);
    if (this.state !== 'menu') bat.consume();
    this.interceptors.push(new Interceptor(this, muzzle, target, bat));
    this.audio.play('launch', { pos: muzzle, volume: 1.1, ref: 30 });
    if (this.state !== 'menu') {
      this.stats.shots++;
      if (bat.ammo === 3) this.audio.play('alert', { volume: 0.4 });
      if (bat.ammo === 0) this.texts.spawn(bat.pos.clone().add(new THREE.Vector3(0, 8, 0)), 'EMPTY', '#ff4a3d', 1);
    }
  }

  // ----------------------------------------------------------------- spawning
  pickTarget() {
    const opts = [];
    for (const c of this.cities) if (c.alive) opts.push([c, 3]);
    for (const b of this.batteries) if (b.alive) opts.push([b, 1.4]);
    opts.push([null, 0.5]);
    let total = opts.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total;
    let ref = null;
    for (const [o, w] of opts) {
      r -= w;
      if (r <= 0) { ref = o; break; }
    }
    if (ref) return { point: ref.targetPoint, ref };
    const a = rand(-0.9, 0.9), d = rand(35, 80);
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    return { point: new THREE.Vector3(x, heightAt(x, z), z), ref: null };
  }

  spawnPoint() {
    const a = rand(-SPAWN_ARC / 2, SPAWN_ARC / 2);
    const r = rand(...SPAWN_RADIUS);
    return new THREE.Vector3(Math.sin(a) * r, rand(...SPAWN_ALTITUDE), -Math.cos(a) * r);
  }

  spawnMissile(speedScale = 1) {
    const cfg = this.cfg;
    const mirv = Math.random() < cfg.mirvChance;
    const m = new EnemyMissile(this, this.spawnPoint(), this.pickTarget(), cfg.speed * speedScale * rand(0.85, 1.15), { mirv });
    this.enemies.push(m);
    return m;
  }

  spawnSmart() {
    const s = new SmartBomb(this, this.spawnPoint(), this.pickTarget(), this.cfg.speed * 0.8);
    this.enemies.push(s);
    this.audio.play('whistle', { pos: s.pos, volume: 1.2, ref: 60 });
  }

  spawnFlyer() {
    const f = new Flyer(this, { type: Math.random() < 0.35 ? 'satellite' : 'bomber', drops: randInt(2, 4) });
    this.enemies.push(f);
  }

  spawnFromFlyer(f) {
    const m = new EnemyMissile(this, f.pos.clone().add(new THREE.Vector3(0, -1.5, 0)), this.pickTarget(), this.cfg.speed * rand(0.9, 1.2), {});
    this.enemies.push(m);
  }

  splitMirv(parent) {
    const n = randInt(2, 3);
    const p = parent.pos;
    this.fx.glows.spawn(p.x, p.y, p.z, 0, 0, 0, { life: 0.3, size: 10, sizeEnd: 2, color: 0xffa040, fadeIn: 0 });
    for (let i = 0; i < n; i++) {
      const m = new EnemyMissile(this, p.clone(), this.pickTarget(), parent.speed * rand(1.0, 1.15), { kind: 'mirv' });
      this.enemies.push(m);
    }
  }

  removeEnemy(e) {
    e.remove();
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  // ----------------------------------------------------------------- events
  onInterceptorArrive(it) {
    it.remove();
    const i = this.interceptors.indexOf(it);
    if (i >= 0) this.interceptors.splice(i, 1);
    this.fx.explode(it.target, {
      owner: 'player', radius: INTERCEPTOR.blastRadius, grow: INTERCEPTOR.grow, hold: INTERCEPTOR.hold, shrink: INTERCEPTOR.shrink, chain: 0,
    });
    this.audio.play('pop', { pos: it.target, volume: 1.0, ref: 30 });
    this.world.skyFlash(0.12, 0xffc890);
    this.shake = Math.max(this.shake, 0.08);
  }

  destroyEnemy(e, chain) {
    const pts = e.score * this.multiplier;
    if (this.state !== 'menu') {
      this.score += pts;
      this.stats.kills++;
      this.stats.maxChain = Math.max(this.stats.maxChain, chain);
      this.texts.spawn(e.pos.clone().add(new THREE.Vector3(0, 3, 0)), `+${pts}`, e.kind === 'flyer' ? '#ff6a3d' : '#ffb547', e.kind === 'flyer' ? 1.3 : 1);
      if (chain >= 2) this.texts.spawn(e.pos.clone().add(new THREE.Vector3(0, 7, 0)), `CHAIN ×${chain}`, '#5ff6ff', 1.2);
      this.checkBonusCity();
    }
    const pos = e.pos.clone();
    this.removeEnemy(e);
    const big = e.kind === 'flyer';
    this.fx.explode(pos, {
      owner: 'player', radius: big ? 11 : 7, grow: 0.35, hold: 0.35, shrink: 0.6, chain, big,
      rim: big ? 0xff8040 : 0xffa050, lightColor: 0xffb070,
    });
    // tumbling debris
    for (let k = 0; k < (big ? 30 : 10); k++) {
      this.fx.sparks.spawn(pos.x, pos.y, pos.z, rand(-12, 12), rand(-4, 10), rand(-12, 12), {
        life: rand(1.5, 3), size: rand(0.3, 0.6), sizeEnd: 0.15, color: 0xffa060, colorEnd: 0x301000, gravity: -14, drag: 0.3, fadeIn: 0,
      });
    }
    this.audio.play(big ? 'boom' : 'pop', { pos, volume: big ? 1.4 : 1.0, ref: 35, rate: big ? 0.8 : 1.15 });
  }

  onEnemyImpact(e) {
    const pos = e.target.point.clone();
    const ref = e.target.ref;
    this.removeEnemy(e);
    const hitsStructure = ref && ref.alive && this.state !== 'menu';
    this.fx.explode(pos.clone().add(new THREE.Vector3(0, 2, 0)), {
      owner: 'enemy', lethal: false, radius: hitsStructure ? 12 : 8, grow: 0.3, hold: 0.6, shrink: 1.4, big: true, lightIntensity: hitsStructure ? 12000 : 6000,
    });
    this.fx.groundImpact(pos, hitsStructure ? 1.5 : 1);
    this.audio.play(hitsStructure ? 'boomBig' : 'boom', { pos, volume: hitsStructure ? 1.8 : 1.2, ref: 45 });
    this.world.skyFlash(hitsStructure ? 0.8 : 0.3, 0xff7030);
    if (!hitsStructure) {
      this.shake = Math.max(this.shake, 0.25);
      return;
    }
    ref.destroy();
    this.shake = Math.max(this.shake, 0.7);
    if (ref instanceof City) {
      this.texts.spawn(ref.pos.clone().add(new THREE.Vector3(0, 18, 0)), `${ref.name} LOST`, '#ff4a3d', 1.4);
      if (this.cities.every((c) => !c.alive)) this.queue.push({ t: 1.8, fn: () => this.gameOver() });
    } else {
      this.texts.spawn(ref.pos.clone().add(new THREE.Vector3(0, 12, 0)), `${ref.name} DOWN`, '#ff4a3d', 1.3);
    }
    for (const p of this.input?.activePointers?.() ?? []) this.input.haptic(p, 1.0, 220);
  }

  checkBonusCity() {
    while (this.score >= this.nextBonusCity) {
      this.nextBonusCity += SCORE.bonusCityEvery;
      this.bankedCities++;
      this.audio.play('bonus', { volume: 0.8 });
      this.texts.spawn(this.cameraWorldPos.clone().add(new THREE.Vector3(0, 6, -30)), 'BONUS CITY', '#8affc8', 1.6);
    }
  }

  gameOver() {
    if (this.state === 'gameover') return;
    this.setState('gameover');
    this.saveHi();
    this.message('THE END', `FINAL SCORE ${this.score.toLocaleString()}\nWAVE ${this.wave}  ·  ${this.stats.kills} KILLS  ·  BEST CHAIN ×${this.stats.maxChain}`);
    // apocalyptic finale
    for (let i = 0; i < 7; i++) {
      this.queue.push({
        t: 0.3 + i * 0.45,
        fn: () => {
          const a = rand(-0.9, 0.9), d = rand(60, 140);
          const p = new THREE.Vector3(Math.sin(a) * d, 0, -Math.cos(a) * d);
          p.y = heightAt(p.x, p.z) + rand(4, 20);
          this.fx.explode(p, { owner: 'enemy', lethal: false, radius: rand(18, 30), grow: 0.8, hold: 1.2, shrink: 2.5, big: true, lightIntensity: 30000 });
          this.fx.groundImpact(p, 2.5);
          this.audio.play('boomBig', { pos: p, volume: 2.2, ref: 80, rate: 0.7 });
          this.world.skyFlash(1.2, 0xffa060);
          this.shake = 1;
        },
      });
    }
    if (this.xr) this.queue.push({ t: 5, fn: () => this.message('THE END', `FINAL SCORE ${this.score.toLocaleString()}\nPULL TRIGGER TO RESTART`) });
    else this.queue.push({ t: 7.5, fn: () => this.quitToMenu() });
  }

  startTally() {
    this.setState('tally');
    let ammoBonus = 0, cityBonus = 0;
    const live = this.cities.filter((c) => c.alive);
    this.message(`WAVE ${this.wave} CLEARED`, '');
    let t = 1.0;
    for (const b of this.batteries) {
      const n = b.ammo;
      for (let k = 0; k < n; k++) {
        this.queue.push({
          t, fn: () => {
            b.ammo--;
            b._syncAmmo();
            const v = SCORE.ammoBonus * this.multiplier;
            ammoBonus += v;
            this.score += v;
            this.audio.play('tick', { volume: 0.5 });
            this.message(`WAVE ${this.wave} CLEARED`, `AMMO BONUS ${ammoBonus}`);
          },
        });
        t += 0.06;
      }
    }
    t += 0.5;
    for (const c of live) {
      this.queue.push({
        t, fn: () => {
          const v = SCORE.cityBonus * this.multiplier;
          cityBonus += v;
          this.score += v;
          this.audio.play('bonus', { volume: 0.6 });
          this.texts.spawn(c.pos.clone().add(new THREE.Vector3(0, 16, 0)), `+${v}`, '#8affc8', 1.4);
          this.message(`WAVE ${this.wave} CLEARED`, `AMMO BONUS ${ammoBonus}\nCITY BONUS ${cityBonus}`);
        },
      });
      t += 0.35;
    }
    this.queue.push({ t: t + 0.2, fn: () => this.checkBonusCity() });
    this.queue.push({ t: t + 2.4, fn: () => { this.message(''); this.nextWave(); } });
  }

  // ----------------------------------------------------------------- attract mode
  attract(dt) {
    this.cfg ??= waveConfig(3);
    this.attractTimer -= dt;
    if (this.attractTimer <= 0 && this.enemies.length < 6) {
      this.attractTimer = rand(0.8, 2.2);
      const t = this.pickTarget();
      const m = new EnemyMissile(this, this.spawnPoint(), t, rand(10, 16), { mirv: Math.random() < 0.2 });
      this.enemies.push(m);
    }
    // AI gunner
    for (const e of this.enemies) {
      if (e.aiTargeted || e.pos.y > 115 || e.kind === 'flyer') continue;
      if (Math.random() > dt * 1.4) continue;
      e.aiTargeted = true;
      if (Math.random() < 0.15) continue; // let a few through
      let bat = this.batteries[0], best = Infinity;
      for (const b of this.batteries) {
        const d = b.pos.distanceToSquared(e.pos);
        if (d < best) { best = d; bat = b; }
      }
      const p = e.pos.clone();
      for (let k = 0; k < 3; k++) {
        const tFlight = bat.pos.distanceTo(p) / 85 + 0.3;
        p.copy(e.pos).addScaledVector(e.vel, tFlight + 0.25);
      }
      if (p.y < 8) continue;
      this.fireFrom(bat, p);
    }
  }

  // ----------------------------------------------------------------- main update
  update(dt) {
    this.camera.getWorldPosition(this.cameraWorldPos);
    if (this.paused) {
      this.input?.update(0, this.enemies, false);
      return;
    }
    this.time += dt;
    this.stateTime += dt;

    // timed queue
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.queue.splice(i--, 1);
        q.fn();
      }
    }

    if (this.state === 'menu') this.attract(dt);
    if (this.state === 'intro' && this.stateTime > 3.2) {
      this.message('');
      this.setState('playing');
    }
    if (this.state === 'playing') this.updateSpawning(dt);

    const time = this.fx.time;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive) e.update(dt, time);
    }
    for (let i = this.interceptors.length - 1; i >= 0; i--) {
      const it = this.interceptors[i];
      if (it.alive) it.update(dt, time);
    }

    // explosion vs enemy collision
    for (const ex of this.fx.explosions) {
      if (!ex.lethal || ex.dead || ex.radius <= 0.1) continue;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e.alive) continue;
        const r = ex.radius + e.hitRadius;
        if (e.pos.distanceToSquared(ex.pos) < r * r) this.destroyEnemy(e, ex.chain + 1);
      }
    }

    this.fx.update(dt);
    this.world.update(dt);
    this.cities.forEach((c) => c.update(dt));
    this.batteries.forEach((b) => b.update(dt));
    this.texts.update(dt, this.cameraWorldPos);

    const aim = this.state === 'playing' || this.state === 'intro';
    this.input?.update(dt, this.enemies, aim || (this.state === 'menu' && this.xr));

    // music intensity
    const threat = Math.min(1, this.enemies.length / 10);
    this.audio.setIntensity(this.state === 'playing' ? 0.3 + threat * 0.7 : 0.05);

    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.hudState();
    this.hud.update(s);
    this.vrHud.update(s);
  }

  updateSpawning(dt) {
    const cfg = this.cfg;
    this.spawnTimer -= dt;
    const liveMissiles = this.enemies.filter((e) => e.kind !== 'flyer').length;
    if (this.spawnTimer <= 0 && (this.toSpawn > 0 || this.smartLeft > 0) && liveMissiles < cfg.maxConcurrent) {
      this.spawnTimer = rand(...cfg.salvoDelay);
      const n = Math.min(randInt(...cfg.salvo), this.toSpawn);
      for (let i = 0; i < n; i++) this.spawnMissile();
      this.toSpawn -= n;
      if (this.smartLeft > 0 && Math.random() < 0.35) {
        this.spawnSmart();
        this.smartLeft--;
      } else if (this.toSpawn <= 0 && this.smartLeft > 0) {
        this.spawnSmart();
        this.smartLeft--;
      }
    }
    if (this.flyersLeft > 0) {
      this.flyerTimer -= dt;
      if (this.flyerTimer <= 0) {
        this.flyerTimer = rand(8, 16);
        this.flyersLeft--;
        this.spawnFlyer();
      }
    }
    const done = this.toSpawn <= 0 && this.smartLeft <= 0 && this.flyersLeft <= 0 && this.enemies.length === 0;
    if (done && this.interceptors.length === 0 && this.queue.length === 0) {
      this.clearTimer += dt;
      if (this.clearTimer > 1.6 && this.cities.some((c) => c.alive)) this.startTally();
    } else this.clearTimer = 0;
  }
}

export { AMMO_PER_BATTERY, choose };
