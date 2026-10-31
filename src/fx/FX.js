import * as THREE from 'three';
import { ParticleSystem } from './Particles.js';
import { TrailSystem } from './Trails.js';
import { glowTexture, smokeTexture, sparkTexture, flareTexture } from '../utils/textures.js';
import { GLSL_NOISE, rand } from '../utils/math.js';

// ---------------------------------------------------------------------------
// Fireball / shockwave shaders
// ---------------------------------------------------------------------------
const fireVert = /* glsl */ `
${GLSL_NOISE}
uniform float uTime;
uniform float uSeed;
uniform float uDisp;
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
void main(){
  vObj = position;
  float n = fbm3(position * 2.1 + vec3(0.0, -uTime * 1.3, uSeed));
  vec3 p = position + normal * (n - 0.45) * uDisp;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const fireFrag = /* glsl */ `
${GLSL_NOISE}
uniform float uTime;
uniform float uSeed;
uniform float uHeat;
uniform float uOpacity;
uniform vec3 uRim;
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
vec3 ramp(float h){
  vec3 c0 = vec3(0.25, 0.02, 0.0);
  vec3 c1 = vec3(1.0, 0.22, 0.02);
  vec3 c2 = vec3(1.0, 0.62, 0.12);
  vec3 c3 = vec3(1.0, 0.95, 0.75);
  vec3 c4 = vec3(1.6, 1.6, 1.5);
  if (h < 0.25) return mix(c0, c1, h / 0.25);
  if (h < 0.5) return mix(c1, c2, (h - 0.25) / 0.25);
  if (h < 0.75) return mix(c2, c3, (h - 0.5) / 0.25);
  return mix(c3, c4, clamp((h - 0.75) / 0.25, 0.0, 1.0));
}
void main(){
  float fres = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
  float n = fbm3(vObj * 3.2 + vec3(0.0, -uTime * 2.2, uSeed * 1.7));
  float n2 = fbm3(vObj * 7.0 - vec3(uTime * 0.7, 0.0, uSeed));
  float h = uHeat * (0.25 + 0.95 * fres) + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.35;
  vec3 col = ramp(clamp(h, 0.0, 1.0)) * 1.25;
  float rim = pow(1.0 - fres, 3.0);
  col += uRim * rim * 1.5 * uHeat;
  float a = uOpacity * smoothstep(0.0, 0.45, fres + (n - 0.5) * 0.6);
  gl_FragColor = vec4(col, a);
}`;

const shockFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uRim;
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
void main(){
  float fres = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
  float rim = pow(1.0 - fres, 4.0);
  gl_FragColor = vec4(uRim * 2.0, rim * uOpacity);
}`;

const fireGeo = new THREE.IcosahedronGeometry(1, 4);
const shockGeo = new THREE.IcosahedronGeometry(1, 3);

function makeFireMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 100 },
      uHeat: { value: 1 },
      uOpacity: { value: 1 },
      uDisp: { value: 0.35 },
      uRim: { value: new THREE.Color(1, 0.5, 0.2) },
    },
    vertexShader: fireVert,
    fragmentShader: fireFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makeShockMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uDisp: { value: 0.0 },
      uOpacity: { value: 1 },
      uRim: { value: new THREE.Color(0.6, 0.9, 1.0) },
    },
    vertexShader: fireVert,
    fragmentShader: shockFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t) => t * t;

// ---------------------------------------------------------------------------
export class Explosion {
  constructor(fx, pos, o) {
    this.fx = fx;
    this.pos = pos.clone();
    this.maxRadius = o.radius ?? 8;
    this.growT = o.grow ?? 0.45;
    this.holdT = o.hold ?? 0.5;
    this.shrinkT = o.shrink ?? 0.7;
    this.owner = o.owner ?? 'player'; // 'player' | 'enemy'
    this.lethal = o.lethal ?? this.owner === 'player';
    this.age = 0;
    this.radius = 0;
    this.dead = false;
    this.chain = o.chain ?? 0;

    this.mat = makeFireMaterial();
    this.mat.uniforms.uRim.value.set(o.rim ?? (this.owner === 'player' ? 0x66e0ff : 0xff5522));
    this.mat.uniforms.uDisp.value = o.disp ?? 0.35;
    this.mesh = new THREE.Mesh(fireGeo, this.mat);
    this.mesh.position.copy(pos);
    this.mesh.scale.setScalar(0.001);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
    fx.scene.add(this.mesh);

    this.shockMat = makeShockMaterial();
    this.shockMat.uniforms.uRim.value.set(o.shockColor ?? (this.owner === 'player' ? 0x9fe8ff : 0xffb070));
    this.shock = new THREE.Mesh(shockGeo, this.shockMat);
    this.shock.position.copy(pos);
    this.shock.renderOrder = 21;
    this.shock.frustumCulled = false;
    fx.scene.add(this.shock);

    this.light = fx.acquireLight(pos, o.lightColor ?? (this.owner === 'player' ? 0xffd9a0 : 0xff7a33), o.lightIntensity ?? 4000);
    this.lightIntensity = o.lightIntensity ?? 4000;
  }

