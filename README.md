# Spoolara Texture Studio — Milestone 1

Browser-based 3D texture/theme tool demo foundation. Load printable 3D models, preview them in an interactive viewer, and explore a polished dark/purple UI shell ready for future milestones.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open the URL shown in the terminal (typically `http://localhost:5173`).

Use `http://localhost:5173` or the network URL Vite prints — do **not** open `index.html` directly from the file system (`file://`), as modules and WebGL will not work.

### Chrome troubleshooting

If the 3D viewer is blank in external Chrome:

1. Ensure you are using the dev server URL (`http://localhost:5173`), not a local file path.
2. Enable **Settings → System → Use hardware acceleration when available**, then restart Chrome.
3. Hard-refresh the page (Ctrl+Shift+R).
4. Disable extensions that block WebGL or canvas (some privacy/ad blockers do).

## Build

```bash
npm run build
npm run preview
```

## Supported Formats

| Format | Extension | Loader |
|--------|-----------|--------|
| STL    | `.stl`    | STLLoader |
| OBJ    | `.obj`    | OBJLoader |
| GLB    | `.glb`    | GLTFLoader |
| GLTF   | `.gltf`   | GLTFLoader |
| 3MF    | `.3mf`    | ThreeMFLoader |

Models are automatically centered at the origin and scaled to a consistent viewer size. Bounding box dimensions, mesh count, vertex count, and triangle count are computed on load.

### Testing with 3MF

A client sample is bundled at `public/samples/Mini Toolbox.3mf`. With the dev server running, drag it into the viewer or use **Open Model**.

You can also place other 3MF files anywhere on your machine and load them the same way. Part colors and materials are preserved when the loader provides them.

> **Note:** `npm run test:load` uses Node.js and cannot parse 3MF (ThreeMFLoader requires `DOMParser`). Use the browser app for 3MF verification.

## Features (Milestone 1)

- Full-screen layout: sidebar, 3D workspace, info panel, status bar
- Drag-and-drop and file picker model loading
- Orbit / pan / zoom camera controls
- Reset camera and fit-to-model
- Toggle wireframe, axes, grid/floor, bounding box
- Green cutting-mat-style floor grid
- Loading overlay and empty-state placeholder
- Dark navy / purple Spoolara-style UI
- Responsive layout for laptop and desktop screens

## Viewer Controls

| Input | Action |
|-------|--------|
| Left mouse drag | Orbit |
| Middle mouse drag | Pan |
| Scroll wheel | Zoom |
| Reset button | Return to default camera angle |
| Fit button | Frame model in view |

## Milestone Limitations

The following are **not** implemented in Milestone 1:

- Surface selection
- Texture application (raised/engraved geometry)
- Pattern library
- Mesh modification or export
- Project saving
- Backend, auth, or payment integration

Sidebar sections beyond **Load Model** are visible but disabled and marked "Coming next."

## Tech Stack

- Vite + React + TypeScript (strict)
- Three.js + @react-three/fiber + @react-three/drei
- Tailwind CSS v4
- Zustand
- lucide-react

## Project Structure

```
src/
  components/
    layout/     App shell, sidebar, panels
    viewer/     3D canvas, model renderer, camera, floor
    upload/     File dropzone
    ui/         Reusable buttons, panels, toggles
  lib/
    loaders/    Model loading, normalization, stats
    three/      Dispose helpers, camera fitting
  store/        Zustand app state
  types/        Shared TypeScript types
```

## License

Private demo project.
