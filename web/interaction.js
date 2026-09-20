export const blockKey = (b) => `${b.x},${b.y},${b.z}`;

// Activate editor buttons on touchend, avoiding delayed/suppressed compatibility
// clicks after a drag. A swipe never activates a button or blocks tray scrolling.
export function installTouchButtons() {
  let press;
  const selector =
    ".editor-controls button, .selection-actions button, .material-dock button, .material-choice, .catalog-material, .material-dialog button, .view-switch button";
  document.addEventListener(
    "touchstart",
    (e) => {
      const button = e.target.closest(selector);
      press =
        button && e.touches.length === 1
          ? {
              button,
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
              moved: false,
            }
          : null;
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (
        press &&
        (e.touches.length !== 1 ||
          Math.hypot(
            e.touches[0].clientX - press.x,
            e.touches[0].clientY - press.y,
          ) > 8)
      )
        press.moved = true;
    },
    { passive: true },
  );
  document.addEventListener(
    "touchend",
    (e) => {
      if (!press) return;
      const current = press;
      press = null;
      if (e.cancelable) e.preventDefault();
      if (
        !current.moved &&
        current.button.isConnected &&
        !current.button.disabled
      )
        current.button.click();
    },
    { passive: false },
  );
  document.addEventListener(
    "touchcancel",
    () => {
      press = null;
    },
    { passive: true },
  );
}

export function connectedBlocks(blocks, start) {
  const byKey = new Map(blocks.map((b) => [blockKey(b), b]));
  const found = new Set(),
    pending = [start];
  while (pending.length) {
    const key = pending.pop(),
      b = byKey.get(key);
    if (!b || found.has(key)) continue;
    found.add(key);
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ])
      pending.push(`${b.x + dx},${b.y + dy},${b.z + dz}`);
  }
  return found;
}

// Compute the whole operation before committing: a failed move never removes blocks.
export function planMove(world, keys, dx, dy, dz = 0, copy = false) {
  const selected = world.blocks.filter((b) => keys.has(blockKey(b)));
  const rest = world.blocks.filter((b) => copy || !keys.has(blockKey(b)));
  const occupied = new Set(rest.map(blockKey));
  const moved = selected.map((b) => ({
    ...b,
    x: b.x + dx,
    y: b.y + dy,
    z: b.z + dz,
  }));
  if (!moved.length) return { error: "Select a block first." };
  if (
    moved.some(
      (b) =>
        b.x < 0 ||
        b.x >= 40 ||
        b.y < 0 ||
        b.y >= 28 ||
        b.z < 0 ||
        b.z > 63 ||
        world.territory?.[b.y * 40 + b.x] === false,
    )
  )
    return {
      error: "Keep the selection inside the world and below height 64.",
    };
  if (moved.some((b) => occupied.has(blockKey(b))))
    return { error: "That space is occupied. Move to an empty space." };
  if (rest.length + moved.length > 12000)
    return { error: "The world is limited to 12,000 blocks." };
  return {
    world: { ...world, blocks: [...rest, ...moved] },
    keys: new Set(moved.map(blockKey)),
  };
}

// Horizontal swipes scroll the material tray; vertical drags carry a material to the map.
// Ordinary taps retain the same button behavior on touch and desktop.
export function bindMaterialDrags(buttons) {
  let chip;
  const removers = [];
  const emit = (phase, e, id) =>
    window.dispatchEvent(
      new CustomEvent("world-material-drag", {
        detail: { phase, x: e.clientX, y: e.clientY, id },
      }),
    );
  for (const button of buttons) {
    let start,
      dragging = false,
      suppress = false;
    const id = Number(button.dataset.material ?? button.dataset.hotMaterial);
    button.onpointerdown = (e) => {
      if (e.button !== 0) return;
      start = [e.clientX, e.clientY];
      dragging = false;
      button.setPointerCapture(e.pointerId);
    };
    button.onpointermove = (e) => {
      if (!start) return;
      const dx = e.clientX - start[0],
        dy = e.clientY - start[1];
      if (
        !dragging &&
        Math.hypot(dx, dy) > 9 &&
        (e.pointerType !== "touch" || Math.abs(dy) > Math.abs(dx))
      ) {
        dragging = true;
        chip = document.createElement("div");
        chip.className = "material-drag-chip";
        chip.textContent = button.title || button.textContent;
        document.body.append(chip);
      }
      if (dragging) {
        e.preventDefault();
        chip.style.left = `${e.clientX}px`;
        chip.style.top = `${e.clientY - 45}px`;
        emit("move", e, id);
      }
    };
    button.onpointerup = (e) => {
      if (dragging) {
        suppress = e.pointerType !== "touch";
        setTimeout(() => {
          suppress = false;
        }, 0);
        chip?.remove();
        emit("drop", e, id);
      }
      start = null;
      dragging = false;
    };
    button.onpointercancel = (e) => {
      chip?.remove();
      emit("cancel", e, id);
      start = null;
      dragging = false;
    };
    const click = (e) => {
      if (suppress) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppress = false;
      }
    };
    button.addEventListener("click", click, true);
    removers.push(() => button.removeEventListener("click", click, true));
  }
  return () => {
    chip?.remove();
    removers.forEach((remove) => remove());
  };
}
