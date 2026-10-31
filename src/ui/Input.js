import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { reticleTexture } from '../utils/textures.js';
import { damp } from '../utils/math.js';
import { heightAt } from '../World.js';

// Aim with auto-ranging: direction is always exactly where the player points;
// the detonation *depth* snaps to the threat closest to the aim ray.

const LOCK_ANGLE = THREE.MathUtils.degToRad(7);
const DEFAULT_RANGE = 85;
const MIN_RANGE = 14;
const MAX_RANGE = 260;

class Pointer {
  constructor(scene, color = 0x5ff6ff) {
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.range = DEFAULT_RANGE;
    this.point = new THREE.Vector3();
    this.locked = null;
    this.active = false;
    this.mat = new THREE.SpriteMaterial({
      map: reticleTexture(), color, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    });
    this.reticle = new THREE.Sprite(this.mat);
    this.reticle.renderOrder = 60;
    this.reticle.visible = false;
    scene.add(this.reticle);
    this.baseColor = new THREE.Color(color);
    this.lockColor = new THREE.Color(0xffb547);
    this.spin = 0;
  }
}

export class Input {
  constructor(game, renderer, camera, rig, dom) {
    this.game = game;
    this.renderer = renderer;
    this.camera = camera;
    this.rig = rig;
    this.dom = dom;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(0, 0.1);
    this.mouseInside = false;
    this.lookYaw = 0;
    this.lookPitch = 0;

    this.desktop = new Pointer(game.scene);
    this.pointers = [this.desktop];

    dom.addEventListener('pointermove', (e) => this._onMove(e));
    dom.addEventListener('pointerdown', (e) => {
      this._onMove(e);
      if (e.button === 0 || e.pointerType === 'touch') game.handleFire(this.desktop, -1);
    });
    dom.addEventListener('pointerleave', () => (this.mouseInside = false));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      const map = { Digit1: 0, Digit2: 1, Digit3: 2, KeyA: 0, KeyS: 1, KeyD: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };
      if (e.code in map) game.handleFire(this.desktop, map[e.code]);
      if (e.code === 'Space') game.handleFire(this.desktop, -1);
      if (e.code === 'Escape' || e.code === 'KeyP') game.togglePause();
    });

    this._setupXR();
  }

  _onMove(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.mouseInside = true;
  }

  _setupXR() {
    const factory = new XRControllerModelFactory();
    this.xrPointers = [];
    for (let i = 0; i < 2; i++) {
      const ctrl = this.renderer.xr.getController(i);
      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      this.rig.add(ctrl, grip);
      const p = new Pointer(this.game.scene, i === 0 ? 0x5ff6ff : 0x8affc8);
      p.controller = ctrl;
      p.hand = i;
      // laser beam
      const beamGeo = new THREE.CylinderGeometry(0.0035, 0.0012, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({ color: p.baseColor, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      p.beam = new THREE.Mesh(beamGeo, beamMat);
      p.beam.visible = false;
      ctrl.add(p.beam);
      ctrl.addEventListener('connected', (e) => {
        p.inputSource = e.data;
        p.active = e.data.targetRayMode === 'tracked-pointer' || e.data.targetRayMode === 'screen';
        p.beam.visible = p.active && e.data.targetRayMode === 'tracked-pointer';
      });
      ctrl.addEventListener('disconnected', () => {
        p.active = false;
        p.inputSource = null;
        p.beam.visible = false;
        p.reticle.visible = false;
      });
      ctrl.addEventListener('selectstart', () => {
        if (!p.active) return;
        this.game.handleFire(p, -1);
      });
      ctrl.addEventListener('squeezestart', () => this.game.handleSqueeze(p));
      this.xrPointers.push(p);
    }
  }

  haptic(p, intensity = 0.6, ms = 60) {
    const gp = p?.inputSource?.gamepad;
    const act = gp?.hapticActuators?.[0] ?? gp?.vibrationActuator;
    try {
      if (act?.pulse) act.pulse(intensity, ms);
      else if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch { /* ignore */ }
  }

  get xr() {
    return this.renderer.xr.isPresenting;
  }

  activePointers() {
    return this.xr ? this.xrPointers.filter((p) => p.active) : [this.desktop];
  }

  update(dt, enemies, aimEnabled) {
    if (this.xr) {
      this.desktop.reticle.visible = false;
      for (const p of this.xrPointers) {
        if (!p.active) continue;
        p.controller.updateMatrixWorld(true);
        p.origin.setFromMatrixPosition(p.controller.matrixWorld);
        p.dir.set(0, 0, -1).transformDirection(p.controller.matrixWorld);
        this._solve(p, dt, enemies, aimEnabled);
        p.beam.scale.set(1, 1, Math.min(p.range, 60));
      }
    } else {
      // desktop: subtle head-look following the cursor
      const tx = this.mouseInside ? this.ndc.x : 0;
      const ty = this.mouseInside ? this.ndc.y : 0;
      this.lookYaw = damp(this.lookYaw, -tx * 0.32, 3, dt);
      this.lookPitch = damp(this.lookPitch, 0.17 + ty * 0.2, 3, dt);
      this.camera.rotation.set(this.lookPitch, this.lookYaw, 0, 'YXZ');
      this.camera.updateMatrixWorld(true);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      this.desktop.origin.copy(this.raycaster.ray.origin);
      this.desktop.dir.copy(this.raycaster.ray.direction);
      this.desktop.active = true;
      this._solve(this.desktop, dt, enemies, aimEnabled);
    }
  }

  _solve(p, dt, enemies, aimEnabled) {
    const o = p.origin, d = p.dir;
    let best = null, bestAng = LOCK_ANGLE, bestDepth = 0;
    const tmp = new THREE.Vector3();
    for (const e of enemies) {
      if (!e.alive) continue;
      // lead the target by approximate interceptor flight time
      const dist = o.distanceTo(e.pos);
      const tFlight = Math.min(2.5, dist / 95 + 0.35);
      tmp.copy(e.pos).addScaledVector(e.vel, tFlight).sub(o);
      const depth = tmp.dot(d);
      if (depth < MIN_RANGE) continue;
      const ang = tmp.angleTo(d);
      if (ang < bestAng) {
        bestAng = ang;
        best = e;
        bestDepth = depth;
      }
    }
    let target;
    if (best) target = bestDepth;
    else {
      // ground intersection by marching the heightfield
      target = DEFAULT_RANGE;
      if (d.y < -0.02) {
        let prev = 0;
        for (let s = 4; s < MAX_RANGE; s += 3) {
          const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
          if (y <= heightAt(x, z) + 1.5) {
            target = (prev + s) / 2;
            break;
          }
          prev = s;
        }
      }
    }
    target = THREE.MathUtils.clamp(target, MIN_RANGE, MAX_RANGE);
    p.range = best ? damp(p.range, target, 22, dt) : damp(p.range, target, 10, dt);
    p.locked = best;
    p.point.copy(o).addScaledVector(d, p.range);

    const r = p.reticle;
    r.visible = aimEnabled;
    r.position.copy(p.point);
    const ang = best ? 0.05 : 0.04;
    p.spin += dt * (best ? 4 : 0.8);
    r.material.rotation = p.spin;
    const sc = p.range * ang;
    r.scale.set(sc, sc, 1);
    r.material.color.copy(best ? p.lockColor : p.baseColor);
  }
}
