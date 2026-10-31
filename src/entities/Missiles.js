import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Trail } from '../fx/Trails.js';
import { glowTexture, crossTexture, flareTexture } from '../utils/textures.js';
import { rand, choose } from '../utils/math.js';
import { INTERCEPTOR } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// ---------------------------------------------------------------- shared assets
const enemyBodyGeo = BufferGeometryUtils.mergeGeometries([
  new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8),
  new THREE.ConeGeometry(0.22, 0.7, 8).translate(0, 1.55, 0),
  new THREE.BoxGeometry(0.9, 0.5, 0.06).translate(0, -1.0, 0),
  new THREE.BoxGeometry(0.06, 0.5, 0.9).translate(0, -1.0, 0),
]);
const enemyMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7, emissive: 0x200000 });
const mirvMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a, roughness: 0.5, metalness: 0.7, emissive: 0x401000 });

const interceptorGeo = BufferGeometryUtils.mergeGeometries([
  new THREE.CylinderGeometry(0.1, 0.1, 1.4, 8),
  new THREE.ConeGeometry(0.1, 0.35, 8).translate(0, 0.875, 0),
]);
const interceptorMat = new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.35, metalness: 0.4, emissive: 0x113344 });

function glowSprite(color, scale) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flareTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(scale);
  s.renderOrder = 15;
  return s;
}

// ---------------------------------------------------------------- base entity
class Entity {
  constructor(game) {
    this.game = game;
    this.alive = true;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hitRadius = 1;
  }
}

// ---------------------------------------------------------------- enemy missile
export class EnemyMissile extends Entity {
  constructor(game, start, target, speed, o = {}) {
    super(game);
    this.kind = o.kind ?? 'missile';
    this.target = target; // { point: Vector3, ref: City|Battery|null }
    this.pos.copy(start);
    this.start = start.clone();
    this.dir = target.point.clone().sub(start).normalize();
    this.speed = speed;
    this.vel.copy(this.dir).multiplyScalar(speed);
    this.length = start.distanceTo(target.point);
    this.traveled = 0;
    this.hitRadius = 1.4;
    this.canSplit = o.mirv ?? false;
    this.splitAlt = rand(55, 90);
    this.score = o.score ?? 25;

    this.mesh = new THREE.Mesh(enemyBodyGeo, this.canSplit ? mirvMat : enemyMat);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir);
    this.mesh.position.copy(this.pos);
    game.scene.add(this.mesh);
    this.glow = glowSprite(this.canSplit ? 0xff9020 : 0xff3a20, this.canSplit ? 9 : 7);
    this.glow.position.copy(this.pos);
    game.scene.add(this.glow);

    const fx = game.fx;
    this.trail = fx.trailGlow.add(new Trail({
      color: this.canSplit ? 0xffa040 : 0xff4a2a, tailColor: 0x801000, width: 0.32, minAlpha: 0.22, alpha: 0.95,
      spacing: 2.0, fadeTime: 3.0,
    }));
    this.smoke = fx.trailSmoke.add(new Trail({
      color: 0x3c3a3c, tailColor: 0x1a1a1f, width: 0.8, widthGrow: 0.9, alpha: 0.5, pointLife: 7, spacing: 1.8, jitter: 0.5,
    }));
    this.flick = rand(0, 10);
  }

  update(dt, time) {
    const step = this.speed * dt;
    this.pos.addScaledVector(this.dir, step);
    this.traveled += step;
    this.mesh.position.copy(this.pos);
    this.glow.position.copy(this.pos).addScaledVector(this.dir, -1.3);
    this.flick += dt * 30;
    this.glow.material.opacity = 0.75 + Math.sin(this.flick) * 0.25;
    this.trail.push(this.pos, time);
    this.smoke.push(this.pos, time);

    if (this.canSplit && this.pos.y < this.splitAlt) {
      this.canSplit = false;
      this.game.splitMirv(this);
    }
    if (this.traveled >= this.length) {
      this.pos.copy(this.target.point);
      this.game.onEnemyImpact(this);
    }
  }

  remove() {
    if (!this.alive) return;
    this.alive = false;
    this.game.scene.remove(this.mesh);
    this.game.scene.remove(this.glow);
    this.glow.material.dispose();
    this.trail.detach();
    this.smoke.detach();
  }
}

// ---------------------------------------------------------------- smart bomb
const smartGeo = new THREE.OctahedronGeometry(1.1, 0);
const smartMat = new THREE.MeshStandardMaterial({ color: 0x220022, emissive: 0xff30d0, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.6, flatShading: true });

export class SmartBomb extends Entity {
  constructor(game, start, target, speed) {
    super(game);
    this.kind = 'smart';
    this.target = target;
    this.pos.copy(start);
    this.speed = speed;
    this.hitRadius = 1.8;
    this.score = 125;
    this.mesh = new THREE.Mesh(smartGeo, smartMat);
    this.mesh.position.copy(start);
    game.scene.add(this.mesh);
    this.glow = glowSprite(0xff40e0, 10);
    game.scene.add(this.glow);
    this.trail = game.fx.trailGlow.add(new Trail({ color: 0xff50e0, tailColor: 0x400040, width: 0.5, pointLife: 2.5, spacing: 1.2, fadeTime: 1 }));
    this.dir = target.point.clone().sub(start).normalize();
    this.vel.copy(this.dir).multiplyScalar(speed);
  }

