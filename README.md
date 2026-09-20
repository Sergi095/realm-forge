# DND Campaign Building

A desktop-first, browser-only character and world-building workshop with phone-friendly touch controls. Rust compiles to WebAssembly for the project model, save validation, terrain generation, terrain edits, and ability modifiers. A small JavaScript interface draws the 2D canvas and uses Three.js for the 3D view.

## Features

- Switch between a paintable 2D tile map and an orbitable 3D terrain view of the same world.
- Twelve terrain types, 1,312 material choices (1,288 Minecraft Java 26.3 block-state entries plus 24 original materials), stacked blocks, elevation brushes, and cottage/tower/wall presets.
- Touch-friendly material tray, full-screen editor, selection, drag-to-move, connected-structure selection, area selection in 2D, and collision-safe undoable moves.
- Seeded island generation, location pins with notes, map undo/redo, and configurable real-world distance per tile.
- Color 3MF and single-color STL print exports with dimensional preview, scale presets, and printable sections.
- Multiple character sheets: ancestry, class, level, HP, six ability scores, inventory, spells, and backstory.
- D&D Beyond character-data import with editable preview, duplicate handling, and original JSON retention.
- Realm name and campaign notebook.
- IndexedDB autosaves, JSON export/import, validated backups, and a single-editor browser lock.
- Responsive layout and self-hosted dependencies. No analytics, external fonts, backend, or accounts.

The character sheet is edition-neutral and calculates ability modifiers only. It does not implement a complete D&D ruleset or include proprietary rules content. The building editor uses a tile grid and stacked cubes; it is not a general-purpose CAD modeler.

## Storage and privacy

Projects live in the browser profile and origin where you opened the app. GitHub hosts only the public application files. Campaign content is not uploaded. Clearing site data, using private browsing, or changing devices may remove or hide local saves; regularly use **Export backup**. Importing a **realm backup** replaces the current workspace after confirmation. Importing a **D&D Beyond character** adds one character, unless you explicitly choose to replace an existing import. Keep a backup before importing.

No home machines, ports, tunnels, SSH access, or home-hosted services are used by the deployed app. There is no device sync or multiplayer. Share a backup file to share a campaign.

Only one tab edits a realm at once on browsers supporting the Web Locks API. A 5 MB import limit and field validation protect against accidentally loading invalid backups. Terrain maps are currently 40 × 28 cells, with up to 100 characters, 500 locations, and 12,000 building blocks. Undo history is temporary and not included in backups.

## Materials and touch building

On a computer, open **All materials** in the map tray or **All Minecraft materials** in the sidebar. Use the mouse to select, drag, paint, and build. On a phone, tap **Expand editor**, then **All materials** at the left of the bottom tray. Search by name (for example, diamond ore, cherry planks, or red wool), filter by category or collection, and tap a material. Tap the map to build with it. Swipe the tray horizontally for quick choices; vertical drags carry a material into the map. The full catalog is paginated so phones only render a small set of previews at once.

Use **Select & move** to tap and drag a block. **Select structure** expands the selection to all face-connected blocks; touching structures count as one connected structure. **Raise**, **Lower**, **Delete selected**, and **Deselect** are touch buttons. In 2D, drag an empty area to select all blocks in its rectangle. Moves snap to the tile grid, preserve block heights, and refuse overlaps or out-of-bounds placements. They do not simulate gravity. Use **Pan / orbit** to navigate, the 2D +/− buttons to zoom the map, or pinch in 3D. Selected blocks are outlined; invalid move previews turn red.

On a keyboard, V selects, B builds, P paints, Delete removes the selection, arrow keys move it, and Page Up/Down changes its height. Shift-click adds/removes blocks from a selection; Alt-drag copies it. Ctrl/Cmd+Z undoes, and Ctrl/Cmd+Shift+Z redoes. Escape clears a selection or exits the expanded editor. Shortcuts do not intercept text fields or dialogs.

