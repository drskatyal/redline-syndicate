# REDLINE SYNDICATE

**REDLINE SYNDICATE** is an original, 4K HDR WebGL2 high-speed motorcycle combat racing game built with **Three.js + Vite + TypeScript**, featuring custom `onBeforeCompile` wet-asphalt PBR shaders, 4x MSAA HDR post-processing, an interactive 3D hyperbike hangar & customizer, five global districts, Wanted Heat 1★–5★ pursuits with helicopter searchlights and SWAT barricades, Reflex Bullet-Time, Tactical EMP Shockwaves, and procedural WebAudio synth-rock soundtracks.

## Features

- **4K HDR Rendering Pipeline**: Multi-sampled `HalfFloatType` `EffectComposer`, `RoomEnvironment` IBL reflections, ACES Filmic tone mapping, controlled emissive bloom, edge chromatic aberration at 200+ MPH, and switchable `ULTRA 4K` / `HIGH HDR` / `PERFORMANCE` modes.
- **Custom Wet-Asphalt Shader**: Procedural diffuse, roughness, bump, and puddle-mask textures with real-time `uWetness` specular puddle reflections and illuminated center lane reflectors.
- **5 Global Lockdown Districts**: *Vice Bay Interstate*, *Neo-Kowloon Skydeck*, *Al-Mirage Hyperway*, *Kronos Glacier Viaduct*, and *San Verona Lockdown*.
- **6 Unlockable Hyperbikes & Livery Customizer**: Live 3D rotating hangar with paint & neon underglow swatches plus 4×4 performance upgrades.
- **High-Speed Combat & Abilities**: Left/Right weapon strikes (`Q`/`E` or `Space`), Heavy Kick (`C`), Nitro (`Shift`), **Tactical EMP Shockwave (`F`)**, and **Reflex Bullet-Time (`Tab`)**.

## Controls

| Action | Key |
| :--- | :--- |
| Throttle / Brake | `W` / `S` or `↑` / `↓` |
| Steer & Lean | `A` / `D` or `←` / `→` |
| Nitro Afterburner | `Shift` |
| Melee Strike (Auto / L / R) | `Space` / `Q` / `E` |
| Heavy Kick / Ram | `C` |
| Tactical EMP Shockwave | `F` |
| Reflex Bullet-Time | `Tab` or `R` |
| Cycle Camera | `V` |
| Pause / Settings | `Esc` or `P` |

## Local Development

```bash
npm install
npm run build
npm start
```
