import * as THREE from 'three';

// Camera-facing ribbon segments rendered as instanced quads. Each Trail owns a
// list of points; the TrailSystem rebuilds the instance buffer every frame.

const vert = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColA;
attribute vec4 iColB;
attribute vec2 iWidth;
varying vec4 vColor;
varying float vSide;
#include <fog_pars_vertex>
void main(){
  float t = position.x + 0.5;
  vec4 a = modelViewMatrix * vec4(iA, 1.0);
  vec4 b = modelViewMatrix * vec4(iB, 1.0);
  vec4 mvPosition = mix(a, b, t);
  vec3 axis = b.xyz - a.xyz;
  vec3 side = cross(axis, mvPosition.xyz);
  float l = length(side);
  side = l > 1e-6 ? side / l : vec3(1.0, 0.0, 0.0);
  float w = mix(iWidth.x, iWidth.y, t);
  mvPosition.xyz += side * position.y * w;
  vColor = mix(iColA, iColB, t);
  vSide = position.y * 2.0;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying vec4 vColor;
varying float vSide;
uniform float uFogAmount;
#include <fog_pars_fragment>
void main(){
  float e = 1.0 - vSide * vSide;
  float a = vColor.a * e * e;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
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

export class Trail {
  /**
   * @param {object} o
   *  color: THREE.Color (head colour)  tailColor: THREE.Color
   *  width, widthGrow (m/s of age), alpha, pointLife (s, Infinity = persistent)
   *  minAlpha: alpha floor for persistent trails, spacing (m)
   */
  constructor(o) {
    this.color = new THREE.Color(o.color ?? 0xffffff);
    this.tailColor = new THREE.Color(o.tailColor ?? o.color ?? 0xffffff);
    this.width = o.width ?? 0.3;
    this.widthGrow = o.widthGrow ?? 0;
    this.alpha = o.alpha ?? 1;
    this.pointLife = o.pointLife ?? Infinity;
    this.minAlpha = o.minAlpha ?? 0.0;
    this.spacing = o.spacing ?? 1.2;
    this.fadeTime = o.fadeTime ?? 2.0;
    this.jitter = o.jitter ?? 0;
    this.points = []; // {x,y,z,t}
    this.head = new THREE.Vector3();
    this.hasHead = false;
    this.detached = false;
    this.fade = 1;
    this.dead = false;
  }

  push(p, time) {
    this.head.copy(p);
    this.hasHead = true;
    const last = this.points[this.points.length - 1];
    if (!last) {
      this.points.push({ x: p.x, y: p.y, z: p.z, t: time });
      return;
    }
    const dx = p.x - last.x, dy = p.y - last.y, dz = p.z - last.z;
    if (dx * dx + dy * dy + dz * dz > this.spacing * this.spacing) {
      const j = this.jitter;
      this.points.push({
        x: p.x + (Math.random() - 0.5) * j,
        y: p.y + (Math.random() - 0.5) * j,
        z: p.z + (Math.random() - 0.5) * j,
        t: time,
      });
    }
  }

  detach() {
    this.detached = true;
  }
}

export class TrailSystem {
  constructor(scene, { max = 8000, additive = true, fogAmount = 0.6, renderOrder = 5 } = {}) {
    this.max = max;
    this.trails = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aA = mk(3); this.aB = mk(3); this.aCA = mk(4); this.aCB = mk(4); this.aW = mk(2);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iColA', this.aCA);
    geo.setAttribute('iColB', this.aCB);
    geo.setAttribute('iWidth', this.aW);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFogAmount: { value: fogAmount } }]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: true,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  add(trail) {
    this.trails.push(trail);
    return trail;
  }

  clear() {
    this.trails.length = 0;
    this.geo.instanceCount = 0;
  }

  update(dt, time) {
    const A = this.aA.array, B = this.aB.array, CA = this.aCA.array, CB = this.aCB.array, W = this.aW.array;
    let n = 0;
    const max = this.max;
    for (let ti = this.trails.length - 1; ti >= 0; ti--) {
      const tr = this.trails[ti];
      if (tr.detached) {
        tr.fade -= dt / tr.fadeTime;
        if (tr.fade <= 0) tr.dead = true;
      }
      // Drop expired points.
      if (tr.pointLife !== Infinity) {
        let k = 0;
        while (k < tr.points.length && time - tr.points[k].t > tr.pointLife) k++;
        if (k > 0) tr.points.splice(0, k);
        if (tr.detached && tr.points.length < 2) tr.dead = true;
      }
      if (tr.dead) {
        this.trails[ti] = this.trails[this.trails.length - 1];
        this.trails.pop();
        continue;
      }
      const pts = tr.points;
      const np = pts.length;
      const total = np + (tr.hasHead && !tr.detached ? 1 : 0);
      if (total < 2) continue;
      const cr = tr.color.r, cg = tr.color.g, cb = tr.color.b;
      const tr2 = tr.tailColor.r, tg2 = tr.tailColor.g, tb2 = tr.tailColor.b;
      const pl = tr.pointLife;
      const finite = pl !== Infinity;
      let prevX, prevY, prevZ, prevA, prevW, prevR, prevG, prevB;
      for (let k = 0; k < total; k++) {
        let x, y, z, t;
        if (k < np) { const p = pts[k]; x = p.x; y = p.y; z = p.z; t = p.t; }
        else { x = tr.head.x; y = tr.head.y; z = tr.head.z; t = time; }
        const age = time - t;
        // u = 0 at tail, 1 at head
        const u = total > 1 ? k / (total - 1) : 1;
        let a;
        if (finite) a = Math.max(0, 1 - age / pl);
        else a = tr.minAlpha + (1 - tr.minAlpha) * u * u;
        a *= tr.alpha * tr.fade;
        const w = tr.width + tr.widthGrow * age;
        const mixT = finite ? Math.min(1, age / pl) : 1 - u;
        const r = cr + (tr2 - cr) * mixT, g = cg + (tg2 - cg) * mixT, b = cb + (tb2 - cb) * mixT;
        if (k > 0 && n < max) {
          const i3 = n * 3, i4 = n * 4, i2 = n * 2;
          A[i3] = prevX; A[i3 + 1] = prevY; A[i3 + 2] = prevZ;
          B[i3] = x; B[i3 + 1] = y; B[i3 + 2] = z;
          CA[i4] = prevR; CA[i4 + 1] = prevG; CA[i4 + 2] = prevB; CA[i4 + 3] = prevA;
          CB[i4] = r; CB[i4 + 1] = g; CB[i4 + 2] = b; CB[i4 + 3] = a;
          W[i2] = prevW; W[i2 + 1] = w;
          n++;
        }
        prevX = x; prevY = y; prevZ = z; prevA = a; prevW = w; prevR = r; prevG = g; prevB = b;
      }
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const [attr, s] of [[this.aA, 3], [this.aB, 3], [this.aCA, 4], [this.aCB, 4], [this.aW, 2]]) {
        attr.addUpdateRange(0, n * s);
        attr.needsUpdate = true;
      }
    }
  }
}