  update(dt, time) {
    // seek
    const desired = _v.copy(this.target.point).sub(this.pos);
    const dist = desired.length();
    desired.normalize().multiplyScalar(this.speed);
    // evade player explosions
    const evade = new THREE.Vector3();
    for (const e of this.game.fx.explosions) {
      if (!e.lethal) continue;
      const d = this.pos.distanceTo(e.pos);
      const danger = e.maxRadius + 10;
      if (d < danger && d > 0.01) {
        const away = this.pos.clone().sub(e.pos).normalize();
        // prefer sideways dodge
        away.y *= 0.3;
        evade.addScaledVector(away, (1 - d / danger) * this.speed * 2.5);
      }
    }
    desired.add(evade);
    this.vel.lerp(desired, Math.min(1, dt * 3));
    if (this.vel.y > -1) this.vel.y = -1; // always descending
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y += dt * 4;
    this.mesh.rotation.x += dt * 2.3;
    this.glow.position.copy(this.pos);
    this.glow.material.opacity = 0.6 + 0.4 * Math.sin(time * 14);
    this.trail.push(this.pos, time);
    if (dist < 2 || this.pos.y <= this.target.point.y + 0.5) {
      this.game.onEnemyImpact(this);
    }
  }

  remove() {
    if (!this.alive) return;
    this.alive = false;
    this.game.scene.remove(this.mesh);
    this.game.scene.remove(this.glow);
    this.glow.material.dispose();
    this.trail.detach();
  }
}

// ---------------------------------------------------------------- flyer (bomber / satellite)
function buildBomber() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.55, metalness: 0.6 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.45, 9, 10), hull);
  fus.rotation.z = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2, 10), hull);
  nose.rotation.z = -Math.PI / 2;
  nose.position.x = 5.5;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 14), hull);
  wing.position.x = 0.4;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.15), hull);
  tail.position.set(-4, 1, 0);
  g.add(tail);
  const tailW = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 5), hull);
  tailW.position.set(-4, 0.2, 0);
  g.add(tailW);
  for (const z of [-3.5, 3.5]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.2, 8), hull);
    eng.rotation.z = Math.PI / 2;
    eng.position.set(0.2, -0.45, z);
    g.add(eng);
    const ex = glowSprite(0xff8a40, 2.2);
    ex.position.set(-1.1, -0.45, z);
    g.add(ex);
  }
  const red = glowSprite(0xff2020, 2.5);
  red.position.set(0.4, 0, -7);
  const green = glowSprite(0x20ff60, 2.5);
  green.position.set(0.4, 0, 7);
  const white = glowSprite(0xffffff, 2);
  white.position.set(-4.5, 2.1, 0);
  g.add(red, green, white);
  g.userData.blinkers = [red, green, white];
  return g;
}

function buildSatellite() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xb08a40, roughness: 0.3, metalness: 0.9 }),
  );
  g.add(body);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x0a1030, emissive: 0x1840a0, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 6), panelMat);
    p.position.z = s * 4.4;
    p.rotation.x = Math.PI / 2;
    p.rotation.z = Math.PI / 2;
    g.add(p);
  }
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.6, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide }));
  dish.position.y = -1.3;
  g.add(dish);
  const b = glowSprite(0xff3030, 2.5);
  b.position.y = 1.3;
  g.add(b);
  g.userData.blinkers = [b];
  return g;
}

export class Flyer extends Entity {
  constructor(game, o) {
    super(game);
    this.kind = 'flyer';
    this.type = o.type ?? 'bomber';
    this.score = 100;
    const side = Math.random() < 0.5 ? -1 : 1;
    const alt = this.type === 'satellite' ? rand(95, 115) : rand(55, 80);
    const z = -rand(70, 115);
    this.pos.set(side * 190, alt, z);
    this.speed = this.type === 'satellite' ? rand(9, 12) : rand(12, 16);
    this.vel.set(-side * this.speed, 0, 0);
    this.hitRadius = this.type === 'satellite' ? 3.5 : 4.5;
    this.mesh = this.type === 'satellite' ? buildSatellite() : buildBomber();
    this.mesh.position.copy(this.pos);
    if (this.type === 'bomber') this.mesh.rotation.y = side > 0 ? Math.PI : 0;
    game.scene.add(this.mesh);
    this.dropTimer = rand(1.5, 3);
    this.drops = o.drops ?? 3;
    this.time = 0;
    if (this.type === 'bomber') {
      this.contrail = [-3.5, 3.5].map(() => game.fx.trailSmoke.add(new Trail({
        color: 0x6a6e78, tailColor: 0x2a2c33, width: 0.4, widthGrow: 0.6, alpha: 0.35, pointLife: 6, spacing: 2,
      })));
    } else this.contrail = [];
    this.engineHum = 0;
  }

