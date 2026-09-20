import { shapeTool, insideTerritory, territoryPreset } from "./territory.js";
import {
  renderCharacterSheet,
  renderSheetEditor,
  readSheetForm,
} from "./character-sheet.js";
import { openMaterialPicker } from "./material-picker.js";
import {
  blockKey,
  connectedBlocks,
  planMove,
  bindMaterialDrags,
  installTouchButtons,
} from "./interaction.js";
import {
  terrains,
  materials,
  groundHeight,
  stampStructure,
} from "./materials.js";
import { openDdbImport } from "./ddb-import.js";
import init, { Realm, ability_modifier } from "./pkg/realm_forge.js";
installTouchButtons();
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const touchUI = matchMedia("(pointer: coarse)").matches;
const colors = terrains.map((t) => t.color);
const terrainNames = terrains.map((t) => t.name);
let realm,
  db,
  tab = "world",
  terrain = 2,
  selected = 0,
  mode = "2d",
  pinMode = false,
  buildTool = "paint",
  brushSize = 1,
  blockMaterial = 0,
  materialFilter = "",
  preset = "cottage",
  cleanup = () => {},
  undo = [],
  redo = [],
  saving = Promise.resolve(),
  dirty = false,
  invalidDraft = false,
  pending = 0,
  blocked = false,
  pinEdit = -1;
let selectionKeys = new Set(),
  redrawWorld = () => {},
  cleanupMaterialDrag = () => {},
  expandedEditor = false,
  mapZoom = 1;
