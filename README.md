# Texture Studio

Apply seamless texture patterns to 3D models in the browser. Load a model, select a surface or
whole part, pick a built-in or custom pattern, preview the look, apply it to the mesh, and save
variations for later.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open `http://localhost:5173`. The app must be served over HTTP — opening `index.html`
directly will not work. If the 3D view is blank, enable hardware acceleration in your
browser settings and reload.

To expose the dev server on your LAN:

```bash
npm run host
```

## Build

```bash
npm run build
npm run preview
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run host` | Dev server bound to all interfaces |
| `npm run build` | Typecheck and production build |
| `npm run preview` | Serve the production build locally |
| `npm run test:load -- <path>` | CLI smoke test for model loading |

Example:

```bash
npm run test:load -- "public/samples/cube.3mf"
```

## Supported formats

| Format | Extension |
|--------|-----------|
| STL    | `.stl`    |
| OBJ    | `.obj`    |
| GLB    | `.glb`    |
| GLTF   | `.gltf`   |
| 3MF    | `.3mf`    |

Models are centered and scaled to fit the workspace on load. Sample models are in
`public/samples/` (`cube.3mf`, `cube.stl`).

## Workflow

1. **Load a model** from the sidebar or by dragging a file into the workspace.
2. **Select** a surface or a whole part:
   - *Surface* mode click-selects a face; **Angle threshold** expands the selection to
     similar-facing faces (use **Connected only** to stay within one connected panel).
   - *Part* mode selects an entire mesh.
3. **Choose a texture** from the library (Hex, Grid, Diamond, Honeycomb, Scales, Ribbed,
   Dots, Waves, Zigzag, Brick, Crosshatch, Cracks), or **Load Texture** to upload your own
   PNG/JPG/WebP height mask (light areas raise, dark areas stay flat).
4. **Adjust** scale, rotation, offset, and depth (0–2). Switch between **Emboss** and
   **Engrave**.
5. **Preview** shows the pattern on the selected area using the same shader mapping as Apply.
   Part mode maps all faces; surface mode maps the selected faces only.
6. **Apply texture** commits the pattern to the mesh. Applied regions use bump-map shading —
   the base surface color stays the same; pattern detail comes from shadows and highlights.
   **Reset surface pattern** clears one area; **Reset to original** clears everything.
7. **Variations** save and restore pattern placements and applied textures for the current
   model. Variations are stored in the browser (localStorage). You can also export or import
   a variation as JSON.

## Custom textures

Uploaded height masks are saved automatically in the browser (up to 32 textures). They persist
across reloads and are available in the Texture Library until you remove them. Variations that
reference custom texture IDs require those textures to still be present in localStorage.

## Variations

The Variations panel lets you:

- **Save** the current pattern placements and applied surfaces under a name
- **Update** an existing variation after further edits
- **Load** a saved variation onto the same model file
- **Rename**, **duplicate**, or **delete** variations
- **Export JSON** or **import JSON** to move variations between browsers

Loading a variation validates that the open model matches the variation’s source file name and
mesh paths. Re-save older variations after loading the correct model if mesh-path metadata is
missing.

## Preview vs apply

| Stage | What you see |
|-------|----------------|
| **Preview** | Live shader bump on the selected region (same material path as apply) |
| **Apply** | Committed shader regions on the viewport mesh |

Depth controls relief strength in both preview and apply. Higher depth produces stronger
shadows and highlights around pattern edges.

## Sidebar panels

| Panel | Purpose |
|-------|---------|
| Model Info | File name, stats, viewer toggles, camera reset/fit |
| Selection | Surface vs part mode, angle expansion, selection stats |
| Texture Library | Built-in patterns and custom uploads |
| Texture Placement | Emboss/engrave, scale, rotation, offset, depth |
| Apply Texture | Preview toggle, apply, reset |
| Variations | Save/load pattern setups |

## Viewer controls

| Input | Action |
|-------|--------|
| Left mouse drag | Orbit |
| Middle mouse drag | Pan |
| Scroll wheel | Zoom |
| Reset | Default camera angle |
| Fit | Frame model in view |

## Tech stack

- Vite, React, TypeScript
- Three.js, React Three Fiber, Drei
- Tailwind CSS, Zustand

## Project layout

```
src/
  components/     UI panels, viewer, layout
  lib/
    loaders/      Model import and normalization
    materials/    Pattern shader and apply logic
    geometry/     Relief displacement (export path)
    surface/      Selection, face mapping, mesh paths
    textures/     Height sampling, custom texture storage
    variants/     Variation save/load/remap
  store/          Zustand state (model, patterns, bake, selection)
  types/          Shared TypeScript types
```