  get totalT() {
    return this.growT + this.holdT + this.shrinkT;
  }

  update(dt, time) {
    this.age += dt;
    const a = this.age;
    let r, heat, op;
    if (a < this.growT) {
      const t = a / this.growT;
      r = easeOutCubic(t);
      heat = 1.25;
      op = 1;
    } else if (a < this.growT + this.holdT) {
      const t = (a - this.growT) / this.holdT;
      r = 1 + Math.sin(t * Math.PI) * 0.04;
      heat = 1.25 - t * 0.35;
      op = 1;
    } else {
      const t = (a - this.growT - this.holdT) / this.shrinkT;
      if (t >= 1) { this.dispose(); return; }
      r = 1 - easeInQuad(t) * 0.92;
      heat = 0.9 - t * 0.75;
      op = 1 - t * t;
    }
    this.radius = r * this.maxRadius;
    this.mesh.scale.setScalar(Math.max(0.001, this.radius));
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uHeat.value = heat;
    this.mat.uniforms.uOpacity.value = op;

    const st = Math.min(1, a / 0.55);
    this.shock.scale.setScalar(0.001 + this.maxRadius * (0.4 + 2.4 * easeOutCubic(st)));
    this.shockMat.uniforms.uOpacity.value = (1 - st) * 0.9;
    this.shock.visible = st < 1;

    if (this.light) {
      const lt = a / this.totalT;
      this.light.intensity = this.lightIntensity * Math.pow(1 - lt, 2) * (0.85 + Math.random() * 0.3);
    }
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.radius = 0;
    this.fx.scene.remove(this.mesh);
    this.fx.scene.remove(this.shock);
    this.mat.dispose();
    this.shockMat.dispose();
    if (this.light) this.fx.releaseLight(this.light);
    this.light = null;
  }
}

