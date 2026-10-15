# 3D Studio

An open source desktop app for creating and editing 3D-printable models, by hand or by chatting with an AI, with a live 3D preview. It is built for people who do not know 3D design: describe what you want, point at the part, and the AI does the technical work.

## Simple mode (default)

- **Start by describing it**: "What do you want to make?" plus an optional photo or sketch. The project is created for you in `Documents/3D Studio`.
- **Click the part to change it**: a click drops a numbered pin and opens quick actions (Thicker, Thinner, Longer, Shorter, Wider, Add hole, Round edges, Remove this, Make stronger) with an amount in mm. The AI gets the exact spot and an annotated picture.
- **Draw on the view** with a pen, attach **photos** (paste, drop or pick), and add notes to pins to explain anything more complex.
- **The AI answers in plain language** and offers clickable next steps.
- **Adjust sizes** with sliders for every named size in the design.
- **Undo** any change with one click, and **Save for printing** straight to a slicer project.

Switch to **Expert** for the code editor, the operations stack with 3D handles, history and render logs.

- **Code-based modelling** with [OpenSCAD](https://openscad.org): parametric, precise, and easy for AI to edit.
- **Live preview** in a 3D viewer with print-bed grid, standard views, measuring tool, size/volume/watertight stats.
- **Manual editing**: code editor with syntax highlighting and inline errors, plus a non-destructive operations stack (move, rotate, scale, mirror, cut with a plane, add or remove boxes, place or center on the bed) that you can bake into the code.
- **AI chat** with two providers:
  - **OpenRouter**: any model with tool support. The assistant reads the model, edits it, renders it, and looks at screenshots of the preview (vision models).
  - **Claude Code CLI**: runs `claude` in the project folder, streams its steps into the chat, and resumes the same session for follow-ups.
  - If an AI change leaves the model broken, the errors are sent back automatically for a fix.
- **Import** STL and 3MF (PrusaSlicer, Bambu Studio, Orca multi-object files) and existing `.scad` files.
- **Export** STL, 3MF, or a ready-to-slice **Snapmaker Orca / OrcaSlicer project** that uses the presets installed on your computer (printer, process, filaments with colours, objects per part, copies).
- **History**: every save and every AI change is kept as a version you can restore.

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- [OpenSCAD](https://openscad.org/downloads.html) (2021.01 or newer)
- Optional: an [OpenRouter API key](https://openrouter.ai/keys)
- Optional: [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in
- Optional: Snapmaker Orca or OrcaSlicer, for slicer project export

## Getting started

```bash
npm install
npm run dev
```

If Electron fails to start after install because its binary was not downloaded (npm may block install scripts), run:

```bash
node node_modules/electron/install.js
```

Build a Windows installer:

```bash
npm run dist
```

After `npm run build` you can open a project directly with `npx electron . "path/to/project"`.

## How projects work

A project is a folder:

```
my-part/
  model.scad          the model (edit by hand or with AI)
  assets/             imported meshes (STL), used with import("assets/name.stl")
  .studio/
    project.json      operations stack and selected part
    history/          saved versions
    chat.json         chat history and Claude Code session
```

If `model.scad` defines `part = "...";` and checks it with `part == "lid"` style conditions, the app shows a **Part** picker and renders one part at a time. Imported multi-object 3MF files get this automatically.

Operations from the **Operations** tab are applied on top of the code when rendering and exporting. **Bake** writes them into `model.scad`.

## Settings

- **OpenSCAD program**: detected automatically on common install paths.
- **OpenRouter API key**: stored encrypted with the operating system's key store.
- **Claude Code program**: detected automatically (`~/.local/bin/claude`). Use the native executable rather than an npm `.cmd` shim on Windows.
- **Let Claude Code run commands**: allows its `Bash` tool so it can render and check its own work. Off by default; file edits are always allowed in the project folder.
- **Extra instructions**: added to every AI request (for example "Never write comments in code").

## Keyboard

- `Ctrl+S` save
- `F5` or `Ctrl+Enter` render
- `F12` developer tools

## Project layout

```
src/main        Electron main process: projects, OpenSCAD runner, mesh I/O, slicer export, AI providers
src/preload     safe bridge between the window and the main process
src/renderer    React UI: code editor, three.js viewer, chat, operations, dialogs
src/shared      types and the OpenSCAD source tools shared by both sides
```

## License

MIT
