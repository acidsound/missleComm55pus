import * as THREE from 'three';
import { glowTexture } from '../utils/textures.js';
import { heightAt } from '../World.js';
import { AMMO_PER_BATTERY } from '../config.js';
import { rand, damp } from '../utils/math.js';

const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.9, metalness: 0.05 });
const metal = new THREE.MeshStandardMaterial({ color: 0x4a525e, roughness: 0.45, metalness: 0.8 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.6, metalness: 0.6 });
const missileWhite = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.4, metalness: 0.3 });
const cyanEmissive = new THREE.MeshStandardMaterial({ color: 0x0a2a30, emissive: 0x40e8ff, emissiveIntensity: 2.5 });

function missileGeometry() {
  const body = new THREE.CylinderGeometry(0.11, 0.11, 1.3, 8).translate(0, 0.65, 0);
  const nose = new THREE.ConeGeometry(0.11, 0.35, 8).translate(0, 1.475, 0);
  return { body, nose };
}
const mg = missileGeometry();

export class Battery {
  constructor(scene, fx, pos, index, name) {
    this.scene = scene;
    this.fx = fx;
    this.index = index;
    this.name = name;
    this.alive = true;
    this.ammo = AMMO_PER_BATTERY;
    this.pos = pos.clone();
    this.pos.y = heightAt(pos.x, pos.z);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(-pos.x, -pos.z) + Math.PI;
    scene.add(this.group);

    // bunker base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 1.4, 6), concrete);
    base.position.y = 0.5;
    base.castShadow = base.receiveShadow = true;
    this.group.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.06, 6, 6), cyanEmissive.clone());
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 6;
    ring.position.y = 1.22;
    this.statusRing = ring;
    this.group.add(ring);

    // turret
    this.turret = new THREE.Group();
    this.turret.position.y = 1.2;
    this.group.add(this.turret);
    const tBase = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, 0.9, 16), metal);
    tBase.position.y = 0.45;
    tBase.castShadow = true;
    this.turret.add(tBase);
    this.cradle = new THREE.Group();
    this.cradle.position.y = 1.4;
    this.turret.add(this.cradle);
    const pod = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 3.6), darkMetal);
    pod.position.z = -0.4;
    pod.castShadow = true;
    this.cradle.add(pod);
    // tube openings
    const tubeGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.1, 12);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 1 });
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const t = new THREE.Mesh(tubeGeo, tubeMat);
        t.rotation.x = Math.PI / 2;
        t.position.set(-0.65 + c * 0.65, -0.32 + r * 0.64, -2.23);
        this.cradle.add(t);
      }
    }
    const arms = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 0.6), metal);
    this.cradle.add(arms);
    this.cradle.rotation.x = 0.9; // pitched upward (local -Z forward raised)

    // radar
    this.radar = new THREE.Group();
    this.radar.position.set(3.4, 1.2, 2.2);
    this.group.add(this.radar);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), metal);
    mast.position.y = 1.2;
    this.radar.add(mast);
    const dish = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 0.08), metal);
    dish.position.y = 2.5;
    dish.rotation.x = -0.3;
    this.radar.add(dish);

    // ammo rack: 10 missiles on a rail beside turret
    this.ammoMeshes = [];
    for (let i = 0; i < AMMO_PER_BATTERY; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(mg.body, missileWhite);
      const n = new THREE.Mesh(mg.nose, cyanEmissive);
      b.castShadow = true;
      g.add(b, n);
      const row = Math.floor(i / 5), col = i % 5;
      g.position.set(-4.2 + col * 0.5, 1.2, 1.2 + row * 0.6);
      this.group.add(g);
      this.ammoMeshes.push(g);
    }

    // status beacon
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x40e8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beacon.scale.setScalar(2.2);
    this.beacon.position.set(3.4, 4.1, 2.2);
    this.group.add(this.beacon);

    this.aimYaw = 0;
    this.aimPitch = 0.9;
    this.targetYaw = 0;
    this.targetPitch = 0.9;
    this.recoil = 0;
    this.time = rand(0, 10);
    this.fireTimer = 0;
    this.muzzleLocal = new THREE.Vector3(0, 0, -2.3);
  }

  get targetPoint() {
    return this.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
  }

  canFire() {
    return this.alive && this.ammo > 0;
  }

  /** Aim turret at world point; returns muzzle world position. */
  aimAt(target) {
    const local = this.group.worldToLocal(target.clone());
    const from = new THREE.Vector3(0, 2.6, 0);
    const d = local.sub(from);
    this.targetYaw = Math.atan2(-d.x, -d.z);
    this.targetPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    // snap so the missile visually leaves from the right direction
    this.aimYaw = this.targetYaw;
    this.aimPitch = this.targetPitch;
    this._applyAim();
    this.turret.updateMatrixWorld(true);
    const p = this.muzzleLocal.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.3), 0));
    return this.cradle.localToWorld(p);
  }

  _applyAim() {
    this.turret.rotation.y = this.aimYaw;
    this.cradle.rotation.x = this.aimPitch;
    this.cradle.position.z = this.recoil * 0.35;
  }

  consume() {
    this.ammo--;
    this.recoil = 1;
    this._syncAmmo();
  }

  _syncAmmo() {
    this.ammoMeshes.forEach((m, i) => (m.visible = this.alive && i < this.ammo));
    const col = !this.alive ? 0xff2a1a : this.ammo === 0 ? 0xff2a1a : this.ammo <= 3 ? 0xffb547 : 0x40e8ff;
    this.beacon.material.color.set(col);
    this.statusRing.material.emissive.set(col);
  }

  refill() {
    this.alive = true;
    this.ammo = AMMO_PER_BATTERY;
    this.turret.visible = true;
    this.turret.rotation.z = 0;
    this._syncAmmo();
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.ammo = 0;
    this.turret.rotation.z = 0.5;
    this._syncAmmo();
    this.fireTimer = 0;
  }

  update(dt) {
    this.time += dt;
    this.recoil = damp(this.recoil, 0, 6, dt);
    if (this.alive) {
      this.targetPitch = this.targetPitch + (0.9 - this.targetPitch) * Math.min(1, dt * 0.3);
      this.aimYaw = damp(this.aimYaw, this.targetYaw, 4, dt);
      this.aimPitch = damp(this.aimPitch, this.targetPitch, 4, dt);
      this._applyAim();
      this.radar.rotation.y += dt * 1.5;
      this.beacon.material.opacity = 0.55 + 0.45 * Math.sin(this.time * 4);
    } else {
      this.beacon.material.opacity = Math.sin(this.time * 9) > 0 ? 1 : 0.1;
      if (Math.random() < 0.3) {
        const p = this.pos;
        this.fx.fire.spawn(p.x + rand(-2, 2), p.y + 2, p.z + rand(-2, 2), 0, rand(2, 4), 0, {
          life: rand(0.5, 1), size: rand(1.5, 2.5), sizeEnd: 0.4, color: 0xffb060, colorEnd: 0x601000, alpha: 0.8,
        });
        this.fx.smoke.spawn(p.x + rand(-2, 2), p.y + 4, p.z + rand(-2, 2), 0.8, rand(3, 5), 0, {
          life: rand(4, 7), size: 2, sizeEnd: 9, color: 0x262422, colorEnd: 0x101114, alpha: 0.4, drag: 0.2, fadeIn: 0.2,
        });
      }
    }
  }
}
