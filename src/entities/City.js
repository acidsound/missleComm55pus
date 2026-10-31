import * as THREE from 'three';
import { seeded, rand } from '../utils/math.js';
import { glowTexture } from '../utils/textures.js';
import { heightAt } from '../World.js';

const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

const WINDOW_GLSL = /* glsl */ `
float cHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

function makeCityMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c2232, roughness: 0.75, metalness: 0.35 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindows = uniforms.uWindows;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSeed = uniforms.uSeed;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vObjN;\nvarying float vInst;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCityPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;\nvObjN = normal;\nvInst = float(gl_InstanceID);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vObjN;\nvarying float vInst;\nuniform float uWindows;\nuniform float uTime;\nuniform float uSeed;\n' + WINDOW_GLSL,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 an = abs(vObjN);
          float wall = 1.0 - step(0.5, an.y);
          float horiz = an.x > 0.5 ? vCityPos.z : vCityPos.x;
          float fy = (vCityPos.y - 0.5) / 0.85;
          float fx = horiz / 0.62;
          vec2 cell = floor(vec2(fx, fy));
          vec2 f = fract(vec2(fx, fy));
          float win = smoothstep(0.12, 0.2, f.x) * smoothstep(0.86, 0.78, f.x) * smoothstep(0.2, 0.3, f.y) * smoothstep(0.8, 0.7, f.y);
          float h = cHash(cell + vInst * 17.13 + vObjN.xz * 31.0 + uSeed);
          float lit = step(0.42, h);
          // occasional flicker
          lit *= 0.75 + 0.25 * step(0.02, fract(sin(dot(cell, vec2(12.9, 78.2)) + uTime * 0.3 * step(0.97, h)) * 43758.5));
          vec3 wc = mix(vec3(1.0, 0.68, 0.32), vec3(0.65, 0.85, 1.0), step(0.85, cHash(cell * 1.7 + vInst)));
          wc *= 0.6 + 0.8 * cHash(cell + 3.1);
          float above = step(0.4, vCityPos.y);
          totalEmissiveRadiance += wc * win * lit * wall * above * uWindows * 1.0;
          // roof edge / ground-floor glow
          totalEmissiveRadiance += vec3(1.0, 0.55, 0.25) * wall * smoothstep(0.5, 0.0, vCityPos.y) * uWindows * 0.25;
        }`,
      );
  };
  return mat;
}

