# Spoolara Texture Studio

Add real, printable surface textures to 3D models. Load a model, select a surface or
part, pick a texture, dial in the look, and apply it as actual displaced mesh geometry —
then save the result as a variation.

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

## Build

```bash
npm run build
npm run preview
```

## Supported formats

| Format | Extension |
|--------|-----------|
| STL    | `.stl`    |
| OBJ    | `.obj`    |
| GLB    | `.glb`    |
| GLTF   | `.gltf`   |
| 3MF    | `.3mf`    |

Models are centered and scaled to fit the workspace on load. A sample model is included at
`public/samples/Mini Toolbox.3mf`.

## Workflow

1. **Load a model** from the sidebar or by dragging a file into the workspace.
2. **Select** a surface or a whole part:
   - *Surface* mode click-selects a face; **Angle threshold** expands the selection to
     similar-facing faces (use **Connected only** to stay within one connected panel).
   - *Part* mode selects an entire mesh.
3. **Choose a texture** from the library (Hex, Grid, Diamond, Honeycomb, Scales, Ribbed,
   Dots, Waves, Zigzag, Brick, Crosshatch, Cracks).
4. **Adjust** scale, depth, rotation, and offset. Switch between **Emboss** (raised) and
   **Engrave** (recessed).
5. **Preview** shows the effect as real displaced geometry on the selected area.
6. **Apply texture** commits the pattern as actual mesh geometry — emboss raises the
   surface outward, engrave recesses it inward. Normals are recomputed.
7. **Save** the result as a variation. Variations are stored locally in the browser and
   can be loaded, renamed, duplicated, or deleted. **Reset to original** clears applied
   geometry and textures.

Applied geometry can also be exported (GLB / STL / OBJ). GLB includes geometry and
material/texture; STL and OBJ export geometry only.

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
