import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
async function tile(page, x, y) {
  const r = await page.locator("#map").boundingBox();
  return {
    x: r.x + ((x + 0.5) * r.width) / 40,
    y: r.y + ((y + 0.5) * r.height) / 28,
  };
}

test("freehand territory survives undo, reload and backup with a shaped STL", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.locator("#territory-preset").selectOption("blank");
  await expect
    .poll(async () => (await snapshot(page)).territory.filter(Boolean).length)
    .toBe(0);
  await page.locator("#brush-size").selectOption("5");
  const a = await tile(page, 10, 10),
    b = await tile(page, 20, 10);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 2 });
  await page.mouse.up();
  await expect
    .poll(async () => (await snapshot(page)).territory.filter(Boolean).length)
    .toBeGreaterThan(50);
  const shape = (await snapshot(page)).territory;
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  await expect
    .poll(async () => (await snapshot(page)).territory.filter(Boolean).length)
    .toBe(0);
  await page.getByRole("button", { name: "Redo", exact: false }).click();
  await expect
    .poll(async () => (await snapshot(page)).territory)
    .toEqual(shape);
  const backupWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const backup = await (await backupWait).path();
  await page.reload();
  await expect(page.locator("#map")).toBeVisible();
  expect((await snapshot(page)).territory).toEqual(shape);
  await page.locator("#territory-preset").selectOption("rectangle");
  await page.locator("#import-file").setInputFiles(backup);
  await page.locator("#confirm-yes").click();
  await expect
    .poll(async () => (await snapshot(page)).territory)
    .toEqual(shape);
  await page.getByRole("button", { name: "3D world", exact: true }).click();
  await expect(page.locator("#scene canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/territory-3d.png" });
  await page
    .getByRole("button", { name: "3D print & scale", exact: true })
    .click();
  await page.locator("#print-width").fill("180");
  await page.locator("#print-format").selectOption("stl");
  await expect(page.locator("#print-download")).toBeEnabled();
  await expect(page.locator("#print-measurements")).toContainText(
    "67.5 × 22.5",
  );
  const wait = page.waitForEvent("download");
  await page.locator("#print-download").click();
  const bytes = await readFile(await (await wait).path());
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
  await page.screenshot({ path: "test-results/territory-print.png" });
  expect(errors).toEqual([]);
});

test("island chains export only occupied sections and blank territory cannot export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.locator("#territory-preset").selectOption("archipelago");
  const count = (await snapshot(page)).territory.filter(Boolean).length;
  expect(count).toBeGreaterThan(100);
  expect(count).toBeLessThan(650);
  await page.locator("#print-world").click();
  await page.locator("#print-section").selectOption("8");
  await expect(page.locator("#print-download")).toBeEnabled();
  expect(await page.locator("#print-part option").count()).toBeLessThan(20);
  const wait = page.waitForEvent("download");
  await page.locator("#print-zip").click();
  expect((await wait).suggestedFilename()).toContain("sections.zip");
  await page.locator("#print-close").click();
  await page.locator("#territory-preset").selectOption("blank");
  await page.locator("#print-world").click();
  await expect(page.locator("#print-error")).toContainText("territory");
  await expect(page.locator("#print-download")).toBeDisabled();
});

test("phone territory tools draw and erase without deleting saved blocks", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:4173",
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.locator("#territory-preset").selectOption("blank");
  await page.locator("#brush-size").selectOption("3");
  await page.getByRole("button", { name: "Draw territory", exact: true }).tap();
  await page.locator("#map").tap({ position: { x: 100, y: 100 } });
  await expect
    .poll(async () => (await snapshot(page)).territory.filter(Boolean).length)
    .toBe(9);
  await page.getByRole("button", { name: "＋ Build", exact: true }).tap();
  await page.locator("#map").tap({ position: { x: 100, y: 100 } });
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  await page
    .getByRole("button", { name: "Erase territory", exact: true })
    .tap();
  await page.locator("#map").tap({ position: { x: 100, y: 100 } });
  await expect
    .poll(async () => (await snapshot(page)).territory.filter(Boolean).length)
    .toBe(0);
  expect((await snapshot(page)).blocks.length).toBe(1);
  await page.getByRole("button", { name: "Draw territory", exact: true }).tap();
  await page.locator("#map").tap({ position: { x: 100, y: 100 } });
  await expect
    .poll(async () => (await snapshot(page)).territory.filter(Boolean).length)
    .toBe(9);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
