import { test, expect } from "@playwright/test";
async function snapshot(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const q = indexedDB.open("realm-forge-v1");
        q.onsuccess = () => {
          const db = q.result,
            r = db
              .transaction("projects")
              .objectStore("projects")
              .get("current");
          r.onsuccess = () => {
            resolve(JSON.parse(r.result));
            db.close();
          };
        };
      }),
  );
}
async function load(page, blocks) {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  const world = await snapshot(page);
  world.blocks = blocks;
  world.tiles.fill(0);
  world.elevations.fill(0);
  await page.locator("#import-file").setInputFiles({
    name: "touch-world.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(world)),
  });
  await page.locator("#confirm-yes").click();
  await expect.poll(async () => (await snapshot(page)).blocks).toEqual(blocks);
}
async function point2d(page, x, y) {
  await page.locator("#map").scrollIntoViewIfNeeded();
  const r = await page.locator("#map").boundingBox();
  return {
    x: r.x + ((x + 0.5) * r.width) / 40,
    y: r.y + ((y + 0.5) * r.height) / 28,
  };
}
async function mouseDrag(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}
async function touchDrag(page, a, b) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: a.x, y: a.y }],
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
test("select and drag connected blocks, reject collisions, undo, delete and persist", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await load(page, [
    { x: 10, y: 10, z: 1, material: 2 },
    { x: 10, y: 10, z: 2, material: 1 },
    { x: 15, y: 10, z: 1, material: 3 },
  ]);
  await page.getByRole("button", { name: "Select & move" }).click();
  const start = await point2d(page, 10, 10);
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#selection-label")).toHaveText("1 block selected");
  await page
    .getByRole("button", { name: "Select structure", exact: true })
    .click();
  await expect(page.locator("#selection-label")).toHaveText(
    "2 blocks selected",
  );
  await mouseDrag(
    page,
    await point2d(page, 10, 10),
    await point2d(page, 12, 11),
  );
  await expect
    .poll(
      async () =>
        (await snapshot(page)).blocks.filter((b) => b.x === 12 && b.y === 11)
          .length,
    )
    .toBe(2);
  await mouseDrag(
    page,
    await point2d(page, 12, 11),
    await point2d(page, 15, 10),
  );
  await expect(page.locator("#notice")).toContainText("occupied");
  expect((await snapshot(page)).blocks.filter((b) => b.x === 12).length).toBe(
    2,
  );
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).blocks.filter((b) => b.x === 10).length,
    )
    .toBe(2);
  await page.getByRole("button", { name: "Redo", exact: false }).click();
  const moved = await point2d(page, 12, 11);
  await page.mouse.click(moved.x, moved.y);
  await page
    .getByRole("button", { name: "Select structure", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  await page.reload();
  await expect(page.locator("#block-count")).toContainText("1 /");
  expect(errors).toEqual([]);
});

test("drag a material from the tray into the world", async ({ page }) => {
  await load(page, []);
  const material = page.getByRole("button", {
    name: "Build with Brick",
    exact: true,
  });
  await material.scrollIntoViewIfNeeded();
  const r = await material.boundingBox();
  // The map and its tray fit together in expanded view.
  await page
    .getByRole("button", { name: "Expand editor", exact: true })
    .click();
  const from = await material.boundingBox(),
    to = await point2d(page, 20, 12);
  await mouseDrag(
    page,
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    to,
  );
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  expect((await snapshot(page)).blocks[0]).toMatchObject({
    x: 20,
    y: 12,
    material: 2,
  });
});

test("phone touch controls build, drag, select structure, zoom and delete without overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:4173",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await load(page, [
    { x: 12, y: 9, z: 1, material: 2 },
    { x: 12, y: 9, z: 2, material: 1 },
  ]);
  await page.getByRole("button", { name: "Expand editor", exact: true }).tap();
  await page.getByRole("button", { name: "Select & move" }).tap();
  await touchDrag(
    page,
    await point2d(page, 12, 9),
    await point2d(page, 16, 11),
  );
  await expect
    .poll(async () =>
      (await snapshot(page)).blocks.some((b) => b.x === 16 && b.y === 11),
    )
    .toBe(true);
  await expect(page.locator("#selection-label")).toHaveText("1 block selected");
  await page
    .getByRole("button", { name: "Raise selected blocks", exact: true })
    .tap();
  await expect
    .poll(async () => (await snapshot(page)).blocks.find((b) => b.x === 16).z)
    .toBe(3);
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .tap();
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  await page
    .getByRole("button", { name: "Build with Stone", exact: true })
    .tap();
  const target = await point2d(page, 20, 12);
  await page.touchscreen.tap(target.x, target.y);
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/phone-interactive-editor.png" });
  await page.getByRole("button", { name: "Zoom map in", exact: true }).tap();
  await page.getByRole("button", { name: "Pan / orbit", exact: false }).tap();
  await expect(page.locator("#map")).toHaveCSS("touch-action", "pan-x pan-y");
  await page
    .getByRole("button", { name: "Close expanded view", exact: true })
    .tap();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
  await context.close();
});

