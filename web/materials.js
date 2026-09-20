export const terrains = [
  ["Meadow", "#91aa73", 0.6, "grass"],
  ["Water", "#679da5", 0.18, "water"],
  ["Forest", "#426e51", 0.9, "grass"],
  ["Mountain", "#929084", 2.8, "stone"],
  ["Sand", "#d8c08a", 0.35, "grain"],
  ["Road", "#b39578", 0.5, "brick"],
  ["Mud", "#71624b", 0.4, "grain"],
  ["Snow", "#e1e7e4", 0.65, "grain"],
  ["Ice", "#9bd3dc", 0.3, "glass"],
  ["Lava", "#d66834", 0.2, "lava"],
  ["Cobblestone", "#858580", 0.6, "stone"],
  ["Farmland", "#816648", 0.5, "wood"],
].map(([name, color, height, texture], id) => ({
  id,
  name,
  color,
  height,
  texture,
}));
export const materials = [
  ["Stone", "#858d90", "stone", "Natural"],
  ["Timber", "#96734d", "wood", "Wood"],
  ["Brick", "#aa674f", "brick", "Building"],
  ["Glass", "#87cbd0", "glass", "Building"],
  ["Slate roof", "#53485e", "brick", "Building"],
  ["Limestone", "#c7b891", "stone", "Building"],
  ["Moss", "#556e44", "grass", "Natural"],
  ["Snow", "#e3e7df", "grain", "Natural"],
  ["Sandstone", "#cfb57d", "brick", "Building"],
  ["Dirt", "#836042", "grain", "Natural"],
  ["Grass", "#7b9e52", "grass", "Natural"],
  ["Water", "#558fae", "water", "Natural"],
  ["Log", "#675039", "wood", "Wood"],
  ["Dark planks", "#59463d", "wood", "Wood"],
  ["Oak planks", "#bd965b", "wood", "Wood"],
  ["Marble", "#d5d5cb", "stone", "Building"],
  ["Iron", "#9aabb5", "metal", "Building"],
  ["Gold", "#d6ab4f", "metal", "Building"],
  ["Crystal", "#b898cf", "glass", "Fantasy"],
  ["Obsidian", "#383547", "stone", "Fantasy"],
  ["Glowstone", "#edcf75", "lava", "Fantasy"],
  ["Basalt", "#535b60", "stone", "Natural"],
  ["Clay", "#b77e62", "grain", "Natural"],
  ["Gravel", "#a69f91", "stone", "Natural"],
].map(([name, color, texture, category], id) => ({
  id,
  name,
  color,
  texture,
  category,
}));
export const printColors = [
  ...terrains,
  ...materials,
  { name: "Base", color: "#b4a587" },
].map((v) => v.color);
export function textureCanvas(material) {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  ctx.fillStyle = material.color;
  ctx.fillRect(0, 0, 32, 32);
  let seed = material.id + 137;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 85; i++) {
    ctx.fillStyle = random() > 0.5 ? "#ffffff16" : "#00000013";
    ctx.fillRect(
      Math.floor(random() * 16) * 2,
      Math.floor(random() * 16) * 2,
      2 + Math.floor(random() * 3),
      2,
    );
  }
  const kind = material.texture;
  ctx.strokeStyle = "#00000040";
  ctx.lineWidth = 1;
  if (kind === "brick") {
    for (let y = 0; y < 32; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(32, y);
      ctx.stroke();
      for (let x = y % 16 ? 8 : 0; x < 32; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 8);
        ctx.stroke();
      }
    }
  }
  if (kind === "wood") {
    for (let y = 3; y < 32; y += 7) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(32, y);
      ctx.stroke();
      ctx.fillStyle = "#ffffff18";
      ctx.fillRect(2, y + 2, 21, 1);
    }
  }
  if (kind === "stone") {
    for (let y = 0; y < 32; y += 8)
      for (let x = 0; x < 32; x += 8) {
        ctx.strokeRect(x + (y % 16 ? 2 : 0), y, 7, 7);
      }
  }
  if (kind === "glass" || kind === "metal") {
    ctx.strokeStyle = "#ffffff70";
    ctx.strokeRect(1, 1, 30, 30);
    ctx.beginPath();
    ctx.moveTo(5, 22);
    ctx.lineTo(22, 5);
    ctx.moveTo(11, 25);
    ctx.lineTo(25, 11);
    ctx.stroke();
  }
  if (kind === "water" || kind === "lava") {
    ctx.strokeStyle = kind === "lava" ? "#ffdf6988" : "#d4f4ff77";
    for (let y = 4; y < 32; y += 9) {
      ctx.beginPath();
      ctx.moveTo(y % 8, y);
      ctx.lineTo(16, y + 2);
      ctx.lineTo(29, y);
      ctx.stroke();
    }
  }
  return c;
}
export function groundHeight(world, x, y) {
  return (
    terrains[world.tiles[y * 40 + x]].height + world.elevations[y * 40 + x]
  );
}
export function stampStructure(world, x, y, type, material) {
  const width = type === "cottage" ? 5 : type === "tower" ? 4 : 7,
    depth = type === "wall" ? 1 : width;
  if (x + width > 40 || y + depth > 28)
    throw new Error("Move the structure away from the edge of the map.");
  let floor = 0;
  for (let yy = y; yy < y + depth; yy++)
    for (let xx = x; xx < x + width; xx++)
      floor = Math.max(floor, Math.floor(groundHeight(world, xx, yy)));
  const blocks = new Map(world.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b]));
  const put = (xx, yy, z, m = material) =>
    blocks.set(`${xx},${yy},${z}`, { x: xx, y: yy, z, material: m });
  for (let yy = y; yy < y + depth; yy++)
    for (let xx = x; xx < x + width; xx++)
      for (let z = Math.floor(groundHeight(world, xx, yy)); z <= floor; z++)
        put(xx, yy, z, 0);
  const high = type === "tower" ? 7 : 3;
  for (let yy = y; yy < y + depth; yy++)
    for (let xx = x; xx < x + width; xx++)
      for (let z = 1; z <= high; z++) {
        if (
          type === "wall" ||
          xx === x ||
          xx === x + width - 1 ||
          yy === y ||
          yy === y + depth - 1
        ) {
          const door = xx === x + Math.floor(width / 2) && yy === y && z <= 2;
          if (!door) put(xx, yy, floor + z);
        }
      }
  if (type === "cottage") {
    for (let yy = y; yy < y + depth; yy++)
      for (let xx = x; xx < x + width; xx++)
        put(xx, yy, floor + 4 + Math.min(xx - x, x + width - 1 - xx), 4);
  }
  if (type === "tower") {
    for (let yy = y; yy < y + depth; yy++)
      for (let xx = x; xx < x + width; xx++) {
        put(xx, yy, floor + high, 0);
        if (
          (xx === x || xx === x + width - 1) &&
          (yy === y || yy === y + depth - 1)
        )
          put(xx, yy, floor + high + 1, 0);
      }
  }
  world.blocks = [...blocks.values()];
  return world;
}
