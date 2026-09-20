import {
  materials,
  materialCategories,
  catalogCount,
  textureCanvas,
} from "./materials.js";

export function openMaterialPicker(onChoose, initial = "") {
  const dialog = document.createElement("dialog");
  dialog.className = "material-dialog";
  dialog.innerHTML = `<div class="ddb-heading"><div><div class="kicker">BUILD WITH ANY MATERIAL</div><h2>All materials</h2></div><button aria-label="Close material library">×</button></div><p>Block collection: ${catalogCount.toLocaleString()} block entries, plus 24 original materials.</p><div class="material-filters"><label>Search all materials<input id="catalog-search" type="search" placeholder="Diamond ore, cherry, red wool…"></label><label>Category<select id="catalog-category"><option value="">All categories</option></select></label><label>Collection<select id="catalog-source"><option value="">All materials</option><option>Blocks</option><option>Original</option></select></label></div><p id="catalog-count" role="status"></p><div id="catalog-results" class="catalog-results"></div><div class="catalog-pages"><button id="catalog-prev">Previous</button><span id="catalog-page"></span><button id="catalog-next">Next</button></div><p class="hint">Choose a material, then click or tap the world to build. Each entry uses an original procedural texture and a block shape; game-specific shapes and mechanics are not simulated. Print exports use solid colors.</p>`;
  document.body.append(dialog);
  dialog.showModal();
  const $ = (q) => dialog.querySelector(q);
  for (const category of materialCategories) {
    const o = document.createElement("option");
    o.textContent = category;
    $("#catalog-category").append(o);
  }
  $("#catalog-search").value = initial;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector('[aria-label="Close material library"]').onclick = close;
  dialog.oncancel = (e) => {
    e.preventDefault();
    close();
  };
  let page = 0;
  const pageSize = 48;
  // Familiar blocks first; every remaining entry is still searchable and paginated.
  const featured = [
    "grass_block",
    "stone",
    "cobblestone",
    "oak_planks",
    "oak_log",
    "glass",
    "diamond_ore",
    "iron_ore",
    "gold_block",
    "red_wool",
    "redstone_block",
    "cherry_planks",
    "moss_block",
    "obsidian",
    "glowstone",
    "sand",
    "water",
    "lava",
  ];
  const ordered = [...materials].sort((a, b) => {
    const ai = featured.indexOf(a.key),
      bi = featured.indexOf(b.key);
    if (ai >= 0 || bi >= 0)
      return (ai < 0 ? 10000 : ai) - (bi < 0 ? 10000 : bi);
    return a.name.localeCompare(b.name) || a.id - b.id;
  });
  function draw() {
    const query = $("#catalog-search")
        .value.trim()
        .toLowerCase()
        .replace(/[_:]/g, " "),
      category = $("#catalog-category").value,
      source = $("#catalog-source").value;
    const matches = ordered.filter(
      (m) =>
        (!category || m.category === category) &&
        (!source || m.source === source) &&
        query
          .split(/\s+/)
          .every((term) =>
            `${m.name} ${m.key || ""} ${m.category} ${m.source}`
              .toLowerCase()
              .replace(/[_:]/g, " ")
              .includes(term),
          ),
    );
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(page, pages - 1);
    $("#catalog-count").textContent =
      `${matches.length.toLocaleString()} materials found`;
    $("#catalog-results").replaceChildren();
    for (const m of matches.slice(page * pageSize, (page + 1) * pageSize)) {
      const b = document.createElement("button");
      b.className = "catalog-material";
      b.dataset.catalogMaterial = m.id;
      b.dataset.blockKey = m.key || "";
      b.title = m.key ? m.key : m.name;
      b.setAttribute("aria-label", `${m.name} · ${m.source}`);
      const swatch = textureCanvas(m);
      swatch.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      name.textContent = m.name;
      const category = document.createElement("small");
      category.textContent = m.category;
      b.append(swatch, name, category);
      b.onclick = () => {
        close();
        onChoose(m.id);
      };
      $("#catalog-results").append(b);
    }
    if (!matches.length)
      $("#catalog-results").textContent =
        "No materials match. Try another name or category.";
    $("#catalog-page").textContent = `Page ${page + 1} of ${pages}`;
    $("#catalog-prev").disabled = page === 0;
    $("#catalog-next").disabled = page === pages - 1;
  }
  for (const id of ["catalog-search", "catalog-category", "catalog-source"])
    $("#" + id).oninput = () => {
      page = 0;
      draw();
    };
  $("#catalog-prev").onclick = () => {
    page--;
    draw();
    dialog.scrollTop = 0;
  };
  $("#catalog-next").onclick = () => {
    page++;
    draw();
    dialog.scrollTop = 0;
  };
  draw();
}
