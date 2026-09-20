import { openDdbImport } from "./ddb-import.js";
import init, { Realm, ability_modifier } from "./pkg/realm_forge.js";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const colors = [
  "#91aa73",
  "#679da5",
  "#426e51",
  "#929084",
  "#d8c08a",
  "#b39578",
];
const terrainNames = ["Meadow", "Water", "Forest", "Mountain", "Sand", "Road"];
let realm,
  db,
  tab = "world",
  terrain = 2,
  selected = 0,
  mode = "2d",
  pinMode = false,
  cleanup = () => {},
  undo = [],
  redo = [],
  saving = Promise.resolve(),
  dirty = false,
  invalidDraft = false,
  pending = 0,
  blocked = false,
  pinEdit = -1;
const state = () => JSON.parse(realm.snapshot());
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
      reject(new Error("Close other Realm Forge tabs to open storage."));
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
  cleanup();
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
function renderWorld() {
  const s = state();
  $("#app").innerHTML =
    heading(
      "MAKE YOUR MARK",
      "World atlas",
      "Every great adventure begins with a place.",
      `<div class="view-switch"><button id="view-2d" class="${mode === "2d" ? "primary" : ""}">2D map</button><button id="view-3d" class="${mode === "3d" ? "primary" : ""}">3D world</button></div>`,
    ) +
    `<div class="atlas-layout"><section><div class="map-card"><div class="map-bar"><strong>${esc(s.title)}</strong><span>40 × 28 · ${mode === "2d" ? "TOP DOWN" : "PERSPECTIVE"}</span></div><div class="canvas-wrap" id="viewport">${mode === "2d" ? '<canvas id="map" width="1000" height="700" aria-label="World map: paint terrain or place locations with a pointer"></canvas>' : '<div id="scene" aria-label="Interactive 3D world"></div>'}</div><div class="map-foot"><span id="map-help">${mode === "2d" ? "Drag to paint · choose Place location to add a pin" : "Drag to orbit · scroll to zoom · enable paint to edit"}</span><span>◈ ${esc(s.title)}</span></div></div><div class="locations"><div class="section-heading"><h2>Places & stories</h2><span>${s.pins.length} LOCATIONS</span></div><div class="pin-list">${s.pins.map((p, i) => `<button class="pin-item" data-pin="${i}"><strong>⌖ ${esc(p.name)}</strong><small>Tile ${p.x + 1}, ${p.y + 1} · ${p.notes ? "Has a story" : "An unwritten story"}</small></button>`).join("") || '<div class="empty" style="width:100%">Place a location on your map and give it a story.</div>'}</div><div id="pin-editor"></div></div></section><div class="atlas-tools"><section class="panel"><div class="eyebrow">SHAPE YOUR WORLD</div><h2>Terrain palette</h2><div class="terrain-list">${terrainNames.map((n, i) => `<button class="terrain ${i === terrain ? "selected" : ""}" data-terrain="${i}" aria-pressed="${i === terrain}"><span class="swatch" style="background:${colors[i]}"></span>${n}</button>`).join("")}</div><p class="hint">One world, two views. Your changes appear in both.</p></section><section class="panel"><div class="eyebrow">MAP TOOLS</div><div class="tool-stack"><button id="place-pin" class="${pinMode ? "primary" : ""}">⌖ ${pinMode ? "Click map to place" : "Place location"}</button>${mode === "3d" ? '<button id="paint-3d">Enable terrain painting</button>' : ""}<button id="undo" ${undo.length ? "" : "disabled"}>↶ Undo</button><button id="redo" ${redo.length ? "" : "disabled"}>↷ Redo</button><button id="generate">✧ Generate island</button></div><p class="hint">Generate a starting landscape, then make it your own.</p></section></div></div>`;
  $("#view-2d").onclick = () => {
    mode = "2d";
    render();
  };
  $("#view-3d").onclick = () => {
    mode = "3d";
    render();
  };
  document.querySelectorAll("[data-terrain]").forEach(
    (b) =>
      (b.onclick = () => {
        terrain = +b.dataset.terrain;
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
}
function addPin(x, y) {
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
function setup2d() {
  const canvas = $("#map"),
    ctx = canvas.getContext("2d");
  let painting = false,
    changed = false;
  const draw = () => {
    const s = state();
    for (let y = 0; y < s.height; y++)
      for (let x = 0; x < s.width; x++) {
        const t = s.tiles[y * s.width + x],
          px = x * 25,
          py = y * 25;
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
    s.pins.forEach((p, i) => {
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
  const paint = (e) => {
    const [x, y] = cell(e);
    if (realm.paint(x, y, terrain)) {
      changed = true;
      draw();
    }
  };
  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    const [x, y] = cell(e);
    if (pinMode) {
      if (x >= 0 && x < 40 && y >= 0 && y < 28) addPin(x, y);
      return;
    }
    const pin = state().pins.findIndex((p) => p.x === x && p.y === y);
    if (e.shiftKey && pin >= 0) {
      editPin(pin);
      return;
    }
    checkpoint();
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  };
  canvas.onpointermove = (e) => {
    if (painting) paint(e);
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
  canvas.onpointerup = finish;
  canvas.onpointercancel = finish;
  cleanup = finish;
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
      terrain: () => terrain,
      pinMode: () => pinMode,
      addPin,
      paint(x, y) {
        checkpoint();
        if (realm.paint(x, y, terrain)) {
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
      : `<div class="character-layout"><div class="character-list">${s.characters.map((c, i) => `<button class="character-card ${i === selected ? "selected" : ""}" data-character="${i}"><strong>${esc(c.name)}</strong><small>Level ${c.level} · ${esc(c.class || "Adventurer")}</small></button>`).join("")}</div><section class="panel">${c.source ? `<div class="import-source"><span>Imported from <a href="https://www.dndbeyond.com/characters/${c.source.id}" target="_blank" rel="noopener noreferrer">D&D Beyond ↗</a> · one-time copy</span><button id="download-ddb" type="button">Download original JSON</button><details><summary>Import notes</summary><ul>${c.source.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details></div>` : ""}<form id="character-form"><div class="form-grid">${[
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
          )}</div><div class="actions"><button type="button" id="delete-character" class="danger">Delete character</button></div><p class="hint">Edits save automatically. Ability modifiers are calculated; this is a flexible sheet, not an edition-specific rules validator.</p></form></section></div>`);
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
  $("#character-form").onsubmit = (e) => e.preventDefault();
  $("#character-form").oninput = (e) => {
    if (!e.target.name) return;
    if (!$("#character-form").checkValidity()) {
      invalidDraft = true;
      status("Incomplete fields · not saved");
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
    if (commit(s)) {
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
          "Realm Forge is already open in another tab. Close that tab, then reload this one to edit safely.";
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