const state = () => JSON.parse(realm.snapshot());
function selectionChanged() {
  const count = selectionKeys.size;
  const bar = $("#selection-actions");
  if (bar) {
    bar.hidden = !count;
    $("#selection-label").textContent =
      `${count} block${count === 1 ? "" : "s"} selected`;
  }
  redrawWorld();
}
function selectBlocks(keys) {
  selectionKeys = new Set(keys);
  selectionChanged();
}
function moveSelection(dx, dy, dz = 0, copy = false) {
  if (!dx && !dy && !dz && !copy) return false;
  const result = planMove(state(), selectionKeys, dx, dy, dz, copy);
  if (result.error) {
    notice(result.error);
    return false;
  }
  if (!commit(result.world, true)) return false;
  selectionKeys = result.keys;
  notice();
  selectionChanged();
  syncHistory();
  return true;
}
function syncHistory() {
  if ($("#undo")) $("#undo").disabled = !undo.length;
  if ($("#redo")) $("#redo").disabled = !redo.length;
}
function deleteSelection() {
  if (!selectionKeys.size) return;
  const next = state();
  next.blocks = next.blocks.filter((b) => !selectionKeys.has(blockKey(b)));
  if (commit(next, true)) {
    selectBlocks([]);
    syncHistory();
  }
}
function dropMaterial(id, x, y, z) {
  if (!Number.isInteger(id) || id < 0 || id >= materials.length) return state();
  checkpoint();
  if (realm.place_block(x, y, z, id)) {
    blockMaterial = id;
    save();
    selectBlocks([`${x},${y},${z}`]);
    syncHistory();
  }
  return state();
}
function interactionBar() {
  return `<div class="editor-controls" role="toolbar" aria-label="World interaction tools"><button data-quick-tool="select" class="${buildTool === "select" ? "primary" : ""}">↖ Select & move</button><button data-quick-tool="block" class="${buildTool === "block" ? "primary" : ""}">＋ Build</button><button data-quick-tool="navigate" class="${buildTool === "navigate" ? "primary" : ""}">✥ Pan / orbit</button>${mode === "2d" ? `<button id="zoom-out" aria-label="Zoom map out">−</button><button id="zoom-in" aria-label="Zoom map in">＋</button>` : ""}<button data-quick-tool="paint" class="${buildTool === "paint" ? "primary" : ""}">▧ Paint</button><button data-quick-tool="territory-add" class="${buildTool === "territory-add" ? "primary" : ""}">Draw territory</button><button data-quick-tool="territory-erase" class="${buildTool === "territory-erase" ? "primary" : ""}">Erase territory</button><button id="expand-editor">${expandedEditor ? "Close expanded view" : "Expand editor"}</button></div>`;
}
function materialDock() {
  return `<div id="selection-actions" class="selection-actions" hidden><strong id="selection-label" role="status"></strong><button id="select-connected">Select structure</button><button id="selection-up" aria-label="Raise selected blocks">↑ Raise</button><button id="selection-down" aria-label="Lower selected blocks">↓ Lower</button><button id="selection-delete" class="danger">Delete selected</button><button id="selection-clear">Deselect</button></div><div class="material-dock" aria-label="Quick material tray"><button id="all-materials" class="all-materials" aria-label="All materials">▦<span>All materials</span></button>${[
    ...new Set([blockMaterial, ...Array.from({ length: 24 }, (_, i) => i)]),
  ]
    .map((id) => materials[id])
    .map(
      (m) =>
        `<button data-hot-material="${m.id}" class="${m.id === blockMaterial ? "selected" : ""}" title="${m.name}" aria-label="Build with ${m.name}"><span class="swatch texture-${m.texture}" style="background-color:${m.color}"></span><span>${m.name}</span></button>`,
    )
    .join(
      "",
    )}</div><div class="dock-hint">${touchUI ? "Tap a material, then tap the world · Select & move to drag blocks" : "Click a material · V select · B build · Alt-drag to copy"}</div>`;
}
function notice(message = "") {
  $("#notice").hidden = !message;
  $("#notice").textContent = message;
}
function status(message) {
  $("#save-status").textContent = message;
}
async function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("realm-forge-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(
        new Error("Close other DND Campaign Building tabs to open storage."),
      );
  });
}
function read() {
  return new Promise((resolve, reject) => {
    const r = db.transaction("projects").objectStore("projects").get("current");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function write(json) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(json, "current");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Save aborted"));
  });
}
function save() {
  dirty = true;
  if (blocked || !db) {
    status("Not saved · export a backup");
    return;
  }
  const snapshot = realm.snapshot();
  pending++;
  status("Saving…");
  saving = saving
    .catch(() => {})
    .then(() => write(snapshot))
    .then(() => {
      pending--;
      if (!pending) {
        dirty = false;
        status(
          invalidDraft ? "Invalid edit · not saved" : "✓ Saved in this browser",
        );
      }
    })
    .catch((e) => {
      pending--;
      status("Save failed · export a backup");
      notice(
        `Your changes are still open, but could not be saved: ${e.message}. Download a backup now.`,
      );
    });
}
function checkpoint() {
  undo.push(realm.snapshot());
  if (undo.length > 40) undo.shift();
  redo = [];
}
function commit(next, history = false) {
  try {
    const previous = realm.snapshot();
    realm.restore(JSON.stringify(next));
    if (invalidDraft) notice();
    invalidDraft = false;
    if (history) {
      undo.push(previous);
      if (undo.length > 40) undo.shift();
      redo = [];
    } else {
      undo = [];
      redo = [];
    }
    save();
    return true;
  } catch (e) {
    invalidDraft = true;
    status("Invalid edit · not saved");
    notice(String(e));
    return false;
  }
}
function confirmAction(title, text) {
  return new Promise((resolve) => {
    const d = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    d.showModal();
    $("#confirm-yes").onclick = () => {
      d.close();
      resolve(true);
    };
    $("#confirm-no").onclick = () => {
      d.close();
      resolve(false);
    };
    d.oncancel = () => resolve(false);
  });
}
function heading(kicker, title, subtitle, action = "") {
  return `<div class="page-heading"><div><div class="kicker">${kicker}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}
function render() {
  cleanupMaterialDrag();
  cleanup();
  redrawWorld = () => {};
  document.body.classList.toggle(
    "editor-open",
    expandedEditor && tab === "world",
  );
  const existing = new Set(state().blocks.map(blockKey));
  selectionKeys = new Set([...selectionKeys].filter((k) => existing.has(k)));
  cleanup = () => {};
  $("#app").setAttribute("aria-busy", "false");
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#character-count").textContent = state().characters.length;
  if (tab === "world") renderWorld();
  else if (tab === "characters") renderCharacters();
  else renderLore();
}
function worldPanels(s) {
  return `<section class="panel"><div class="eyebrow">TERRITORY OUTLINE</div><label>Starting shape<select id="territory-preset"><option value="">Choose a shape…</option><option value="island">Island</option><option value="archipelago">Island chain</option><option value="blank">Blank · draw your own</option><option value="coastline">Follow existing coastline</option><option value="rectangle">Full rectangle</option></select></label><p class="hint">Draw or erase territory in 2D to shape islands, borders and openings. Erased areas disappear from 3D and print exports. Their contents return if you redraw them. Undo restores the previous shape.</p></section><section class="panel"><div class="eyebrow">WORLD SCALE</div><label>Distance per tile<select id="world-scale"><option value="1.524">5 feet · battle map</option><option value="3.048">10 feet · large battle map</option><option value="10">10 metres · settlement</option><option value="100">100 metres · district</option><option value="1000">1 kilometre · region</option><option value="custom">Custom metres per tile</option></select></label><label id="custom-scale-label" hidden>Metres per tile<input id="custom-scale" type="number" min="0.1" max="100000" step="any" value="${s.meters_per_tile}"></label><p id="world-size" class="hint"></p></section><section class="panel"><div class="eyebrow">MATERIAL LIBRARY · ${materials.length.toLocaleString()} BLOCKS</div><label>Find a material<input id="material-search" placeholder="Stone, wood, glass…" value="${esc(materialFilter)}"></label><button id="browse-materials" class="primary">Browse material library</button><p id="material-results-count" class="hint"></p><div id="material-palette" class="material-palette"></div><p class="hint">Choose a material, then place blocks or stamp a structure. Right-click a block to remove it in build mode.</p></section>`;
}
function renderWorld() {
  const s = state();
  $("#app").innerHTML =
    heading(
      "MAKE YOUR MARK",
      "World atlas",
      "Every great adventure begins with a place.",
      `<div class="view-switch"><button id="view-2d" class="${mode === "2d" ? "primary" : ""}">2D map</button><button id="view-3d" class="${mode === "3d" ? "primary" : ""}">3D world</button></div>`,
    ) +
    `<div class="world-toolbar"><label>Tool<select id="build-tool"><option value="navigate">Pan / orbit</option><option value="select">Select & move</option><option value="paint">Paint terrain</option><option value="territory-add">Draw territory</option><option value="territory-erase">Erase territory</option><option value="raise">Raise ground</option><option value="lower">Lower ground</option><option value="flatten">Level ground</option><option value="block">Place material block</option><option value="erase">Remove block</option><option value="stamp">Place structure</option></select></label><label>Brush<select id="brush-size"><option value="1">1 tile</option><option value="3">3 × 3</option><option value="5">5 × 5</option><option value="9">9 × 9</option></select></label><label>Structure<select id="structure-preset"><option value="cottage">Cottage · 5 × 5</option><option value="tower">Tower · 4 × 4</option><option value="wall">Wall · 7 tiles</option></select></label><button id="print-world" class="primary">3D print & scale</button></div><div class="atlas-layout"><section><div class="map-card ${expandedEditor ? "editor-expanded" : ""}">${interactionBar()}<div class="map-bar"><strong>${esc(s.title)}</strong><span>40 × 28 · ${mode === "2d" ? "TOP DOWN" : "PERSPECTIVE"}</span></div><div class="canvas-wrap" id="viewport">${mode === "2d" ? '<canvas id="map" width="1000" height="700" aria-label="World map: paint terrain or place locations with a pointer"></canvas>' : '<div id="scene" aria-label="Interactive 3D world"></div>'}</div>${materialDock()}<div class="map-foot"><span id="map-help">${mode === "2d" ? "Drag to paint · choose Place location to add a pin" : "Drag to orbit · scroll to zoom · enable paint to edit"}</span><span>5 tiles = ${(s.meters_per_tile * 5).toLocaleString()} m · <span id="block-count">${s.blocks.length} blocks</span></span></div></div><div class="locations"><div class="section-heading"><h2>Places & stories</h2><span>${s.pins.length} LOCATIONS</span></div><div class="pin-list">${s.pins.map((p, i) => `<button class="pin-item" data-pin="${i}"><strong>⌖ ${esc(p.name)}</strong><small>Tile ${p.x + 1}, ${p.y + 1} · ${p.notes ? "Has a story" : "An unwritten story"}</small></button>`).join("") || '<div class="empty" style="width:100%">Place a location on your map and give it a story.</div>'}</div><div id="pin-editor"></div></div></section><div class="atlas-tools">${worldPanels(s)}<section class="panel"><div class="eyebrow">SHAPE YOUR WORLD</div><h2>Terrain palette</h2><div class="terrain-list">${terrainNames.map((n, i) => `<button class="terrain ${i === terrain ? "selected" : ""}" data-terrain="${i}" aria-pressed="${i === terrain}"><span class="swatch" style="background:${colors[i]}"></span>${n}</button>`).join("")}</div><p class="hint">One world, two views. Your changes appear in both.</p></section><section class="panel"><div class="eyebrow">MAP TOOLS</div><div class="tool-stack"><button id="place-pin" class="${pinMode ? "primary" : ""}">⌖ ${pinMode ? "Click map to place" : "Place location"}</button>${mode === "3d" ? '<button id="paint-3d">Enable terrain painting</button><button id="reset-camera">Reset camera</button>' : ""}<button id="undo" ${undo.length ? "" : "disabled"}>↶ Undo</button><button id="redo" ${redo.length ? "" : "disabled"}>↷ Redo</button><button id="generate">✧ Generate island</button></div><p class="hint">Generate a starting landscape, then make it your own.</p></section></div></div>`;
  document.querySelectorAll("[data-quick-tool]").forEach(
    (b) =>
      (b.onclick = () => {
        buildTool = b.dataset.quickTool;
        if (shapeTool(buildTool)) {
          mode = "2d";
          selectionKeys.clear();
        }
        pinMode = false;
        render();
      }),
  );
  if ($("#zoom-in"))
    $("#zoom-in").onclick = () => {
      mapZoom = Math.min(4, mapZoom + 0.5);
      render();
    };
  if ($("#zoom-out"))
    $("#zoom-out").onclick = () => {
      mapZoom = Math.max(1, mapZoom - 0.5);
      render();
    };
  $("#expand-editor").onclick = () => {
    expandedEditor = !expandedEditor;
    render();
  };
  $("#selection-delete").onclick = deleteSelection;
  $("#selection-clear").onclick = () => selectBlocks([]);
  $("#selection-up").onclick = () => moveSelection(0, 0, 1);
  $("#selection-down").onclick = () => moveSelection(0, 0, -1);
  $("#select-connected").onclick = () =>
    selectBlocks(
      new Set([
        ...selectionKeys,
        ...connectedBlocks(state().blocks, [...selectionKeys][0]),
      ]),
    );
  document.querySelectorAll("[data-hot-material]").forEach(
    (b) =>
      (b.onclick = () => {
        blockMaterial = +b.dataset.hotMaterial;
        buildTool = "block";
        pinMode = false;
        render();
      }),
  );
  const chooseMaterial = (id) => {
    blockMaterial = id;
    buildTool = "block";
    pinMode = false;
    render();
  };
  $("#all-materials").onclick = () => openMaterialPicker(chooseMaterial);
  $("#browse-materials").onclick = () =>
    openMaterialPicker(chooseMaterial, materialFilter);
  $("#build-tool").value = buildTool;
  $("#brush-size").value = String(brushSize);
  $("#structure-preset").value = preset;
  $("#build-tool").onchange = (e) => {
    buildTool = e.target.value;
    if (shapeTool(buildTool)) {
      mode = "2d";
      selectionKeys.clear();
    }
    pinMode = false;
    render();
  };
  $("#territory-preset").onchange = (e) => {
    if (!e.target.value) return;
    const s = state();
    s.territory = territoryPreset(s, e.target.value);
    selectionKeys.clear();
    if (commit(s, true)) {
      mode = "2d";
      buildTool = "territory-add";
      pinMode = false;
      render();
    }
  };
  $("#brush-size").onchange = (e) => {
    brushSize = Number(e.target.value);
  };
  $("#structure-preset").onchange = (e) => {
    preset = e.target.value;
    buildTool = "stamp";
    render();
  };
  $("#print-world").onclick = async () => {
    try {
      const { openPrintWorld } = await import("./print-world.js");
      await openPrintWorld(realm);
    } catch (e) {
      notice(String(e));
    }
  };
  const scalePresets = [1.524, 3.048, 10, 100, 1000];
  $("#world-scale").value = scalePresets.includes(s.meters_per_tile)
    ? String(s.meters_per_tile)
    : "custom";
  $("#custom-scale-label").hidden = $("#world-scale").value !== "custom";
  $("#world-size").textContent =
    `World: ${(40 * s.meters_per_tile).toLocaleString()} × ${(28 * s.meters_per_tile).toLocaleString()} metres. Blocks share the tile scale.`;
  $("#world-scale").onchange = (e) => {
    if (e.target.value === "custom") {
      $("#custom-scale-label").hidden = false;
      return;
    }
    const next = state();
    next.meters_per_tile = Number(e.target.value);
    commit(next);
    render();
  };
  $("#custom-scale").onchange = (e) => {
    if (!e.target.reportValidity()) return;
    const next = state();
    next.meters_per_tile = Number(e.target.value);
    if (commit(next)) render();
  };
  function renderMaterials() {
    const available = materials.filter((m) =>
      (m.name + " " + m.category + " " + (m.key || "").replaceAll("_", " "))
        .toLowerCase()
        .includes(materialFilter.toLowerCase()),
    );
    $("#material-results-count").textContent =
      `${available.length.toLocaleString()} materials · showing ${Math.min(60, available.length)}`;
    $("#material-palette").innerHTML =
      available
        .slice(0, 60)
        .map(
          (m) =>
            `<button class="material-choice ${m.id === blockMaterial ? "selected" : ""}" data-material="${m.id}" title="${m.name}" aria-pressed="${m.id === blockMaterial}"><span class="swatch texture-${m.texture}" style="background-color:${m.color}"></span><span>${m.name}</span></button>`,
        )
        .join("") || '<p class="hint">No matching materials.</p>';
    cleanupMaterialDrag();
    cleanupMaterialDrag = bindMaterialDrags(
      document.querySelectorAll("[data-material], [data-hot-material]"),
    );
    document.querySelectorAll("[data-material]").forEach(
      (b) =>
        (b.onclick = () => {
          blockMaterial = +b.dataset.material;
          if (!["stamp", "block"].includes(buildTool)) buildTool = "block";
          pinMode = false;
          render();
        }),
    );
  }
  renderMaterials();
  const building = ["block", "erase", "stamp"].includes(buildTool);
  $("#material-palette").closest("section").hidden = false;
  $(".terrain-list").closest("section").hidden = building;
  $("#material-search").oninput = (e) => {
    materialFilter = e.target.value;
    renderMaterials();
  };
  $("#view-2d").onclick = () => {
    mode = "2d";
    render();
  };
  $("#view-3d").onclick = () => {
    if (shapeTool(buildTool)) buildTool = "navigate";
    mode = "3d";
    render();
  };
  document.querySelectorAll("[data-terrain]").forEach(
    (b) =>
      (b.onclick = () => {
        terrain = +b.dataset.terrain;
        if (!shapeTool(buildTool)) buildTool = "paint";
        pinMode = false;
        render();
      }),
  );
  $("#place-pin").onclick = () => {
    pinMode = !pinMode;
    render();
  };
  $("#undo").onclick = () => {
    if (undo.length) {
      redo.push(realm.snapshot());
      realm.restore(undo.pop());
      save();
      render();
    }
  };
  $("#redo").onclick = () => {
    if (redo.length) {
      undo.push(realm.snapshot());
      realm.restore(redo.pop());
      save();
      render();
    }
  };
  $("#generate").onclick = async () => {
    if (
      await confirmAction(
        "Generate an island?",
        "This replaces the terrain. Characters, locations, and notes stay intact. You can undo it.",
      )
    ) {
      checkpoint();
      realm.generate(crypto.getRandomValues(new Uint32Array(1))[0]);
      save();
      render();
    }
  };
  document
    .querySelectorAll("[data-pin]")
    .forEach((b) => (b.onclick = () => editPin(+b.dataset.pin)));
  if (mode === "2d") setup2d();
  else setup3d();
  if (pinEdit >= 0 && s.pins[pinEdit]) editPin(pinEdit);
  selectionChanged();
}
function addPin(x, y) {
  if (!insideTerritory(state(), x, y)) return;
  checkpoint();
  const s = state();
  s.pins.push({ x, y, name: "New location", notes: "" });
  if (commit(s)) {
    pinMode = false;
    pinEdit = s.pins.length - 1;
    render();
    $("#pin-name")?.focus();
  }
}
function editPin(i) {
  pinEdit = i;
  const p = state().pins[i];
  $("#pin-editor").innerHTML =
    `<section class="panel pin-editor"><h2>Location details</h2><div class="form-grid"><label>Name<input id="pin-name" maxlength="200" value="${esc(p.name)}"></label><label>Map coordinates<input disabled value="${p.x + 1}, ${p.y + 1}"></label><label class="full">Story, inhabitants, and secrets<textarea id="pin-notes">${esc(p.notes)}</textarea></label></div><div class="actions"><button id="delete-pin" class="danger">Delete location</button></div></section>`;
  for (const [id, key] of [
    ["pin-name", "name"],
    ["pin-notes", "notes"],
  ])
    $("#" + id).oninput = (e) => {
      const s = state();
      s.pins[i][key] = e.target.value;
      if (commit(s)) {
        const card = $(`[data-pin="${i}"]`);
        card.querySelector("strong").textContent = "⌖ " + s.pins[i].name;
        card.querySelector("small").textContent =
          `Tile ${p.x + 1}, ${p.y + 1} · ${s.pins[i].notes ? "Has a story" : "An unwritten story"}`;
      }
    };
  $("#delete-pin").onclick = async () => {
    if (
      await confirmAction("Delete location?", `Remove ${p.name} and its notes?`)
    ) {
      const s = state();
      s.pins.splice(i, 1);
      pinEdit = -1;
      commit(s, true);
      render();
    }
  };
}
function applyBrush(x, y) {
  return realm.brush(
    x,
    y,
    brushSize,
    terrain,
    Math.max(
      0,
      [
        "paint",
        "raise",
        "lower",
        "flatten",
        "territory-add",
        "territory-erase",
      ].indexOf(buildTool),
    ),
  );
}
function applyBuild(x, y, z, erase = false) {
  if (x < 0 || x >= 40 || y < 0 || y >= 28 || z < 0 || z > 63) {
    notice("Keep blocks inside the world, at heights 0–63.");
    return false;
  }
  if (!insideTerritory(state(), x, y)) {
    notice("Draw territory here before placing blocks.");
    return false;
  }
  if (erase || buildTool === "erase") return realm.remove_block(x, y, z);
  return realm.place_block(x, y, z, blockMaterial);
}
function placePreset(x, y) {
  try {
    const next = stampStructure(state(), x, y, preset, blockMaterial);
    if (commit(next, true)) {
      notice();
      return true;
    }
  } catch (e) {
    notice(e.message);
  }
  return false;
}
function setup2d() {
  const canvas = $("#map"),
    ctx = canvas.getContext("2d");
  let painting = false,
    changed = false;
  const visited = new Set();
  let drag = null,
    marquee = null,
    hover = null,
    activePointer = null;
  canvas.tabIndex = 0;
  canvas.style.width = `${mapZoom * 100}%`;
  canvas.style.touchAction = buildTool === "navigate" ? "pan-x pan-y" : "none";
  canvas.style.cursor =
    buildTool === "select"
      ? "grab"
      : buildTool === "navigate"
        ? "grab"
        : "crosshair";
  $("#map-help").textContent =
    buildTool === "select"
      ? `${touchUI ? "Tap" : "Click"} a block, then drag · Select structure moves touching blocks · Drag empty space to select an area`
      : buildTool === "navigate"
        ? "Swipe to pan the map · use + / − to zoom"
        : shapeTool(buildTool)
          ? "Drag to draw or erase the map outline · choose Brush for a wider stroke · Undo restores your shape"
          : `${touchUI ? "Tap" : "Click"} to place · drag to paint · drag a material into the world`;
  const draw = () => {
    const s = state();
    const visible = (b) => insideTerritory(s, b.x, b.y);
    $("#block-count").textContent =
      `${s.blocks.length.toLocaleString()} / 12,000 blocks`;
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        const t = s.tiles[y * s.width + x],
          px = x * 25,
          py = y * 25;
        if (!s.territory[y * s.width + x]) {
          ctx.fillStyle = (x + y) % 2 ? "#14101c" : "#191421";
          ctx.fillRect(px, py, 25, 25);
          continue;
        }
        ctx.fillStyle = colors[t];
        ctx.fillRect(px, py, 25, 25);
        ctx.strokeStyle = "#18351f12";
        ctx.strokeRect(px, py, 25, 25);
        if (t === 2) {
          ctx.fillStyle = "#274e3899";
          ctx.beginPath();
          ctx.moveTo(px + 12, py + 4);
          ctx.lineTo(px + 5, py + 19);
          ctx.lineTo(px + 19, py + 19);
          ctx.fill();
        }
        if (t === 3) {
          ctx.fillStyle = "#ece8d5aa";
          ctx.beginPath();
          ctx.moveTo(px + 12, py + 4);
          ctx.lineTo(px + 4, py + 20);
          ctx.lineTo(px + 21, py + 20);
          ctx.fill();
        }
        if (t === 1) {
          ctx.strokeStyle = "#d1ece555";
          ctx.beginPath();
          ctx.moveTo(px + 5, py + 14);
          ctx.lineTo(px + 17, py + 14);
          ctx.stroke();
        }
      }
    for (const b of s.blocks.filter(visible).sort((a, b) => a.z - b.z)) {
      ctx.fillStyle = materials[b.material].color;
      ctx.fillRect(b.x * 25 + 3, b.y * 25 + 3, 19, 19);
      ctx.strokeStyle = "#ffffff66";
      ctx.strokeRect(b.x * 25 + 3, b.y * 25 + 3, 19, 19);
    }
    ctx.save();
    ctx.lineWidth = 3;
    for (const b of s.blocks.filter(
      (b) => visible(b) && selectionKeys.has(blockKey(b)),
    )) {
      ctx.strokeStyle = "#fff3a3";
      ctx.strokeRect(b.x * 25 + 1, b.y * 25 + 1, 23, 23);
    }
    if (drag && (drag.dx || drag.dy)) {
      const result = planMove(s, selectionKeys, drag.dx, drag.dy, 0, drag.copy);
      ctx.strokeStyle = result.error ? "#ff6969" : "#00e6c3";
      ctx.fillStyle = result.error ? "#ff696955" : "#00e6c366";
      for (const b of s.blocks.filter(
        (b) => visible(b) && selectionKeys.has(blockKey(b)),
      )) {
        const x = (b.x + drag.dx) * 25,
          y = (b.y + drag.dy) * 25;
        ctx.fillRect(x, y, 25, 25);
        ctx.strokeRect(x + 1, y + 1, 23, 23);
      }
    }
    if (marquee) {
      const x = Math.min(marquee.x, marquee.endX),
        y = Math.min(marquee.y, marquee.endY),
        w = Math.abs(marquee.endX - marquee.x) + 1,
        h = Math.abs(marquee.endY - marquee.y) + 1;
      ctx.fillStyle = "#00dab333";
      ctx.strokeStyle = "#00b69c";
      ctx.fillRect(x * 25, y * 25, w * 25, h * 25);
      ctx.strokeRect(x * 25, y * 25, w * 25, h * 25);
    }
    if (hover && !drag && !marquee && buildTool !== "navigate") {
      const size =
        hover.material !== undefined ||
        ["block", "erase", "select", "stamp"].includes(buildTool)
          ? 1
          : brushSize;
      const half = Math.floor(size / 2),
        x = (hover.x - half) * 25,
        y = (hover.y - half) * 25;
      ctx.fillStyle =
        hover.material !== undefined
          ? materials[hover.material].color + "aa"
          : "#ffffff22";
      ctx.strokeStyle = "#fff3a3";
      ctx.fillRect(x, y, size * 25, size * 25);
      ctx.strokeRect(x + 1, y + 1, size * 25 - 2, size * 25 - 2);
    }
    ctx.restore();
    s.pins.forEach((p, i) => {
      if (!visible(p)) return;
      ctx.fillStyle = "#fff7d8";
      ctx.beginPath();
      ctx.arc(p.x * 25 + 12.5, p.y * 25 + 12.5, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#483d29";
      ctx.stroke();
      ctx.fillStyle = "#3a3625";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), p.x * 25 + 12.5, p.y * 25 + 16);
    });
  };
  const cell = (e) => {
    const r = canvas.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - r.left) / r.width) * 40),
      Math.floor(((e.clientY - r.top) / r.height) * 28),
    ];
  };
  let lastTerritoryCell = null;
  const paint = (e) => {
    const [x, y] = cell(e);
    if (x < 0 || x >= 40 || y < 0 || y >= 28) return;
    if (shapeTool(buildTool)) {
      const [ax, ay] = lastTerritoryCell || [x, y];
      const steps = Math.max(Math.abs(x - ax), Math.abs(y - ay), 1);
      for (let n = 0; n <= steps; n++)
        changed =
          applyBrush(
            Math.round(ax + ((x - ax) * n) / steps),
            Math.round(ay + ((y - ay) * n) / steps),
          ) || changed;
      lastTerritoryCell = [x, y];
      if (changed) draw();
      return;
    }
    const key = x + "," + y;
    if (visited.has(key)) return;
    visited.add(key);
    let edited = false;
    if (buildTool === "block" || buildTool === "erase") {
      const data = state(),
        column = data.blocks
          .filter((b) => b.x === x && b.y === y)
          .sort((a, b) => b.z - a.z);
      const z =
        buildTool === "erase"
          ? (column[0]?.z ?? 0)
          : column.length
            ? column[0].z + 1
            : Math.floor(groundHeight(data, x, y));
      edited = applyBuild(x, y, z);
    } else edited = applyBrush(x, y);
    if (edited) {
      changed = true;
      draw();
    }
  };
  canvas.onpointerdown = (e) => {
    if (e.button !== 0 || buildTool === "navigate") return;
    if (activePointer !== null && activePointer !== e.pointerId) {
      drag = null;
      marquee = null;
      draw();
      return;
    }
    activePointer = e.pointerId;
    canvas.focus({ preventScroll: true });
    const [x, y] = cell(e);
    if (buildTool === "select" && !pinMode) {
      const b = state()
        .blocks.filter(
          (b) => insideTerritory(state(), b.x, b.y) && b.x === x && b.y === y,
        )
        .sort((a, b) => b.z - a.z)[0];
      if (b) {
        const key = blockKey(b);
        if (e.shiftKey) {
          const next = new Set(selectionKeys);
          next.has(key) ? next.delete(key) : next.add(key);
          selectBlocks(next);
        } else if (!selectionKeys.has(key)) selectBlocks([key]);
        if (selectionKeys.has(key))
          drag = { x, y, dx: 0, dy: 0, copy: e.altKey };
      } else {
        marquee = {
          x,
          y,
          endX: x,
          endY: y,
          initial: e.shiftKey ? [...selectionKeys] : [],
        };
        if (!e.shiftKey) selectBlocks([]);
      }
      canvas.setPointerCapture(e.pointerId);
      draw();
      return;
    }
    if (pinMode) {
      if (x >= 0 && x < 40 && y >= 0 && y < 28) addPin(x, y);
      return;
    }
    const pin = state().pins.findIndex((p) => p.x === x && p.y === y);
    if (e.shiftKey && pin >= 0) {
      editPin(pin);
      return;
    }
    if (buildTool === "stamp") {
      if (placePreset(x, y)) render();
      return;
    }
    checkpoint();
    visited.clear();
    lastTerritoryCell = null;
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  };
  canvas.onpointermove = (e) => {
    const [x, y] = cell(e);
    if (drag) {
      drag.dx = x - drag.x;
      drag.dy = y - drag.y;
      draw();
    } else if (marquee) {
      marquee.endX = x;
      marquee.endY = y;
      draw();
    } else if (painting) paint(e);
    else {
      hover = { x, y };
      draw();
    }
  };
  canvas.onpointerleave = () => {
    hover = null;
    if (!drag && !marquee) draw();
  };
  canvas.ondblclick = (e) => {
    if (buildTool !== "select") return;
    const [x, y] = cell(e),
      b = state()
        .blocks.filter(
          (b) => insideTerritory(state(), b.x, b.y) && b.x === x && b.y === y,
        )
        .sort((a, b) => b.z - a.z)[0];
    if (b) selectBlocks(connectedBlocks(state().blocks, blockKey(b)));
  };
  const finish = () => {
    if (painting) {
      painting = false;
      if (changed) {
        save();
        changed = false;
      }
      $("#undo").disabled = !undo.length;
      $("#redo").disabled = true;
    }
  };
  canvas.onpointerup = (e) => {
    if (activePointer !== null && e.pointerId !== activePointer) return;
    activePointer = null;
    if (drag) {
      const d = drag;
      drag = null;
      moveSelection(d.dx, d.dy, 0, d.copy);
      draw();
    } else if (marquee) {
      const m = marquee;
      marquee = null;
      selectBlocks([
        ...m.initial,
        ...state()
          .blocks.filter(
            (b) =>
              insideTerritory(state(), b.x, b.y) &&
              b.x >= Math.min(m.x, m.endX) &&
              b.x <= Math.max(m.x, m.endX) &&
              b.y >= Math.min(m.y, m.endY) &&
              b.y <= Math.max(m.y, m.endY),
          )
          .map(blockKey),
      ]);
    }
    finish();
  };
  canvas.onpointercancel = () => {
    activePointer = null;
    drag = null;
    marquee = null;
    finish();
    draw();
  };
  const materialDrag = (e) => {
    const d = e.detail,
      r = canvas.getBoundingClientRect(),
      frame = canvas.parentElement.getBoundingClientRect();
    const inside =
      d.x >= Math.max(r.left, frame.left) &&
      d.x <= Math.min(r.right, frame.right) &&
      d.y >= Math.max(r.top, frame.top) &&
      d.y <= Math.min(r.bottom, frame.bottom);
    if (!inside || d.phase === "cancel") {
      hover = null;
      draw();
      return;
    }
    const [x, y] = cell({ clientX: d.x, clientY: d.y });
    if (d.phase === "drop") {
      const world = state(),
        column = world.blocks.filter(
          (b) => insideTerritory(state(), b.x, b.y) && b.x === x && b.y === y,
        ),
        z = column.length
          ? Math.max(...column.map((b) => b.z)) + 1
          : Math.floor(groundHeight(world, x, y));
      dropMaterial(d.id, x, y, z);
      hover = null;
      draw();
    } else {
      hover = { x, y, material: d.id };
      draw();
    }
  };
  window.addEventListener("world-material-drag", materialDrag);
  redrawWorld = draw;
  cleanup = () => {
    drag = null;
    marquee = null;
    finish();
    window.removeEventListener("world-material-drag", materialDrag);
  };
  draw();
}
let sceneGeneration = 0;
async function setup3d() {
  const generation = ++sceneGeneration;
  let disposed = false;
  cleanup = () => {
    disposed = true;
  };
  try {
    const { mountWorld } = await import("./world3d.js");
    if (disposed || generation !== sceneGeneration) return;
    cleanup = mountWorld($("#scene"), state(), {
      colors,
      selection: () => selectionKeys,
      select: selectBlocks,
      move: moveSelection,
      plan: (dx, dy, dz = 0, copy = false) =>
        planMove(state(), selectionKeys, dx, dy, dz, copy),
      connected: (key) => selectBlocks(connectedBlocks(state().blocks, key)),
      drop: dropMaterial,
      refresh: (fn) => {
        redrawWorld = () => fn(state());
      },
      tool: () => buildTool,
      material: () => blockMaterial,
      brush: () => brushSize,
      pinMode: () => pinMode,
      addPin,
      edit(x, y, z, erase = false) {
        if (buildTool === "stamp" && !erase) {
          placePreset(x, y);
          return state();
        }
        checkpoint();
        const changed =
          buildTool === "block" || buildTool === "erase" || erase
            ? applyBuild(x, y, z, erase)
            : applyBrush(x, y);
        if (changed) {
          save();
          $("#undo").disabled = false;
          $("#redo").disabled = true;
        }
        return state();
      },
    });
  } catch (e) {
    if (!disposed)
      $("#scene").textContent =
        "3D could not start. Try a browser with WebGL enabled, or use the 2D map. " +
        e.message;
  }
}
function renderCharacters() {
  const s = state();
  selected = Math.min(selected, Math.max(0, s.characters.length - 1));
  const c = s.characters[selected];
  $("#app").innerHTML =
    heading(
      "ASSEMBLE YOUR PARTY",
      "Characters",
      "Heroes, wanderers, and the people they become.",
      '<div class="character-actions"><button id="import-ddb">Import D&D Beyond</button><button id="add-character" class="primary">+ New character</button></div>',
    ) +
    (!c
      ? '<div class="empty"><h2>Every story needs a hero.</h2><p>Create your first character to begin. Use your preferred D&D rules for class features and spells.</p></div>'
      : `<div class="character-layout"><div class="character-list">${s.characters.map((c, i) => `<button class="character-card ${i === selected ? "selected" : ""}" data-character="${i}"><strong>${esc(c.name)}</strong><small>Level ${c.level} · ${esc(c.class || "Adventurer")}</small></button>`).join("")}</div><section class="panel">${c.source ? `<div class="import-source"><span>Imported from <a href="https://www.dndbeyond.com/characters/${c.source.id}" target="_blank" rel="noopener noreferrer">D&D Beyond ↗</a> · one-time copy</span><button id="download-ddb" type="button">Download original JSON</button><details><summary>Import notes</summary><ul>${c.source.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details></div>` : ""}<div class="sheet-toolbar"><button id="view-character-sheet">View filled sheet</button><button id="download-character-pdf" class="primary">Download character PDF</button><button id="edit-character-details">Edit details</button></div><div id="character-sheet-preview">${renderCharacterSheet(c)}</div><details id="character-editor" class="character-editor" open><summary>Edit character details</summary><form id="character-form"><div class="form-grid">${[
          ["name", "Name", c.name],
          ["ancestry", "Ancestry / species", c.ancestry],
          ["class", "Class", c.class],
          ["level", "Level", c.level],
          ["hp", "Hit points", c.hp],
        ]
          .map(
            ([key, label, value]) =>
              `<label>${label}<input name="${key}" value="${esc(value)}" ${["level", "hp"].includes(key) ? `type="number" min="${key === "level" ? 1 : 0}" max="${key === "level" ? 20 : 65535}"` : 'maxlength="200"'} ${key === "name" ? "required" : ""}></label>`,
          )
          .join(
            "",
          )}</div><div class="stats">${["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((a, i) => `<label class="stat">${a}<input name="ability-${i}" type="number" min="1" max="30" required value="${c.abilities[i]}"><span class="modifier" id="mod-${i}">${mod(c.abilities[i])}</span></label>`).join("")}</div><div class="form-grid">${[
          ["notes", "Backstory & features"],
          ["inventory", "Inventory & equipment"],
          ["spells", "Spells & abilities"],
        ]
          .map(
            ([k, l]) =>
              `<label class="full">${l}<textarea name="${k}">${esc(c[k])}</textarea></label>`,
          )
          .join(
            "",
          )}</div>${renderSheetEditor(c)}<div class="actions"><button type="button" id="delete-character" class="danger">Delete character</button></div><p class="hint">Edits save automatically. Ability modifiers are calculated; skills, saves, and spellcasting use the proficiencies and overrides above. Blank overrides use automatic values.</p></form></details></section></div>`);
  $("#import-ddb").onclick = () =>
    openDdbImport({
      characters: state().characters,
      onImport(character, replaceIndex) {
        const s = state();
        if (replaceIndex >= 0) s.characters[replaceIndex] = character;
        else s.characters.push(character);
        const candidate = new Realm();
        try {
          candidate.restore(JSON.stringify(s));
        } finally {
          candidate.free();
        }
        if (!commit(s, true)) return false;
        selected = replaceIndex >= 0 ? replaceIndex : s.characters.length - 1;
        notice();
        render();
        return true;
      },
    });
  if (c?.source)
    $("#download-ddb").onclick = () => {
      const url = URL.createObjectURL(
        new Blob([c.source.original], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `dndbeyond-${c.source.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  $("#add-character").onclick = () => {
    const s = state();
    s.characters.push({
      name: "New adventurer",
      ancestry: "",
      class: "",
      level: 1,
      hp: 10,
      abilities: [10, 10, 10, 10, 10, 10],
      notes: "",
      inventory: "",
      spells: "",
    });
    selected = s.characters.length - 1;
    if (commit(s, true)) {
      render();
      $('[name="name"]').focus();
      $('[name="name"]').select();
    }
  };
  document.querySelectorAll("[data-character]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = +b.dataset.character;
        render();
      }),
  );
  if (!c) return;
  $("#view-character-sheet").onclick = () =>
    $("#character-sheet-preview").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  $("#edit-character-details").onclick = () => {
    $("#character-editor").open = true;
    $("#character-form").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#download-character-pdf").onclick = async () => {
    const character = structuredClone(state().characters[selected]);
    const button = $("#download-character-pdf");
    button.disabled = true;
    button.textContent = "Preparing PDF…";
    try {
      const { downloadCharacterPdf } = await import("./character-pdf.js");
      await downloadCharacterPdf(character);
    } catch (e) {
      notice(`PDF could not be generated: ${e.message}`);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "Download character PDF";
      }
    }
  };
  $("#character-form").onsubmit = (e) => e.preventDefault();
  $("#character-form").oninput = (e) => {
    if (!e.target.name) return;
    if (!$("#character-form").checkValidity()) {
      invalidDraft = true;
      status("Incomplete fields · not saved");
      $("#download-character-pdf").disabled = true;
      return;
    }
    const s = state(),
      c = s.characters[selected],
      f = new FormData($("#character-form"));
    for (const k of [
      "name",
      "ancestry",
      "class",
      "notes",
      "inventory",
      "spells",
    ])
      c[k] = f.get(k);
    c.level = Number(f.get("level"));
    c.hp = Number(f.get("hp"));
    c.abilities = c.abilities.map((_, i) => Number(f.get("ability-" + i)));
    c.sheet = readSheetForm($("#character-form"), c);
    if (commit(s)) {
      $("#download-character-pdf").disabled = false;
      $("#character-sheet-preview").innerHTML = renderCharacterSheet(c);
      c.abilities.forEach((a, i) => ($("#mod-" + i).textContent = mod(a)));
      const card = $(`[data-character="${selected}"]`);
      card.querySelector("strong").textContent = c.name;
      card.querySelector("small").textContent =
        `Level ${c.level} · ${c.class || "Adventurer"}`;
    }
  };
  $("#delete-character").onclick = async () => {
    if (
      await confirmAction(
        "Delete character?",
        `Remove ${state().characters[selected].name} and their sheet?`,
      )
    ) {
      const s = state();
      s.characters.splice(selected, 1);
      commit(s, true);
      render();
    }
  };
}
function mod(a) {
  const m = ability_modifier(a);
  return m >= 0 ? "+" + m : String(m);
}
function renderLore() {
  const s = state();
  $("#app").innerHTML =
    heading(
      "THE THREADS OF YOUR STORY",
      "World notebook",
      "Keep the lore, factions, quests, and secrets in one place.",
    ) +
    `<section class="panel notebook"><label>Realm name<input id="realm-title" maxlength="200" value="${esc(s.title)}"></label><br><label>Campaign notebook<textarea id="realm-lore" placeholder="What makes this world different?\n\nFactions & rivals\nPeople & places\nQuests & mysteries\nSession notes">${esc(s.lore)}</textarea></label><p class="hint">Everything here is included in your backup.</p></section>`;
  for (const [id, key] of [
    ["realm-title", "title"],
    ["realm-lore", "lore"],
  ])
    $("#" + id).oninput = (e) => {
      const s = state();
      s[key] = e.target.value;
      commit(s);
    };
}
async function boot() {
  await init();
  realm = new Realm();
  try {
    db = await openDB();
    const saved = await read();
    if (saved) {
      try {
        realm.restore(saved);
      } catch (e) {
        blocked = true;
        notice(
          "The existing save could not be read and has been preserved. Import a valid backup to recover. " +
            String(e),
        );
      }
    } else {
      realm.generate(73195);
      save();
    }
    if (!blocked && !pending) status("✓ Saved in this browser");
    else if (blocked) status("Existing save needs recovery");
  } catch (e) {
    notice(
      "Browser storage is unavailable. You can still work, but must export a backup before closing. " +
        e.message,
    );
    status("Not saved · export a backup");
  }
  render();
  document.addEventListener(
    "click",
    (e) => {
      if (
        invalidDraft &&
        e.target.closest("button,a") &&
        !e.target.closest("#import,#confirm-dialog")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        $("#character-form")?.reportValidity();
        notice(
          "Finish the current edit before continuing. Names cannot be empty, levels must be 1–20, and ability scores must be 1–30.",
        );
      }
    },
    true,
  );
  $("#export").disabled = false;
  $("#import").disabled = false;
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        render();
      }),
  );
  $("#export").onclick = () => {
    const blob = new Blob([realm.snapshot()], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      (state().title.replace(/[^a-z0-9_-]/gi, "-") || "realm") + ".realm.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("#import").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("Backup is larger than 5 MB.");
      const json = await file.text();
      const candidate = new Realm();
      try {
        candidate.restore(json);
      } finally {
        candidate.free();
      }
      if (
        !(await confirmAction(
          "Import this realm?",
          "This replaces your current workspace. Export a backup first if you want to keep it.",
        ))
      )
        return;
      checkpoint();
      realm.restore(json);
      blocked = false;
      invalidDraft = false;
      pinEdit = -1;
      notice();
      save();
      render();
    } catch (e) {
      notice("Import failed; your current realm is unchanged. " + String(e));
    }
  };
  $("#persist").onclick = async () => {
    try {
      const granted = await navigator.storage?.persist?.();
      notice(
        granted
          ? "Persistent storage is enabled. Keep exporting backups too."
          : "Your browser did not grant persistent storage. Download backups regularly.",
      );
    } catch (e) {
      notice("Could not request persistent storage. " + e.message);
    }
  };
  window.addEventListener("beforeunload", (e) => {
    if (dirty || invalidDraft) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
// One writer per browser prevents two tabs silently overwriting each other.
if (navigator.locks) {
  navigator.locks
    .request("realm-forge-editor", { ifAvailable: true }, async (lock) => {
      if (!lock) {
        $("#app").textContent =
          "DND Campaign Building is already open in another tab. Close that tab, then reload this one to edit safely.";
        status("Open in another tab");
        return;
      }
      await boot();
      await new Promise(() => {});
    })
    .catch((e) => {
      notice("Could not open the workshop: " + e.message);
    });
} else boot().catch((e) => notice("Could not open the workshop: " + e.message));

document.addEventListener("keydown", (e) => {
  if (
    !realm ||
    tab !== "world" ||
    blocked ||
    document.querySelector("dialog[open]") ||
    e.target.closest("input, textarea, select, [contenteditable]")
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $(e.shiftKey ? "#redo" : "#undo")?.click();
    return;
  }
  if (e.key === "Escape") {
    if (selectionKeys.size) selectBlocks([]);
    else if (expandedEditor) {
      expandedEditor = false;
      render();
    }
  } else if (
    (e.key === "Delete" || e.key === "Backspace") &&
    selectionKeys.size
  ) {
    e.preventDefault();
    deleteSelection();
  } else if (
    selectionKeys.size &&
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
    ].includes(e.key)
  ) {
    e.preventDefault();
    const shifts = {
      ArrowLeft: [-1, 0, 0],
      ArrowRight: [1, 0, 0],
      ArrowUp: [0, -1, 0],
      ArrowDown: [0, 1, 0],
      PageUp: [0, 0, 1],
      PageDown: [0, 0, -1],
    };
    moveSelection(...shifts[e.key]);
  } else if (
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    { v: "select", b: "block", p: "paint" }[e.key.toLowerCase()]
  ) {
    buildTool = { v: "select", b: "block", p: "paint" }[e.key.toLowerCase()];
    pinMode = false;
    render();
  }
});
