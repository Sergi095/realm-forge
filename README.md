# Realm Forge

A browser-only character and world-building workshop. Rust compiles to WebAssembly for the project model, save validation, terrain generation, terrain edits, and ability modifiers. A small JavaScript interface draws the 2D canvas and uses Three.js for the 3D view.

## Features

- Switch between a paintable 2D tile map and an orbitable 3D terrain view of the same world.
- Six terrain types, seeded island generation, location pins with notes, map undo/redo.
- Multiple character sheets: ancestry, class, level, HP, six ability scores, inventory, spells, and backstory.
- Realm name and campaign notebook.
- IndexedDB autosaves, JSON export/import, validated backups, and a single-editor browser lock.
- Responsive layout and self-hosted dependencies. No analytics, external fonts, backend, or accounts.

The character sheet is edition-neutral and calculates ability modifiers only. It does not implement a complete D&D ruleset or include proprietary rules content. The 3D editor is a terrain view, not a free-form model/building editor.

## Storage and privacy

Projects live in the browser profile and origin where you opened the app. GitHub hosts only the public application files. Campaign content is not uploaded. Clearing site data, using private browsing, or changing devices may remove or hide local saves; regularly use **Export backup**. Importing replaces the current workspace after confirmation. Keep a backup before importing.

No home machines, ports, tunnels, SSH access, or home-hosted services are used by the deployed app. There is no device sync or multiplayer. Share a backup file to share a campaign.

Only one tab edits a realm at once on browsers supporting the Web Locks API. A 5 MB import limit and field validation protect against accidentally loading invalid backups. Terrain maps are currently 40 × 28 cells, with up to 100 characters and 500 locations. Undo history is temporary and not included in backups.

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

- 2D: drag to paint. Choose **Place location** and click a tile to add a location. Click a location card to edit its notes.
- 3D: drag to orbit, scroll/pinch to zoom, right-drag to pan. Enable terrain painting, then click tiles. Finish painting to orbit again.
- Changes to either map view appear in the other. Location pins share the same tile coordinates.

Three.js is distributed under the MIT license; its license is copied to `web/vendor/THREE-LICENSE.txt` during the build.