// ---------------------------------------------------------------------------
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticleSystem(scene, { max: 9000, texture: smokeTexture(), additive: false, fogAmount: 0.8, renderOrder: 8 });
    this.fire = new ParticleSystem(scene, { max: 5000, texture: smokeTexture(), additive: true, fogAmount: 0.4, renderOrder: 9 });
    this.sparks = new ParticleSystem(scene, { max: 5000, texture: sparkTexture(), additive: true, fogAmount: 0.3, renderOrder: 11 });
    this.glows = new ParticleSystem(scene, { max: 1500, texture: flareTexture(), additive: true, fogAmount: 0.2, renderOrder: 12 });
    this.trailGlow = new TrailSystem(scene, { max: 9000, additive: true, fogAmount: 0.35, renderOrder: 6 });
    this.trailSmoke = new TrailSystem(scene, { max: 9000, additive: false, fogAmount: 0.8, renderOrder: 5 });
    this.explosions = [];
    this.time = 0;

    // Fixed light pool: keeps shader light count constant (no recompiles).
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 0, 2);
      l.userData.busy = false;
      l.userData.since = 0;
      scene.add(l);
      this.lights.push(l);
    }
  }

  acquireLight(pos, color, intensity) {
    let best = this.lights.find((l) => !l.userData.busy);
    if (!best) best = this.lights.reduce((a, b) => (a.userData.since < b.userData.since ? a : b));
    best.userData.busy = true;
    best.userData.since = this.time;
    best.position.copy(pos);
    best.color.set(color);
    best.intensity = intensity;
    return best;
  }

  releaseLight(l) {
    l.userData.busy = false;
    l.intensity = 0;
  }

  explode(pos, o = {}) {
    const e = new Explosion(this, pos, o);
    this.explosions.push(e);
    // Accompanying particles
    const R = e.maxRadius;
    const big = o.big ?? false;
    const nSpark = big ? 90 : 40;
    for (let i = 0; i < nSpark; i++) {
      const v = randDir(rand(R * 2.5, R * 6));
      this.sparks.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z, {
        life: rand(0.5, 1.4), size: rand(0.25, 0.6), sizeEnd: 0.05,
        color: 0xfff1c0, colorEnd: o.owner === 'player' ? 0x55aaff : 0xff4410,
        drag: 2.2, gravity: -9, fadeIn: 0,
      });
    }
    // core flash
    this.glows.spawn(pos.x, pos.y, pos.z, 0, 0, 0, {
      life: 0.3, size: R * 3, sizeEnd: R * 4.5, color: o.owner === 'player' ? 0xd8f4ff : 0xffcc88, alpha: 0.6, fadeIn: 0,
    });
    // fire puffs
    const nFire = big ? 40 : 18;
    for (let i = 0; i < nFire; i++) {
      const v = randDir(rand(R * 0.6, R * 1.8));
      this.fire.spawn(pos.x, pos.y, pos.z, v.x, v.y, v.z, {
        life: rand(0.6, 1.3), size: R * rand(0.5, 0.9), sizeEnd: R * rand(1.2, 1.8),
        color: 0xffc070, colorEnd: 0x601000, alpha: 0.45, drag: 2.5, gravity: 1.5, rotSpeed: rand(-1, 1),
      });
    }
    // smoke
    const nSmoke = big ? 40 : 14;
    for (let i = 0; i < nSmoke; i++) {
      const v = randDir(rand(R * 0.3, R * 1.1));
      this.smoke.spawn(pos.x + v.x * 0.3, pos.y + v.y * 0.3, pos.z + v.z * 0.3, v.x, v.y + 1, v.z, {
        life: rand(3, 6), size: R * rand(0.5, 0.9), sizeEnd: R * rand(1.8, 2.8),
        color: 0x3a3634, colorEnd: 0x15161a, alpha: 0.55, drag: 1.2, gravity: 0.6, rotSpeed: rand(-0.3, 0.3), fadeIn: 0.25,
      });
    }
    return e;
  }

  // Ground strike: dust ring + mushroom cloud column.
  groundImpact(pos, scale = 1) {
    const R = 6 * scale;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + rand(-0.1, 0.1);
      const s = rand(10, 18) * scale;
      this.smoke.spawn(pos.x, pos.y + 0.5, pos.z, Math.cos(a) * s, rand(0.5, 2), Math.sin(a) * s, {
        life: rand(2.5, 4.5), size: R * 0.5, sizeEnd: R * 1.4, color: 0x4a4038, colorEnd: 0x1a1918,
        alpha: 0.6, drag: 1.8, gravity: 0.2, fadeIn: 0.05,
      });
    }
    // column
    for (let i = 0; i < 26; i++) {
      this.smoke.spawn(pos.x + rand(-1, 1), pos.y + rand(0, 3), pos.z + rand(-1, 1), rand(-1, 1), rand(6, 16) * scale, rand(-1, 1), {
        life: rand(4, 7), size: R * 0.5, sizeEnd: R * rand(1.6, 2.4), color: 0x5a4a3e, colorEnd: 0x18181c,
        alpha: 0.6, drag: 0.9, gravity: 0, fadeIn: 0.1, rotSpeed: rand(-0.2, 0.2),
      });
    }
    for (let i = 0; i < 18; i++) {
      this.fire.spawn(pos.x, pos.y + 1, pos.z, rand(-3, 3), rand(5, 14) * scale, rand(-3, 3), {
        life: rand(0.8, 1.6), size: R * 0.5, sizeEnd: R * 1.1, color: 0xffd090, colorEnd: 0x501000, alpha: 0.8, drag: 1.5,
      });
    }
    // debris
    for (let i = 0; i < 40; i++) {
      const v = randDir(rand(8, 22) * scale);
      v.y = Math.abs(v.y) + 4;
      this.sparks.spawn(pos.x, pos.y + 0.5, pos.z, v.x, v.y, v.z, {
        life: rand(1, 2.2), size: rand(0.2, 0.45), sizeEnd: 0.1, color: 0xffd08a, colorEnd: 0xff3300, gravity: -16, drag: 0.4, fadeIn: 0,
      });
    }
  }

  update(dt) {
    this.time += dt;
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.update(dt, this.time);
      if (e.dead) this.explosions.splice(i, 1);
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    this.sparks.update(dt);
    this.glows.update(dt);
    this.trailGlow.update(dt, this.time);
    this.trailSmoke.update(dt, this.time);
  }

  clear() {
    for (const e of this.explosions) e.dispose();
    this.explosions.length = 0;
    this.smoke.clear();
    this.fire.clear();
    this.sparks.clear();
    this.glows.clear();
    this.trailGlow.clear();
    this.trailSmoke.clear();
  }
}

const _d = new THREE.Vector3();
export function randDir(len = 1) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return _d.set(s * Math.cos(a) * len, u * len, s * Math.sin(a) * len);
}

export { glowTexture };
