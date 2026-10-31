import * as THREE from 'three';
import { createNoise2D, fbm, smoothstep, lerp, GLSL_NOISE, seeded } from './utils/math.js';
import { glowTexture } from './utils/textures.js';
import { DECK_HEIGHT, SLOT_COUNT, slotPosition, SLOT_RADIUS } from './config.js';

const noise = createNoise2D(7);
const slotCenters = [];
for (let i = 0; i < SLOT_COUNT; i++) slotCenters.push(slotPosition(i));

function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  const fwd = r > 0.001 ? -z / r : 1; // cos of angle to forward
  let h = fbm(noise, x * 0.012, z * 0.012, 4) * 2.6;
  // mountains: closer behind/sides, further in front
  const ringStart = lerp(80, 210, smoothstep(-0.3, 0.8, fwd));
  const m = smoothstep(ringStart, ringStart + 230, r);
  const ridge = 1 - Math.abs(fbm(noise, x * 0.0045 + 31.7, z * 0.0045 - 12.1, 5));
  h += m * (25 + ridge * ridge * 115 + fbm(noise, x * 0.02, z * 0.02, 3) * 12);
  // gentle bowl under the tower
  h -= smoothstep(30, 0, r) * 0.5;
  return h;
}

const slotHeights = slotCenters.map((p) => rawHeight(p.x, p.z));

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (let i = 0; i < slotCenters.length; i++) {
    const c = slotCenters[i];
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < 16) h = lerp(h, slotHeights[i], smoothstep(16, 9, d));
  }
  return h;
}

