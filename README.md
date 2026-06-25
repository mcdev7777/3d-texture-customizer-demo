# Spoolara Texture Studio

3D model viewer for preparing textured prints. Load a model, inspect it in the workspace, and adjust the view.

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

## Tech stack

- Vite, React, TypeScript
- Three.js, React Three Fiber, Drei
- Tailwind CSS, Zustand
