# MISSILE COMMAND XR

A 3D WebXR remake of the classic arcade game *Missile Command*, built with Three.js. All graphics and audio are generated procedurally, so the game needs no external assets.

- **VR**: Quest / PCVR browsers (WebXR `immersive-vr`). Point with either controller and pull the trigger to launch.
- **Desktop**: aim with the mouse and click to launch. `1/2/3` or `A/S/D` fire from a specific battery. `Esc` pauses.
- **Mobile**: tap to launch.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:https    # LAN + self-signed HTTPS (needed for headsets)
npm run build        # outputs dist/ (static, deploy anywhere over https)
```

To play on a Quest, run `npm run dev:https`, open `https://<your-LAN-IP>:5173` in the Quest Browser, accept the certificate warning, and press **ENTER VR**.

## Features

- Night battlefield: a shader sky (stars, moon, clouds, Milky Way), a mountain valley, sweeping searchlights, and cities lit by procedural windows
- Fireball, shockwave, spark, smoke, and debris effects, plus ribbon trails and dynamic explosion lights
- Chain reactions, MIRV warheads that split, bombers and satellites, and smart bombs that dodge your blasts
- Auto-ranging reticle: you choose the direction, and the detonation depth snaps to the nearest threat (with lead)
- End-of-wave bonus tally, a bonus city every 10,000 points, a saved high score, and an attract mode where an AI gunner plays the menu
- Spatial HRTF audio, synthesised SFX, generative music that intensifies with the threat level, and controller haptics
- VR console HUD on the tower plus a floating message board. Bloom and shadows are turned off in XR to keep the framerate up

## Structure

See [PLAN.md](./PLAN.md) for the design and module overview.

## Tests

```bash
npm run build && npx vite preview --port 4173 &
node scripts/smoke.mjs    # screenshots + console errors (headless Chrome)
node scripts/flow.mjs     # wave clear → tally → next wave → game over → menu
```
