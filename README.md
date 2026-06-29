# Spoolara Texture Studio

3D model viewer for preparing textured prints. Load a model, inspect it in the workspace, select surfaces, and adjust the view.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open `http://localhost:5173` in your browser. The app must be served over HTTP — opening `index.html` directly will not work.

If the 3D view is blank, enable hardware acceleration in your browser settings and reload.

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

Models are centered and scaled to fit the workspace on load. File info includes dimensions, mesh count, vertex count, and triangle count.

A sample 3MF model is included at `public/samples/Mini Toolbox.3mf`.

## Viewer controls

| Input | Action |
|-------|--------|
| Left mouse drag | Orbit |
| Middle mouse drag | Pan |
| Scroll wheel | Zoom |
| Reset | Default camera angle |
| Fit | Frame model in view |

## Surface selection

1. Load a model
2. Enable **Selection mode** in the right panel or sidebar
3. Click a flat face on the model (use a short click — don't drag)
4. Adjust **Angle tolerance** to expand or shrink the selected region
5. Use **Clear selection** to reset

Selected regions highlight in purple. Other parts of the model dim while a surface is selected.

### Manual test checklist

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | `npm run dev` → open `http://localhost:5173` | App loads, grid visible |
| 2 | Load `public/samples/Mini Toolbox.3mf` | Model centered on grid |
| 3 | Orbit, pan, zoom | Camera moves smoothly |
| 4 | Enable selection mode | Toggle active in sidebar/panel |
| 5 | Click a flat panel (no drag) | Purple highlight on that panel |
| 6 | Check right panel stats | Mesh name, face index, triangle count, normal, area |
| 7 | Drag to orbit, release, click again | Orbit does not trigger selection; click does |
| 8 | Increase angle tolerance | Highlight grows to adjacent coplanar faces |
| 9 | Decrease angle tolerance | Highlight shrinks |
| 10 | Clear selection | Highlight and dim removed |
| 11 | Click a different panel | Previous selection replaced |
| 12 | Toggle wireframe / fit / reset | Viewer controls still work |
| 13 | Load a different model | Selection clears, new model selectable |

## Tech stack

- Vite, React, TypeScript
- Three.js, React Three Fiber, Drei
- Tailwind CSS, Zustand