export class City {
  constructor(scene, fx, pos, index, name) {
    this.scene = scene;
    this.fx = fx;
    this.index = index;
    this.name = name;
    this.alive = true;
    this.group = new THREE.Group();
    this.pos = pos.clone();
    this.pos.y = heightAt(pos.x, pos.z);
    this.group.position.copy(this.pos);
    // face the tower
    this.group.rotation.y = Math.atan2(-pos.x, -pos.z) + Math.PI;
    scene.add(this.group);

    this.uniforms = { uWindows: { value: 1 }, uTime: { value: 0 }, uSeed: { value: index * 13.7 } };
    this.material = makeCityMaterial(this.uniforms);

    // Building layout
    const rng = seeded(1000 + index * 77);
    this.buildings = [];
    const tries = 80;
    for (let i = 0; i < tries && this.buildings.length < 34; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 8;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const w = 1.4 + rng() * 2.2, dd = 1.4 + rng() * 2.2;
      // overlap rejection
      let ok = true;
      for (const b of this.buildings) {
        if (Math.abs(b.x - x) < (b.w + w) / 2 + 0.35 && Math.abs(b.z - z) < (b.d + dd) / 2 + 0.35) { ok = false; break; }
      }
      if (!ok) continue;
      const centre = 1 - d / 8;
      const h = 2 + rng() * 4 + centre * centre * (8 + rng() * 14);
      this.buildings.push({ x, z, w, d: dd, h, rubble: 0.12 + rng() * 0.25, tilt: (rng() - 0.5) * 0.4 });
    }
    this.mesh = new THREE.InstancedMesh(boxGeo, this.material, this.buildings.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this._layout(false);

    // ground slab / plaza
    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(10.5, 11, 0.6, 24),
      new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.95 }),
    );
    slab.position.y = -0.25;
    slab.receiveShadow = true;
    this.group.add(slab);

    // light-pollution glow on the ground
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xff9a4a, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.15;
    this.group.add(this.glow);

    // haze dome above city
    const hazeMat = new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff8a40, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.haze = new THREE.Sprite(hazeMat);
    this.haze.scale.set(38, 22, 1);
    this.haze.position.y = 6;
    this.group.add(this.haze);

    // aviation lights on tallest buildings
    this.avLights = [];
    const tall = [...this.buildings].sort((a, b) => b.h - a.h).slice(0, 3);
    for (const b of tall) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff2020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.scale.setScalar(1.4);
      s.position.set(b.x, b.h + 0.4, b.z);
      s.userData.phase = rand(0, 6);
      this.group.add(s);
      this.avLights.push(s);
    }

    // sweeping searchlight
    this.searchlight = null;
    if (index % 2 === 0) this._buildSearchlight();

    // scorch decal (shown when destroyed)
    const scorchMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: 0.9, depthWrite: false });
    this.scorch = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), scorchMat);
    this.scorch.rotation.x = -Math.PI / 2;
    this.scorch.position.y = 0.1;
    this.scorch.visible = false;
    this.group.add(this.scorch);

    this.fireTimer = 0;
    this.time = rand(0, 10);
  }

  _buildSearchlight() {
    const len = 140;
    const geo = new THREE.CylinderGeometry(5, 0.25, len, 24, 1, true).translate(0, len / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.55, 0.7, 1.0) }, uLen: { value: len } },
      vertexShader: /* glsl */ `
        varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uLen; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
          float a = pow(f, 2.0) * pow(1.0 - vY / uLen, 1.6) * 0.055;
          gl_FragColor = vec4(uColor, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.frustumCulled = false;
    const pivot = new THREE.Group();
    pivot.position.set(rand(-4, 4), 1, rand(-4, 4));
    pivot.add(beam);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xbfd6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    lamp.scale.setScalar(3);
    pivot.add(lamp);
    this.group.add(pivot);
    this.searchlight = { pivot, beam, phase: rand(0, 10), speed: rand(0.18, 0.32) };
  }

  _layout(destroyed) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    this.buildings.forEach((b, i) => {
      if (destroyed) {
        e.set(b.tilt, 0, b.tilt * 0.6);
        q.setFromEuler(e);
        s.set(b.w * 1.05, Math.max(0.4, b.h * b.rubble), b.d * 1.05);
      } else {
        q.identity();
        s.set(b.w, b.h, b.d);
      }
      p.set(b.x, 0, b.z);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  get targetPoint() {
    return this.pos.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this._layout(true);
    this.material.color.set(0x0c0d10);
    this.uniforms.uWindows.value = 0;
    this.glow.material.color.set(0xff3a10);
    this.glow.material.opacity = 0.5;
    this.haze.material.color.set(0xff3a10);
    this.haze.material.opacity = 0.22;
    this.avLights.forEach((s) => (s.visible = false));
    if (this.searchlight) this.searchlight.pivot.visible = false;
    this.scorch.visible = true;
    this.fireTimer = 0;
  }

  rebuild() {
    this.alive = true;
    this._layout(false);
    this.material.color.set(0x1c2232);
    this.uniforms.uWindows.value = 1;
    this.glow.material.color.set(0xff9a4a);
    this.glow.material.opacity = 0.22;
    this.haze.material.color.set(0xff8a40);
    this.haze.material.opacity = 0.08;
    this.avLights.forEach((s) => (s.visible = true));
    if (this.searchlight) this.searchlight.pivot.visible = true;
    this.scorch.visible = false;
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.alive) {
      for (const s of this.avLights) s.material.opacity = Math.sin(this.time * 2 + s.userData.phase) > 0.7 ? 1 : 0.05;
      if (this.searchlight) {
        const sl = this.searchlight;
        const t = this.time * sl.speed + sl.phase;
        sl.pivot.rotation.set(Math.sin(t) * 0.45, 0, Math.cos(t * 0.7) * 0.4);
      }
    } else {
      // burning rubble
      this.fireTimer += dt;
      const flick = 0.4 + Math.random() * 0.25;
      this.glow.material.opacity = flick;
      const wp = this.pos;
      const rate = this.fireTimer < 6 ? 0.45 : 0.25;
      if (Math.random() < rate) {
        const b = this.buildings[Math.floor(Math.random() * this.buildings.length)];
        const v = new THREE.Vector3(b.x, 0, b.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.group.rotation.y);
        const x = wp.x + v.x, z = wp.z + v.z, y = wp.y + b.h * b.rubble;
        this.fx.fire.spawn(x, y, z, rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5), {
          life: rand(0.6, 1.2), size: rand(1.5, 2.8), sizeEnd: 0.5, color: 0xffb060, colorEnd: 0x601000, alpha: 0.8,
        });
        if (Math.random() < 0.5) {
          this.fx.smoke.spawn(x, y + 2, z, rand(-0.5, 0.5) + 0.8, rand(3, 5), rand(-0.5, 0.5), {
            life: rand(5, 9), size: rand(2, 3), sizeEnd: rand(8, 12), color: 0x262422, colorEnd: 0x101114, alpha: 0.45, drag: 0.2, fadeIn: 0.2,
          });
        }
      }
    }
  }
}
