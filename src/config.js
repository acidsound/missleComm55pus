import * as THREE from 'three';

// World layout. Units are metres. The player stands on a command tower at the
// origin looking down -Z over a valley holding 6 cities and 3 missile batteries.

export const DECK_HEIGHT = 16; // top of command tower
export const EYE_HEIGHT = 1.65; // desktop camera height above deck
export const SLOT_RADIUS = 58;
export const SLOT_ARC = THREE.MathUtils.degToRad(100); // total arc width
export const SLOT_COUNT = 9; // B C C C B C C C B
export const BATTERY_SLOTS = [0, 4, 8];
export const BATTERY_NAMES = ['ALPHA', 'DELTA', 'OMEGA'];
export const CITY_NAMES = ['HALCYON', 'VESPER', 'MERIDIAN', 'AURORA', 'SOLACE', 'BASTION'];

export const AMMO_PER_BATTERY = 10;
export const SPAWN_ALTITUDE = [125, 160];
export const SPAWN_RADIUS = [120, 190];
export const SPAWN_ARC = THREE.MathUtils.degToRad(150);

export const INTERCEPTOR = {
  startSpeed: 25,
  maxSpeed: 115,
  accel: 220,
  blastRadius: 8.5,
  grow: 0.42,
  hold: 0.55,
  shrink: 0.75,
};

export const SCORE = {
  missile: 25,
  mirv: 25,
  flyer: 100,
  smart: 125,
  ammoBonus: 5,
  cityBonus: 100,
  bonusCityEvery: 10000,
};

export function slotAngle(i) {
  return -SLOT_ARC / 2 + (SLOT_ARC * i) / (SLOT_COUNT - 1);
}

export function slotPosition(i, radius = SLOT_RADIUS) {
  const a = slotAngle(i);
  // slight staggering so the line of defence is not a perfect arc
  const r = radius + (i % 2 === 0 ? 0 : 6);
  return new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r);
}

export function waveConfig(n) {
  return {
    missiles: Math.min(10 + n * 3, 48),
    speed: Math.min(7 + n * 1.15, 26),
    maxConcurrent: Math.min(4 + Math.ceil(n * 0.9), 16),
    salvo: [1, Math.min(2 + Math.floor(n / 2), 6)],
    salvoDelay: [Math.max(0.9, 3.2 - n * 0.18), Math.max(1.8, 5 - n * 0.22)],
    mirvChance: n >= 2 ? Math.min(0.12 + n * 0.035, 0.42) : 0,
    flyers: n >= 3 ? Math.min(1 + Math.floor((n - 3) / 2), 5) : 0,
    smart: n >= 5 ? Math.min(n - 4, 7) : 0,
    multiplier: Math.min(1 + Math.floor((n - 1) / 2), 6),
  };
}
