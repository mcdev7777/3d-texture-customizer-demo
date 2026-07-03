# Texture Studio

Apply seamless texture patterns to 3D models. Load a model, select a surface or part,
pick a built-in or custom pattern, preview the look, apply it to the mesh material, and
export the result.

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
   Dots, Waves, Zigzag, Brick, Crosshatch, Cracks), or **Load Texture** to upload your own
   PNG/JPG/WebP height mask (white = raised, black = groove — both render as the surface color).
4. **Adjust** scale, depth, rotation, and offset. Switch between **Emboss** and **Engrave**.
5. **Preview** shows the pattern on the selected area using the same material mapping as
   Apply. Part mode maps all faces; surface mode maps the selected face only.
6. **Apply texture** commits the pattern material to the mesh. Depth controls bump shadows
   and highlights around pattern edges (bumpmesh-style — no albedo change). **Reset surface pattern** clears one applied area;
   **Reset to original** clears everything.
7. **Export Model** downloads the textured model as STL, OBJ, GLB, or 3MF. GLB includes
   materials; STL, OBJ, and 3MF export base geometry only.

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
