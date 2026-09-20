export const shapeTool = (tool) =>
  tool === "territory-add" || tool === "territory-erase";
export const insideTerritory = (world, x, y) =>
  x >= 0 &&
  y >= 0 &&
  x < world.width &&
  y < world.height &&
  world.territory[y * world.width + x];
export function territoryPreset(world, preset) {
  const island = (x, y, cx, cy, rx, ry, phase = 0) => {
    const dx = (x - cx) / rx,
      dy = (y - cy) / ry,
      a = Math.atan2(dy, dx);
    return (
      Math.hypot(dx, dy) <
      1 + 0.1 * Math.sin(a * 3 + phase) + 0.06 * Math.cos(a * 5 - phase)
    );
  };
  return world.tiles.map((_, i) => {
    const x = i % world.width,
      y = Math.floor(i / world.width);
    if (preset === "rectangle") return true;
    if (preset === "blank") return false;
    if (preset === "coastline") return world.tiles[i] !== 1;
    if (preset === "island") return island(x, y, 19.5, 13.5, 16, 10);
    return (
      island(x, y, 10, 9, 7, 6) ||
      island(x, y, 28, 8, 6, 4, 1) ||
      island(x, y, 25, 21, 8, 4, 2)
    );
  });
}
