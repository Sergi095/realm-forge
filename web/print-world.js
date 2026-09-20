import {
  terrains,
  materials,
  printColors,
  baseColorIndex,
} from "./materials.js";
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) => Number(n.toFixed(2)).toLocaleString();
const distance = (n) => (n >= 1000 ? `${fmt(n / 1000)} km` : `${fmt(n)} m`);
const settings = {
  width: 180,
  base: 2,
  relief: 1,
  trees: true,
  pins: true,
  bed: 220,
  section: 0,
  part: 0,
  scale: "width",
  ratio: 60,
  format: "3mf",
  colors: [...printColors],
};
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function openPrintWorld(realm) {
  const world = JSON.parse(realm.snapshot()),
    dialog = document.createElement("dialog");
  dialog.className = "print-dialog";
  dialog.innerHTML = `<div class="ddb-heading"><div><div class="kicker">FROM YOUR WORLD TO YOUR TABLE</div><h2>3D print your world</h2></div><button id="print-close" aria-label="Close print preview">×</button></div><p>Your world covers <strong>${distance(world.width * world.meters_per_tile)} × ${distance(world.height * world.meters_per_tile)}</strong>. Each tile represents ${distance(world.meters_per_tile)}.</p><div class="print-layout"><form id="print-form"><label>Print format<select id="print-format"><option value="3mf">3MF · color model</option><option value="stl">STL · single-color geometry</option></select></label><label>Choose print scale<select id="print-scale"><option value="width">Set whole-world width</option><option value="60">1:60 · 5 ft becomes 1 inch</option><option value="100">1:100</option><option value="250">1:250</option><option value="500">1:500</option><option value="1000">1:1,000</option><option value="custom">Custom scale ratio</option></select></label><label>Whole-world width (mm)<input id="print-width" type="number" min="4" max="2000" step="0.1" value="${settings.width}" required></label><label>Scale denominator (1 : …)<input id="print-ratio" type="number" min="1" max="1000000000" step="any" value="${settings.ratio}" required></label><label>Export area<select id="print-section"><option value="0">Entire world · 40 × 28 tiles</option><option value="8">Sections · 8 × 8 tiles</option><option value="5">Sections · 5 × 5 tiles</option></select></label><label id="print-part-label" hidden>Section<select id="print-part"></select></label><div class="form-grid"><label>Base thickness (mm)<input id="print-base" type="number" min="1" max="10" step="0.5" value="${settings.base}" required></label><label>Terrain height scale<input id="print-relief" type="number" min="0.25" max="3" step="0.25" value="${settings.relief}" required></label></div><label>Square print-bed size (mm)<input id="print-bed" type="number" min="40" max="2000" value="${settings.bed}" required></label><label class="check-label"><input id="print-trees" type="checkbox" ${settings.trees ? "checked" : ""}> Include trees</label><label class="check-label"><input id="print-pins" type="checkbox" ${settings.pins ? "checked" : ""}> Include location markers</label><details><summary>Print colors</summary><div id="print-colors" class="print-colors"></div><p class="hint">Assign a solid print color to each world material. Textures become colors, not physical materials.</p></details></form><section><div id="print-preview" aria-label="Printable model preview">Preparing the print preview…</div><div id="print-measurements" class="print-measurements" role="status"></div><p id="print-error" role="alert" hidden></p><p class="hint">This is a solid relief with a flat base. Terrain and structures are joined; spaces beneath roofs and bridges are filled. The preview shows the exported shape. 3MF retains these solid colors; STL is geometry only. Your slicer may require color-to-extruder assignments. Import in millimetres.</p><div class="actions"><button id="print-zip" hidden>Download all sections (.zip)</button><button id="print-download" class="primary" disabled>Download STL</button></div></section></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const $ = (s) => dialog.querySelector(s);
  let active = true,
    bytes,
    model,
    parts = [],
    current,
    preview,
    debounce;
  $("#print-format").value = settings.format;
  const palette = [...terrains, ...materials, { name: "Base" }],
    used = [
      ...new Set([
        ...world.tiles,
        ...world.blocks.map((b) => 12 + b.material),
        29,
        baseColorIndex,
      ]),
    ].sort((a, b) => a - b);
  $("#print-colors").innerHTML = used
    .map(
      (i) =>
        `<label>${esc(palette[i].name)}<input type="color" data-print-color="${i}" value="${settings.colors[i]}"></label>`,
    )
    .join("");
  $("#print-scale").value = settings.scale;
  $("#print-section").value = String(settings.section);
  const close = () => {
    active = false;
    clearTimeout(debounce);
    preview?.dispose();
    dialog.close();
    dialog.remove();
  };
  $("#print-close").onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  $("#print-form").onsubmit = (e) => e.preventDefault();
  function buildParts() {
    const size = Number($("#print-section").value);
    parts = [];
    if (!size) parts.push({ x: 0, y: 0, w: 40, h: 28 });
    else
      for (let y = 0; y < 28; y += size)
        for (let x = 0; x < 40; x += size)
          parts.push({
            x,
            y,
            w: Math.min(size, 40 - x),
            h: Math.min(size, 28 - y),
          });
    $("#print-part").innerHTML = parts
      .map(
        (p, i) =>
          `<option value="${i}">Column ${Math.floor(p.x / (size || 40)) + 1}, row ${Math.floor(p.y / (size || 28)) + 1} · ${p.w} × ${p.h} tiles</option>`,
      )
      .join("");
    $("#print-part").value = String(Math.min(settings.part, parts.length - 1));
    $("#print-part-label").hidden = !size;
    $("#print-zip").hidden = !size;
  }
  function generate(part) {
    return realm.export_stl_section(
      settings.width / 40,
      settings.base,
      settings.relief,
      settings.trees,
      settings.pins,
      part.x,
      part.y,
      part.w,
      part.h,
    );
  }
  function modelFor(part) {
    return JSON.parse(
      realm.export_print_model_section(
        settings.width / 40,
        settings.base,
        settings.relief,
        settings.trees,
        settings.pins,
        part.x,
        part.y,
        part.w,
        part.h,
      ),
    );
  }
  function package3mf(m) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><metadata name="Title">${esc(world.title)}</metadata><metadata name="Application">DND Campaign Building</metadata><resources><m:colorgroup id="1">${settings.colors.map((color) => `<m:color color="${color.toUpperCase()}FF"/>`).join("")}</m:colorgroup><object id="2" type="model" pid="1" pindex="${baseColorIndex}"><mesh><vertices>${m.vertices.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join("")}</vertices><triangles>${m.faces.map((f, i) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}" pid="1" p1="${m.colors[i]}" p2="${m.colors[i]}" p3="${m.colors[i]}"/>`).join("")}</triangles></mesh></object></resources><build><item objectid="2"/></build></model>`;
    const files = {
      "[Content_Types].xml":
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      "_rels/.rels":
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      "3D/3dmodel.model": xml,
    };
    return zip(
      Object.entries(files).map(([name, text]) => ({
        name,
        data: new TextEncoder().encode(text),
      })),
    );
  }
  function update() {
    if (!active) return;
    $("#print-error").hidden = true;
    $("#print-download").disabled = true;
    $("#print-zip").disabled = true;
    bytes = null;
    const mode = $("#print-scale").value,
      byWidth = mode === "width";
    $("#print-width").disabled = !byWidth;
    $("#print-ratio").disabled = byWidth;
    if (!$("#print-form").checkValidity()) {
      $("#print-error").textContent =
        "Enter valid dimensions to preview or export.";
      $("#print-error").hidden = false;
      return;
    }
    settings.format = $("#print-format").value;
    $("#print-download").textContent =
      settings.format === "3mf" ? "Download color 3MF" : "Download STL";
    settings.scale = mode;
    settings.ratio = Number($("#print-ratio").value);
    settings.width = byWidth
      ? Number($("#print-width").value)
      : (world.width * world.meters_per_tile * 1000) / settings.ratio;
    settings.base = Number($("#print-base").value);
    settings.relief = Number($("#print-relief").value);
    settings.bed = Number($("#print-bed").value);
    settings.trees = $("#print-trees").checked;
    settings.pins = $("#print-pins").checked;
    settings.section = Number($("#print-section").value);
    settings.part = Number($("#print-part").value) || 0;
    if (!byWidth) $("#print-width").value = settings.width.toFixed(2);
    else
      $("#print-ratio").value = (
        (world.width * world.meters_per_tile * 1000) /
        settings.width
      ).toFixed(2);
    current = parts[settings.part];
    try {
      bytes = generate(current);
      model = modelFor(current);
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      let maxZ = 0;
      const triangles = view.getUint32(80, true);
      for (let i = 0; i < triangles; i++)
        for (let v = 0; v < 3; v++)
          maxZ = Math.max(
            maxZ,
            view.getFloat32(84 + i * 50 + 12 + v * 12 + 8, true),
          );
      const w = (current.w * settings.width) / 40,
        h = (current.h * settings.width) / 40,
        ratio = (world.width * world.meters_per_tile * 1000) / settings.width,
        fit = w <= settings.bed && h <= settings.bed;
      $("#print-measurements").innerHTML =
        `<strong>${fmt(w)} × ${fmt(h)} × ${fmt(maxZ)} mm</strong><span>Scale 1:${fmt(ratio)} · ${fmt(settings.width / 40)} mm per tile</span><span>${fit ? "✓ Fits" : "Too large for"} a ${fmt(settings.bed)} × ${fmt(settings.bed)} mm bed${fit ? "" : " — choose smaller sections or reduce the print size"}.</span><span>${parts.length === 1 ? "One solid model" : `Section ${settings.part + 1} of ${parts.length}`} · ${triangles.toLocaleString()} triangles</span>`;
      $("#print-measurements").classList.toggle("over-bed", !fit);
      preview?.update(bytes, model, settings.colors);
      $("#print-download").disabled = false;
      $("#print-zip").disabled = false;
    } catch (e) {
      $("#print-error").textContent =
        String(e?.message || e) +
        " Choose a smaller print size or a larger scale denominator.";
      $("#print-error").hidden = false;
      $("#print-measurements").textContent =
        "Preview is unavailable for these dimensions.";
    }
  }
  $("#print-format").onchange = update;
  dialog.querySelectorAll("[data-print-color]").forEach(
    (input) =>
      (input.oninput = () => {
        settings.colors[Number(input.dataset.printColor)] = input.value;
        if (bytes) preview?.update(bytes, model, settings.colors);
      }),
  );
  buildParts();
  $("#print-scale").onchange = () => {
    const value = $("#print-scale").value;
    if (!["width", "custom"].includes(value)) $("#print-ratio").value = value;
    update();
  };
  $("#print-section").onchange = () => {
    settings.part = 0;
    buildParts();
    update();
  };
  for (const id of [
    "print-width",
    "print-ratio",
    "print-base",
    "print-relief",
    "print-bed",
    "print-trees",
    "print-pins",
    "print-part",
  ])
    $("#" + id).oninput = () => {
      clearTimeout(debounce);
      $("#print-download").disabled = true;
      $("#print-zip").disabled = true;
      debounce = setTimeout(update, 150);
    };
  const prefix = () =>
    `${world.title.replace(/[^a-z0-9_-]/gi, "-") || "world"}-${fmt(settings.width / 40).replace(/,/g, "")}mm-tile`;
  $("#print-download").onclick = () => {
    if (bytes)
      download(
        settings.format === "3mf" ? package3mf(model) : bytes,
        `${prefix()}${parts.length > 1 ? `-col${current.x / settings.section + 1}-row${current.y / settings.section + 1}` : ""}.${settings.format}`,
        settings.format === "3mf" ? "model/3mf" : "model/stl",
      );
  };
  $("#print-zip").onclick = async () => {
    if (!bytes) return;
    $("#print-zip").disabled = true;
    $("#print-zip").textContent = "Preparing sections…";
    $("#print-form").inert = true;
    try {
      const files = [];
      for (const p of parts) {
        if (!active) return;
        files.push({
          name: `${prefix()}-col${p.x / settings.section + 1}-row${p.y / settings.section + 1}.${settings.format}`,
          data:
            settings.format === "3mf"
              ? new Uint8Array(await package3mf(modelFor(p)).arrayBuffer())
              : generate(p),
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!active) return;
      files.push({
        name: "PRINT-README.txt",
        data: new TextEncoder().encode(
          `DND Campaign Building\n${world.title}\nImport STLs in millimetres.\n${settings.width / 40} mm per tile; each tile represents ${world.meters_per_tile} metres.\nAssemble by column (left to right) and row (top to bottom).\nEach section has a flat base; no connectors are added.\nSolid relief: roof/bridge cavities are filled. 3MF retains solid colors; STL contains geometry only. Assign colors in your slicer.\n`,
        ),
      });
      download(zip(files), `${prefix()}-sections.zip`, "application/zip");
    } catch (e) {
      $("#print-error").textContent = String(e);
      $("#print-error").hidden = false;
    } finally {
      if (active) {
        $("#print-form").inert = false;
        $("#print-zip").disabled = false;
        $("#print-zip").textContent = "Download all sections (.zip)";
      }
    }
  };
  update();
  try {
    const { createPrintPreview } = await import("./print-preview.js");
    if (!active) return;
    preview = createPrintPreview($("#print-preview"));
    if (bytes) preview.update(bytes, model, settings.colors);
  } catch {
    if (active)
      $("#print-preview").textContent =
        "3D preview is unavailable in this browser. STL downloads still work.";
  }
}
// Uncompressed ZIP, keeping binary STL bytes intact without a server or dependency.
function zip(files) {
  const chunks = [],
    central = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name),
      data = file.data;
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let k = 0; k < 8; k++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(12, 33, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    chunks.push(header, data);
    const c = new Uint8Array(46 + name.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    offset += header.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end]);
}
