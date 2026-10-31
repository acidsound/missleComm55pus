import * as THREE from 'three';

// GPU-billboarded instanced particle system. CPU simulates, GPU renders a
// single draw call per system. Works identically in stereo XR rendering.

const vert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  vColor = iColor;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 p = position.xy;
  p = vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  mvPosition.xy += p * iSizeRot.x;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform sampler2D map;
uniform float uFogAmount;
varying vec4 vColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(map, vUv);
  vec4 col = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (col.a < 0.003) discard;
  gl_FragColor = col;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    fogFactor *= uFogAmount;
    #ifdef ADDITIVE
      gl_FragColor.rgb *= (1.0 - fogFactor);
    #else
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
    #endif
  #endif
}`;

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

export class ParticleSystem {
  constructor(scene, { max = 4000, texture, additive = true, fogAmount = 0.6, renderOrder = 10 } = {}) {
    this.max = max;
    this.count = 0;
    // Simulation state (struct of arrays).
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.fadeIn = new Float32Array(max);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iSizeRot', this.aSizeRot);
    geo.instanceCount = 0;
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { map: { value: texture }, uFogAmount: { value: fogAmount } },
      ]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    this.material.uniforms.map.value = texture;

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  /**
   * Spawn one particle. Colours are THREE.Color or hex.
   */
  spawn(x, y, z, vx, vy, vz, o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = o.life ?? 1;
    this.age[i] = 0;
    this.size0[i] = o.size ?? 1;
    this.size1[i] = o.sizeEnd ?? this.size0[i];
    _c0.set(o.color ?? 0xffffff);
    _c1.set(o.colorEnd ?? o.color ?? 0xffffff);
    this.col0[i3] = _c0.r; this.col0[i3 + 1] = _c0.g; this.col0[i3 + 2] = _c0.b;
    this.col1[i3] = _c1.r; this.col1[i3 + 1] = _c1.g; this.col1[i3 + 2] = _c1.b;
    this.alpha[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.rotV[i] = o.rotSpeed ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.08;
  }

  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
      this.col0[i3 + k] = this.col0[l3 + k];
      this.col1[i3 + k] = this.col1[l3 + k];
    }
    this.life[i] = this.life[last];
    this.age[i] = this.age[last];
    this.size0[i] = this.size0[last];
    this.size1[i] = this.size1[last];
    this.alpha[i] = this.alpha[last];
    this.drag[i] = this.drag[last];
    this.grav[i] = this.grav[last];
    this.rot[i] = this.rot[last];
    this.rotV[i] = this.rotV[last];
    this.fadeIn[i] = this.fadeIn[last];
  }

  update(dt) {
    const P = this.pos, V = this.vel;
    const aP = this.aPos.array, aC = this.aColor.array, aS = this.aSizeRot.array;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this._kill(i); continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      V[i3] *= d; V[i3 + 1] = V[i3 + 1] * d + this.grav[i] * dt; V[i3 + 2] *= d;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;

      aP[i3] = P[i3]; aP[i3 + 1] = P[i3 + 1]; aP[i3 + 2] = P[i3 + 2];
      const fi = this.fadeIn[i];
      const a = this.alpha[i] * (fi > 0 ? Math.min(1, t / fi) : 1) * (1 - t) * (1 - t * 0.3);
      const i4 = i * 4;
      aC[i4] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * t;
      aC[i4 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * t;
      aC[i4 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * t;
      aC[i4 + 3] = a;
      aS[i * 2] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      aS[i * 2 + 1] = this.rot[i];
      i++;
    }
    this.geo.instanceCount = this.count;
    if (this.count > 0) {
      this.aPos.addUpdateRange(0, this.count * 3);
      this.aColor.addUpdateRange(0, this.count * 4);
      this.aSizeRot.addUpdateRange(0, this.count * 2);
      this.aPos.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aSizeRot.needsUpdate = true;
    }
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}
