import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './World.js';
import { Game } from './Game.js';
import { AudioEngine } from './Audio.js';
import { Input } from './ui/Input.js';
import { DomHud, VrHud, FloatingTexts } from './ui/Hud.js';
import { DECK_HEIGHT, EYE_HEIGHT } from './config.js';

// ---------------------------------------------------------------- renderer
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 3000);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.order = 'YXZ';

// The rig places the player (desktop camera or XR floor origin) on the tower deck.
const rig = new THREE.Group();
rig.position.set(0, DECK_HEIGHT, 0);
rig.add(camera);
scene.add(rig);

// ---------------------------------------------------------------- systems
const world = new World(scene);
const audio = new AudioEngine(camera);
const hud = new DomHud();
const vrHud = new VrHud(scene, world.consoleAnchor, DECK_HEIGHT);
const texts = new FloatingTexts(scene);
const game = new Game({ scene, camera, rig, renderer, world, audio, hud, vrHud, texts });
const input = new Input(game, renderer, camera, rig, renderer.domElement);
game.input = input;

// ---------------------------------------------------------------- post (desktop only)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.65, 0.45, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 78 : 62; // portrait phones need a wider view
  camera.updateProjectionMatrix();
  if (!renderer.xr.isPresenting) {
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- DOM / menu
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const btnPlay = document.getElementById('btn-play');
const btnVR = document.getElementById('btn-vr');
const menuHi = document.getElementById('menu-hi');

function syncDom() {
  const inXR = renderer.xr.isPresenting;
  const s = game.state;
  menuEl.classList.toggle('hidden', inXR || s !== 'menu');
  hud.show(!inXR && s !== 'menu');
  pauseEl.classList.toggle('hidden', inXR || !game.paused);
  menuHi.textContent = game.hiScore.toLocaleString();
  renderer.domElement.style.cursor = s === 'menu' || game.paused ? 'default' : 'none';
}
game.onStateChange = syncDom;

btnPlay.addEventListener('click', async (e) => {
  e.stopPropagation();
  await audio.init();
  game.startGame();
});
document.getElementById('btn-resume').addEventListener('click', () => game.togglePause(false));
document.getElementById('btn-quit').addEventListener('click', () => game.quitToMenu());
// any first interaction unlocks audio for the attract mode
window.addEventListener('pointerdown', () => audio.init(), { once: true });

// ---------------------------------------------------------------- WebXR
let xrSession = null;
async function setupVRButton() {
  if (!('xr' in navigator)) {
    btnVR.textContent = 'VR NOT AVAILABLE';
    btnVR.title = 'WebXR requires a compatible browser and a secure (https) context.';
    return;
  }
  let ok = false;
  try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { ok = false; }
  if (!ok) {
    btnVR.textContent = 'VR NOT SUPPORTED';
    return;
  }
  btnVR.disabled = false;
  btnVR.textContent = 'ENTER VR';
  btnVR.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (xrSession) return xrSession.end();
    await audio.init();
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      await renderer.xr.setSession(session);
    } catch (err) {
      console.error(err);
      btnVR.textContent = 'VR FAILED — RETRY';
    }
  });
}
setupVRButton();

renderer.xr.addEventListener('sessionstart', () => {
  xrSession = renderer.xr.getSession();
  renderer.xr.setFoveation(1);
  world.setQuality(true);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  if (game.state === 'menu') game.message('MISSILE COMMAND', 'PULL TRIGGER TO DEPLOY');
  syncDom();
});
renderer.xr.addEventListener('sessionend', () => {
  xrSession = null;
  world.setQuality(false);
  camera.position.set(0, EYE_HEIGHT, 0);
  if (game.state === 'menu') game.message('');
  else if (game.state !== 'gameover') game.togglePause(true);
  else game.quitToMenu();
  resize();
  syncDom();
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const shakeOffset = new THREE.Vector3();
let first = true;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const inXR = renderer.xr.isPresenting;

  // undo last frame's shake before simulation
  camera.position.sub(shakeOffset);
  shakeOffset.set(0, 0, 0);

  game.update(dt);

  if (!inXR) {
    if (game.state === 'menu') {
      // slow cinematic pan in the attract mode
      const t = performance.now() * 0.001;
      camera.rotation.set(0.2 + Math.sin(t * 0.13) * 0.05, Math.sin(t * 0.09) * 0.35, 0);
    }
    if (game.shake > 0) {
      const s = game.shake * game.shake * 0.35;
      shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5);
      camera.position.add(shakeOffset);
    }
    composer.render(dt);
  } else {
    renderer.render(scene, camera);
  }

  if (first) {
    first = false;
    document.getElementById('loading').classList.add('done');
    syncDom();
  }
});

// handy for debugging from the console
window.__game = game;