// ---------------------------------------------------------------------------
const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashColor;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith = vec3(0.004, 0.007, 0.022);
  vec3 mid = vec3(0.018, 0.026, 0.07);
  vec3 horizon = vec3(0.09, 0.06, 0.10);
  vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
  col = mix(col, zenith, smoothstep(0.18, 0.85, h));
  // warm glow of burning horizon in front
  vec3 flatDir = normalize(vec3(d.x, 0.0001, d.z));
  float front = max(0.0, dot(flatDir, vec3(0.0, 0.0, -1.0)));
  col += vec3(0.28, 0.08, 0.025) * pow(max(0.0, 1.0 - abs(h)), 14.0) * (0.25 + 0.75 * front);

  // stars
  if (h > -0.02) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float rnd = hash13(cell);
    if (rnd > 0.985) {
      vec3 off = vec3(hash13(cell + 1.3), hash13(cell + 7.1), hash13(cell + 3.7)) * 0.6 + 0.2;
      float dist = length(fract(p) - off);
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + rnd * 4.0) + rnd * 100.0);
      float b = smoothstep(0.16, 0.0, dist) * (rnd - 0.985) * 66.0 * tw;
      vec3 sc = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 9.0));
      col += sc * b * smoothstep(-0.02, 0.15, h);
    }
    // milky way band
    float band = exp(-pow(dot(d, normalize(vec3(0.6, 0.35, 0.72))) * 3.2, 2.0));
    col += vec3(0.05, 0.05, 0.08) * band * fbm3(d * 6.0) * smoothstep(0.0, 0.3, h);
  }

  // moon
  float md = dot(d, uMoonDir);
  float disc = smoothstep(0.99955, 0.99968, md);
  float crater = fbm3(d * 400.0);
  col += vec3(1.0, 0.96, 0.88) * disc * (1.4 + crater * 0.6);
  col += vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 900.0) * 0.5;
  col += vec3(0.15, 0.2, 0.35) * pow(max(md, 0.0), 24.0) * 0.18;

  // cloud layer
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12);
    float n = fbm3(vec3(uv * 1.3 + vec2(uTime * 0.004, uTime * 0.002), 3.1));
    float m = smoothstep(0.48, 0.78, n) * smoothstep(0.0, 0.25, h) * 0.9;
    float lit = pow(max(md, 0.0), 6.0);
    vec3 cc = mix(vec3(0.03, 0.035, 0.06), vec3(0.22, 0.25, 0.34), lit) + vec3(0.18, 0.06, 0.02) * front * smoothstep(0.35, 0.0, h);
    cc += uFlashColor * uFlash * 0.6;
    col = mix(col, cc, m);
  }
  col += uFlashColor * uFlash * 0.08 * smoothstep(0.6, 0.0, h);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class World {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.time = 0;
    this.moonDir = new THREE.Vector3(0.45, 0.42, -0.79).normalize();
    this.flash = 0;

    scene.fog = new THREE.FogExp2(0x120d18, 0.0032);
    scene.background = new THREE.Color(0x03040a);

    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildWater();
    this._buildTower();
    this._buildLamps();
  }

  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uMoonDir: { value: this.moonDir },
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 0.55, 0.25) },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = sky;
    this.scene.add(sky);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x3a4a80, 0x120c08, 0.9);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0xa8bcff, 1.4);
    moon.position.copy(this.moonDir).multiplyScalar(200);
    moon.target.position.set(0, 0, -50);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 450;
    moon.shadow.bias = -0.0008;
    moon.shadow.normalBias = 0.4;
    this.scene.add(moon, moon.target);
    this.moon = moon;
  }

  _buildTerrain() {
    const size = 1800, seg = 280;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x1d2416);
    const cDirt = new THREE.Color(0x2a241c);
    const cRock = new THREE.Color(0x34343a);
    const cSnow = new THREE.Color(0x8a96b4);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // concentrate resolution: distort grid toward centre
      const h = heightAt(x, z);
      pos.setY(i, h);
      const n = noise(x * 0.05, z * 0.05) * 0.5 + 0.5;
      c.copy(cLow).lerp(cDirt, n * 0.6);
      c.lerp(cRock, smoothstep(15, 70, h));
      c.lerp(cSnow, smoothstep(110, 170, h + n * 20));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.terrain = mesh;
    this.scene.add(mesh);
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(1800, 1800);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x050a14, roughness: 0.12, metalness: 0.85 });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -1.6;
    this.scene.add(water);
  }

  _buildTower() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.55, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.8, metalness: 0.4 });
    const ground = heightAt(0, 0);
    const H = DECK_HEIGHT - ground;
    // legs
    const legGeo = new THREE.BoxGeometry(0.5, H, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(legGeo, steel);
      leg.position.set(Math.cos(a) * 2.2, ground + H / 2, Math.sin(a) * 2.2);
      leg.castShadow = true;
      g.add(leg);
    }
    // braces
    const braceGeo = new THREE.BoxGeometry(0.15, 0.15, 3.3);
    for (let y = ground + 3; y < DECK_HEIGHT - 1; y += 3.5) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const b = new THREE.Mesh(braceGeo, dark);
        b.position.set(Math.cos(a) * 2.2, y, Math.sin(a) * 2.2);
        b.rotation.y = -a;
        b.rotation.x = 0.0;
        g.add(b);
      }
    }
    // central shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, H, 12), dark);
    shaft.position.y = ground + H / 2;
    g.add(shaft);
    // deck
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.0, 0.5, 8), steel);
    deck.position.y = DECK_HEIGHT - 0.25;
    deck.receiveShadow = true;
    g.add(deck);
    // floor grating plate with emissive edge strip
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.2, 0.02, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.9, metalness: 0.5 }),
    );
    plate.position.y = DECK_HEIGHT + 0.01;
    g.add(plate);
    const strip = new THREE.Mesh(
      new THREE.TorusGeometry(3.25, 0.03, 6, 8),
      new THREE.MeshBasicMaterial({ color: 0x40e8ff }),
    );
    strip.rotation.x = Math.PI / 2;
    strip.rotation.z = Math.PI / 8;
    strip.position.y = DECK_HEIGHT + 0.03;
    g.add(strip);
    // railing
    const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = new THREE.Mesh(postGeo, steel);
      p.position.set(Math.cos(a) * 3.3, DECK_HEIGHT + 0.5, Math.sin(a) * 3.3);
      g.add(p);
    }
    const rail = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.04, 6, 48), steel);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = DECK_HEIGHT + 1.0;
    g.add(rail);
    // console
    const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.5), dark);
    consoleBody.position.set(0, DECK_HEIGHT + 0.45, -1.2);
    g.add(consoleBody);
    const consoleTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.62), steel);
    consoleTop.position.set(0, DECK_HEIGHT + 0.93, -1.18);
    consoleTop.rotation.x = 0.55;
    g.add(consoleTop);
    // beacon mast behind
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 6), steel);
    mast.position.set(0, DECK_HEIGHT + 2.5, 2.9);
    g.add(mast);
    const beaconMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.beacon = new THREE.Sprite(beaconMat);
    this.beacon.scale.setScalar(1.6);
    this.beacon.position.set(0, DECK_HEIGHT + 5.1, 2.9);
    g.add(this.beacon);
    // radar dish on mast
    this.radar = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), steel);
    dish.material = steel.clone();
    dish.material.side = THREE.DoubleSide;
    dish.rotation.x = Math.PI / 2;
    this.radar.add(dish);
    this.radar.position.set(0, DECK_HEIGHT + 4.2, 2.9);
    g.add(this.radar);

    this.consoleAnchor = new THREE.Vector3(0, DECK_HEIGHT + 0.96, -1.18);
    this.scene.add(g);
    this.tower = g;
  }

  _buildLamps() {
    // Street / highway lights scattered across the valley.
    const rng = seeded(99);
    const pts = [];
    const cols = [];
    const warm = new THREE.Color(0xffa64a);
    const cool = new THREE.Color(0x9fd0ff);
    const addLamp = (x, z, c, lift = 0.6) => {
      pts.push(x, heightAt(x, z) + lift, z);
      cols.push(c.r, c.g, c.b);
    };
    // arc highway linking all slots
    for (let a = -1.0; a <= 1.0; a += 0.008) {
      const r = SLOT_RADIUS + 12 + Math.sin(a * 7) * 3;
      addLamp(Math.sin(a) * r, -Math.cos(a) * r, warm);
    }
    // radial roads from the tower to each slot
    for (let i = 0; i < SLOT_COUNT; i++) {
      const p = slotPosition(i);
      for (let t = 0.12; t < 0.88; t += 0.028) addLamp(p.x * t, p.z * t, i % 4 === 0 ? cool : warm);
    }
    // farms / villages
    for (let i = 0; i < 260; i++) {
      const a = (rng() - 0.5) * Math.PI * 1.6;
      const r = 30 + rng() * 140;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      if (heightAt(x, z) > 12) continue;
      addLamp(x, z, rng() < 0.8 ? warm : cool, 0.4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.3, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: true,
    });
    this.lamps = new THREE.Points(geo, mat);
    this.scene.add(this.lamps);
  }

  setQuality(xr) {
    // Cheaper settings for standalone headsets.
    this.moon.castShadow = !xr;
  }

  skyFlash(intensity, color) {
    this.flash = Math.min(1.5, this.flash + intensity);
    if (color) this.skyMat.uniforms.uFlashColor.value.set(color);
  }

  update(dt) {
    this.time += dt;
    this.skyMat.uniforms.uTime.value = this.time;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.skyMat.uniforms.uFlash.value = this.flash;
    this.beacon.material.opacity = Math.sin(this.time * 3) > 0.6 ? 1 : 0.08;
    this.radar.rotation.y += dt * 1.2;
  }
}