The Minecraft catalog is extracted from the `assets/minecraft/blockstates/` identifiers and English names in the official [Java 26.3 release metadata](https://piston-meta.mojang.com/v1/packages/96c00d95a31328714d3811cfade2804bb050e455/26.3.json). It includes color variants, wood families, ores, decorative and technical entries. Entries are represented by cubes with original procedural textures: Minecraft-specific shapes (such as stairs, fences, doors and plants), animations, redstone behavior, and other gameplay mechanics are not reproduced. Print exports assign solid colors to those materials.

`web/minecraft-catalog.json` records the source version, client SHA-1, and every imported identifier. `python3 scripts/update-material-catalog.py 26.3` reproduces/updates it, verifies the download hash, and generates the Rust material bounds. IDs are append-only, and the original 24 IDs are retained to preserve earlier saves. The updater reads ZIP metadata only; no Minecraft executable or texture asset is redistributed. Runtime rendering creates textures only for materials used in the current world.

## Importing from D&D Beyond

1. Open **Characters → Import D&D Beyond**.
2. Paste a character link or numeric ID. **Load character** attempts a direct request to D&D Beyond with no credentials or proxy. D&D Beyond's browser-access restrictions can block this.
3. The reliable fallback is **Open character data**: if you can access that JSON page, save it as a `.json` file (Ctrl/Cmd+S), then select it under **Choose D&D Beyond JSON**. A PDF sheet or saved HTML webpage is not supported. Private/inaccessible characters cannot be fetched by this app; it never asks for a D&D Beyond login, cookie, or token.
4. Review and correct the suggested scores and maximum HP, then choose **Add character to realm**. Existing maps and notes are preserved. Re-importing the same ID offers either a new copy or replacement of the existing character.

The Rust importer accepts a single v5 character object, a `{data: ...}` response, or a `{character: ...}` wrapper. It maps identity, class levels, species, ability scores, estimated HP, equipment, currency, spell names, background, notes, and feature names. It uses base/bonus/override stats and common unconditional modifiers, including equipped and attuned item modifiers. It is not a complete rules engine: conditional effects, class choices, custom overrides, complex item effects, skills, AC, and combat automation are not fully mapped. Check the editable preview against the original sheet.

The original character object is retained locally and included in realm backups. **Download original JSON** lets you recover fields not shown in DND Campaign Building. These are one-time snapshots; later D&D Beyond changes do not sync automatically. Maximum input size is 2 MB per character; the whole realm still needs to fit the 5 MB backup limit.

D&D Beyond's character-data endpoint is not a guaranteed public integration API. Network imports depend on its availability and CORS policy. The automated network tests use a mocked response; file imports are tested with a synthetic v5-shaped fixture. No user's account or character data is bundled with the app.

## 3D printing and world scale

Set **Distance per tile** to establish the world scale (default: 5 feet). Open **3D print & scale** and choose an overall width in millimetres or a scale ratio. For example, a 5-foot tile at 1:60 becomes 25.4 mm wide. The dialog shows exact exported dimensions, tile size, and a fit check against your square printer-bed size. Large worlds can be exported as 8 × 8 or 5 × 5 tile sections, individually or together in a ZIP. Sections retain the same scale and matching terrain edges.

**Color 3MF** stores a color palette and surface colors. Customize colors independently of the world material textures: wood, stone, glass, and other world materials are visual choices, not printer filament types. Your slicer/printer must support 3MF surface colors; you may need to assign colors to extruders. **STL** exports geometry only and has no color information. No printer is controlled by the app.

The printable model is a closed, solid relief with a flat base. It follows terrain elevation and the highest building block in each column, with optional raised trees and location markers. Roof cavities, bridge openings, and other spaces underneath are filled. This produces a printable map rather than an exact hollow copy of the building scene. Fine surface textures are represented by colors, not engraved detail. Adjust base thickness and height exaggeration in the preview; inspect the result in your slicer before printing.

Automated checks validate mesh closure, winding, dimensions, matching section edges, STL structure, and 3MF colors/ZIP integrity. Physical print quality and compatibility with every slicer have not been tested. Print settings currently last only for the open app session; world scale, materials, and buildings are saved with the campaign.

## Development

Requires Rust, Node.js, Python 3 (local test server), and wasm-pack:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
npm ci
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory web
```

Open `http://127.0.0.1:4173`. The server listens on loopback only.

```sh
cargo test --locked
npx playwright install chromium
npm test
```

## Deployment

GitHub Pages uses `.github/workflows/pages.yml`: compile WASM, copy the locally installed Three.js modules, run Rust and browser tests, then publish `web/`. Set the repository Pages source to GitHub Actions. Relative asset paths support a project URL such as `https://Sergi095.github.io/realm-forge/`.

## Controls

- Choose a tool to paint, raise/lower/level ground, place/remove blocks, or stamp a structure. Brushes cover 1, 3, 5, or 9 tiles across. Search the material palette for stone, timber, brick, glass, metals, and more.
- 2D: drag for terrain brushes; click to stack a block or stamp a structure. Choose **Place location** and click a tile to add a location. Click a location card to edit its notes.
- 3D: drag to orbit, scroll/pinch to zoom, right-drag to pan. Enable editing to place blocks against clicked faces or paint terrain. Right-click a block in build mode to remove it. Return to navigation to orbit again.
- Changes to either map view appear in the other. Location pins share the same tile coordinates.

Three.js is distributed under the MIT license; its license is copied to `web/vendor/THREE-LICENSE.txt` during the build.