  update(dt, time) {
    this.time += dt;
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    if (this.type === 'satellite') this.mesh.rotation.x += dt * 0.6;
    else this.mesh.rotation.x = Math.sin(this.time * 0.8) * 0.06;
    const bl = this.mesh.userData.blinkers;
    bl.forEach((b, i) => (b.material.opacity = Math.sin(this.time * 5 + i * 2) > 0.5 ? 1 : 0.05));
    if (this.contrail.length) {
      const back = this.vel.clone().normalize().multiplyScalar(-1.5);
      this.contrail.forEach((c, i) => {
        _v.set(this.pos.x + back.x, this.pos.y - 0.45, this.pos.z + (i === 0 ? -3.5 : 3.5));
        c.push(_v, time);
      });
    }
    // drop warheads while over the valley
    if (Math.abs(this.pos.x) < 85 && this.drops > 0) {
      this.dropTimer -= dt;
      if (this.dropTimer <= 0) {
        this.dropTimer = rand(1.8, 3.5);
        this.drops--;
        this.game.spawnFromFlyer(this);
      }
    }
    if (Math.abs(this.pos.x) > 200) this.game.removeEnemy(this, false);
  }

  remove() {
    if (!this.alive) return;
    this.alive = false;
    this.game.scene.remove(this.mesh);
    this.contrail.forEach((c) => c.detach());
  }
}

// ---------------------------------------------------------------- player interceptor
const crossMat = new THREE.SpriteMaterial({ map: crossTexture(), color: 0x7ff6ff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });

export class Interceptor extends Entity {
  constructor(game, start, target, battery) {
    super(game);
    this.battery = battery;
    this.pos.copy(start);
    this.target = target.clone();
    this.dir = target.clone().sub(start).normalize();
    this.length = start.distanceTo(target);
    this.traveled = 0;
    this.speed = INTERCEPTOR.startSpeed;
    this.mesh = new THREE.Mesh(interceptorGeo, interceptorMat);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir);
    this.mesh.position.copy(start);
    game.scene.add(this.mesh);
    this.glow = glowSprite(0xbff4ff, 6);
    game.scene.add(this.glow);
    this.marker = new THREE.Sprite(crossMat.clone());
    this.marker.position.copy(target);
    this.marker.renderOrder = 30;
    game.scene.add(this.marker);
    this.trail = game.fx.trailGlow.add(new Trail({ color: 0x9ff4ff, tailColor: 0x1060a0, width: 0.22, minAlpha: 0.3, spacing: 1.5, fadeTime: 1.2 }));
    this.smoke = game.fx.trailSmoke.add(new Trail({ color: 0x8a8e96, tailColor: 0x34363c, width: 0.5, widthGrow: 1.1, alpha: 0.45, pointLife: 4, spacing: 1.2, jitter: 0.35 }));
    this.time = 0;
    // launch puff
    const fx = game.fx;
    for (let i = 0; i < 16; i++) {
      fx.smoke.spawn(start.x, start.y, start.z, rand(-3, 3), rand(0, 3), rand(-3, 3), {
        life: rand(1.5, 3), size: 1.2, sizeEnd: 5, color: 0x6a6c72, colorEnd: 0x24262b, alpha: 0.5, drag: 2,
      });
    }
    fx.glows.spawn(start.x, start.y, start.z, 0, 0, 0, { life: 0.2, size: 8, sizeEnd: 3, color: 0x9ff4ff, fadeIn: 0 });
  }

  update(dt, time) {
    this.time += dt;
    this.speed = Math.min(INTERCEPTOR.maxSpeed, this.speed + INTERCEPTOR.accel * dt);
    const step = this.speed * dt;
    this.traveled += step;
    if (this.traveled >= this.length) {
      this.pos.copy(this.target);
      this.game.onInterceptorArrive(this);
      return;
    }
    this.pos.addScaledVector(this.dir, step);
    this.mesh.position.copy(this.pos);
    this.glow.position.copy(this.pos).addScaledVector(this.dir, -0.9);
    this.glow.material.opacity = 0.8 + Math.random() * 0.2;
    this.trail.push(this.pos, time);
    this.smoke.push(this.pos, time);
    // marker: constant angular size, blink
    const cam = this.game.cameraWorldPos;
    const d = cam.distanceTo(this.target);
    this.marker.scale.setScalar(d * 0.03);
    this.marker.material.opacity = Math.sin(this.time * 18) > -0.3 ? 1 : 0.2;
  }

  remove() {
    if (!this.alive) return;
    this.alive = false;
    const s = this.game.scene;
    s.remove(this.mesh);
    s.remove(this.glow);
    s.remove(this.marker);
    this.glow.material.dispose();
    this.marker.material.dispose();
    this.trail.detach();
    this.smoke.detach();
  }
}

export { choose };