async function point3d(page, x, y, z) {
  return page.evaluate(
    async ({ x, y, z }) => {
      const THREE = await import("/vendor/three.module.js"),
        r = document.querySelector("#scene canvas").getBoundingClientRect();
      const c = new THREE.PerspectiveCamera(45, r.width / r.height, 0.1, 300);
      c.position.set(32, 35, 38);
      c.lookAt(0, 0, 0);
      c.updateMatrixWorld();
      const v = new THREE.Vector3(x - 19.5, z + 0.5, y - 13.5).project(c);
      return {
        x: r.left + ((v.x + 1) * r.width) / 2,
        y: r.top + ((1 - v.y) * r.height) / 2,
      };
    },
    { x, y, z },
  );
}
test("3D selection drags on its height plane and retains the selected material", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await load(page, [{ x: 20, y: 14, z: 3, material: 3 }]);
  await page.getByRole("button", { name: "3D world" }).click();
  await page.getByRole("button", { name: "Select & move" }).click();
  await expect(page.locator("#scene canvas")).toBeVisible();
  await page.locator("#scene canvas").scrollIntoViewIfNeeded();
  await mouseDrag(
    page,
    await point3d(page, 20, 14, 3),
    await point3d(page, 23, 14, 3),
  );
  await expect.poll(async () => (await snapshot(page)).blocks[0].x).toBe(23);
  expect((await snapshot(page)).blocks[0]).toMatchObject({
    y: 14,
    z: 3,
    material: 3,
  });
  await page
    .getByRole("button", { name: "Raise selected blocks", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).blocks[0].z).toBe(4);
  await page.screenshot({ path: "test-results/interactive-3d.png" });
  expect(errors).toEqual([]);
});

test("phone can drag a tray material into the expanded world and move a 3D block by touch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:4173",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await load(page, []);
  await page.getByRole("button", { name: "Expand editor", exact: true }).tap();
  const material = page.getByRole("button", {
    name: "Build with Brick",
    exact: true,
  });
  await material.scrollIntoViewIfNeeded();
  const from = await material.boundingBox();
  await touchDrag(
    page,
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    await point2d(page, 20, 14),
  );
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  expect((await snapshot(page)).blocks[0].material).toBe(2);
  await page
    .getByRole("button", { name: "Close expanded view", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "Expand editor", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "3D world", exact: true }).tap();
  await page.getByRole("button", { name: "Select & move" }).tap();
  await page.getByRole("button", { name: "Expand editor", exact: true }).tap();
  await expect(page.locator("#scene canvas")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await touchDrag(
    page,
    await point3d(page, 20, 14, 0),
    await point3d(page, 23, 14, 0),
  );
  await expect.poll(async () => (await snapshot(page)).blocks[0].x).toBe(23);
  expect((await snapshot(page)).blocks[0].y).toBe(14);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/phone-interactive-3d.png" });
  expect(errors).toEqual([]);
  await context.close();
});

test("desktop area selection, keyboard nudging, Alt-drag copy and undo shortcuts", async ({
  page,
}) => {
  await load(page, [
    { x: 8, y: 8, z: 1, material: 1 },
    { x: 9, y: 8, z: 1, material: 2 },
    { x: 20, y: 15, z: 1, material: 3 },
  ]);
  await page.getByRole("button", { name: "Select & move" }).click();
  await mouseDrag(page, await point2d(page, 6, 6), await point2d(page, 11, 10));
  await expect(page.locator("#selection-label")).toHaveText(
    "2 blocks selected",
  );
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(
      async () => (await snapshot(page)).blocks.filter((b) => b.y === 9).length,
    )
    .toBe(2);
  await page.keyboard.down("Alt");
  await mouseDrag(page, await point2d(page, 8, 9), await point2d(page, 12, 9));
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(5);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(3);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(5);
  const first = await point2d(page, 12, 9),
    second = await point2d(page, 13, 9);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("#selection-label")).toHaveText(
    "2 blocks selected",
  );
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(3);
});
