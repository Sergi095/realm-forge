import { preview_ddb } from "./pkg/realm_forge.js";
const MAX_BYTES = 2_000_000;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function characterId(input) {
  const value = input.trim();
  let id;
  if (/^\d+$/.test(value)) id = value;
  else {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        "Paste a D&D Beyond character link or its numeric character ID.",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      ![
        "dndbeyond.com",
        "www.dndbeyond.com",
        "character-service.dndbeyond.com",
      ].includes(url.hostname)
    )
      throw new Error("Use an https://www.dndbeyond.com/characters/… link.");
    id =
      url.pathname.match(
        /^(?:\/profile\/[^/]+)?\/characters\/(\d+)(?:\/[^/]*)?\/?$/,
      )?.[1] ||
      (url.hostname === "character-service.dndbeyond.com"
        ? url.pathname.match(/^\/character\/v5\/character\/(\d+)\/?$/)?.[1]
        : null);
  }
  if (!id || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    throw new Error("The link does not contain a valid character ID.");
  return String(Number(id));
}
async function limitedText(response) {
  if (Number(response.headers.get("content-length")) > MAX_BYTES)
    throw new Error("Character data exceeds 2 MB.");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES)
      throw new Error("Character data exceeds 2 MB.");
    return text;
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Character data exceeds 2 MB.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export function openDdbImport({ characters, onImport }) {
  const dialog = document.createElement("dialog");
  dialog.className = "ddb-dialog";
  dialog.innerHTML = `<div class="ddb-heading"><div><div class="kicker">BRING YOUR HERO WITH YOU</div><h2>Import from D&D Beyond</h2></div><button id="ddb-close" aria-label="Close character import">×</button></div><p>Add a character to this realm. Your maps, notes, and other characters stay intact.</p><section class="import-method"><h3>From a character link</h3><label>D&D Beyond character link or ID<input id="ddb-link" type="text" placeholder="https://www.dndbeyond.com/characters/123456789" autocomplete="off"></label><div class="import-actions"><button id="ddb-fetch" class="primary">Load character</button><a id="ddb-data" hidden target="_blank" rel="noopener noreferrer">Open character data ↗</a></div><p class="hint">Direct loading depends on the character's visibility and D&D Beyond allowing browser access. If loading fails, open the character data, save that page as a JSON file, and choose it below. No proxy or account password is used.</p></section><section class="import-method"><h3>From a character-data file</h3><label>Choose D&D Beyond JSON<input id="ddb-file" type="file" accept=".json,application/json"></label><p class="hint">Choose one character's JSON data, not a DND Campaign Building backup or a PDF sheet. The file is read only in this browser (maximum 2 MB).</p></section><p id="ddb-error" role="alert" hidden></p><div id="ddb-preview" aria-live="polite"></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const $ = (s) => dialog.querySelector(s);
  let controller,
    active = true,
    request = 0;
  const showError = (e) => {
    $("#ddb-error").hidden = false;
    $("#ddb-error").textContent = String(e?.message || e);
  };
  const clear = () => {
    $("#ddb-error").hidden = true;
    $("#ddb-preview").innerHTML = "";
  };
  const close = () => {
    active = false;
    controller?.abort();
    dialog.close();
    dialog.remove();
  };
  $("#ddb-close").onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  function updateLink() {
    try {
      const id = characterId($("#ddb-link").value);
      $("#ddb-data").href =
        `https://character-service.dndbeyond.com/character/v5/character/${id}`;
      $("#ddb-data").hidden = false;
      return id;
    } catch {
      $("#ddb-data").hidden = true;
      return null;
    }
  }
  $("#ddb-link").oninput = () => {
    request++;
    controller?.abort();
    $("#ddb-fetch").disabled = false;
    $("#ddb-fetch").textContent = "Load character";
    clear();
    updateLink();
  };
  $("#ddb-fetch").onclick = async () => {
    const version = ++request;
    clear();
    let id;
    try {
      id = characterId($("#ddb-link").value);
    } catch (e) {
      showError(e);
      return;
    }
    updateLink();
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timer = setTimeout(() => requestController.abort(), 15000);
    $("#ddb-fetch").disabled = true;
    $("#ddb-fetch").textContent = "Loading…";
    try {
      const response = await fetch(
        `https://character-service.dndbeyond.com/character/v5/character/${id}`,
        {
          mode: "cors",
          credentials: "omit",
          redirect: "error",
          signal: requestController.signal,
          referrerPolicy: "no-referrer",
        },
      );
      if (!response.ok)
        throw new Error(
          `D&D Beyond returned HTTP ${response.status}. Check that you can access this character on D&D Beyond.`,
        );
      const text = await limitedText(response);
      if (active && version === request) preview(text, id);
    } catch (e) {
      if (active && version === request)
        showError(
          `${e?.name === "AbortError" ? "Loading timed out." : String(e?.message || e)} If direct loading is unavailable, use “Open character data”, save the JSON, and choose that file below. Private or inaccessible characters cannot be fetched here.`,
        );
    } finally {
      clearTimeout(timer);
      if (active && version === request) {
        $("#ddb-fetch").disabled = false;
        $("#ddb-fetch").textContent = "Load character";
      }
    }
  };
  $("#ddb-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const version = ++request;
    controller?.abort();
    $("#ddb-fetch").disabled = false;
    $("#ddb-fetch").textContent = "Load character";
    clear();
    try {
      if (file.size > MAX_BYTES)
        throw new Error("Character data exceeds 2 MB.");
      const json = await file.text();
      if (active && version === request) preview(json);
    } catch (e) {
      if (active && version === request) showError(e);
    }
  };
  function preview(json, expectedId) {
    const result = JSON.parse(preview_ddb(json));
    const c = result.character;
    if (expectedId && String(c.source.id) !== expectedId)
      throw new Error(
        "D&D Beyond returned a different character ID. Nothing was imported.",
      );
    const duplicate = characters.findIndex(
      (ch) => ch.source?.kind === "dndbeyond" && ch.source.id === c.source.id,
    );
    $("#ddb-preview").innerHTML =
      `<section class="import-review"><div class="eyebrow">REVIEW BEFORE IMPORTING</div><h3>${esc(c.name)}</h3><ul class="import-warnings">${result.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><form id="ddb-review-form"><div class="form-grid">${[
        ["name", "Character name"],
        ["ancestry", "Species"],
        ["class", "Classes"],
        ["level", "Total level"],
        ["hp", "Maximum HP"],
      ]
        .map(
          ([key, label]) =>
            `<label>${label}<input name="${key}" value="${esc(c[key])}" ${["level", "hp"].includes(key) ? `type="number" required min="${key === "level" ? 1 : 0}" max="${key === "level" ? 20 : 65535}"` : 'maxlength="200"'} ${key === "name" ? "required" : ""}></label>`,
        )
        .join(
          "",
        )}</div><div class="stats">${["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((n, i) => `<label class="stat">${n}<input name="ability-${i}" type="number" min="1" max="30" required value="${c.abilities[i]}"></label>`).join("")}</div><details><summary>Equipment, spells, and notes</summary>${[
        ["inventory", "Equipment"],
        ["spells", "Spells"],
        ["notes", "Notes & features"],
      ]
        .map(
          ([k, l]) =>
            `<h4>${l}</h4><pre>${esc(c[k] || "None in source data.")}</pre>`,
        )
        .join(
          "",
        )}</details>${duplicate >= 0 ? `<label class="duplicate-choice">This character is already in your realm<select id="ddb-duplicate"><option value="copy">Add another copy</option><option value="replace">Replace ${esc(characters[duplicate].name)} with this import</option></select></label><p class="hint">Replacing discards local edits to that character. Export a realm backup first if you want to keep them.</p>` : ""}<div class="actions"><button type="submit" id="ddb-add" class="primary">Add character to realm</button></div></form></section>`;
    $("#ddb-duplicate")?.addEventListener("change", (e) => {
      $("#ddb-add").textContent =
        e.target.value === "replace"
          ? "Replace existing character"
          : "Add character to realm";
    });
    $("#ddb-review-form").onsubmit = (e) => {
      e.preventDefault();
      if (!e.target.reportValidity()) return;
      const data = new FormData(e.target);
      for (const k of ["name", "ancestry", "class"]) c[k] = data.get(k).trim();
      c.level = Number(data.get("level"));
      c.hp = Number(data.get("hp"));
      c.abilities = c.abilities.map((_, i) => Number(data.get("ability-" + i)));
      try {
        const replace =
          $("#ddb-duplicate")?.value === "replace" ? duplicate : -1;
        if (onImport(c, replace) !== false) close();
        else
          showError(
            "The character could not be saved to this realm. Check the message behind this dialog; your existing realm was preserved.",
          );
      } catch (e) {
        showError(e);
      }
    };
  }
}
