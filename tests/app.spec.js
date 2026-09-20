import { test, expect } from "@playwright/test";
async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#save-status")).toContainText("Saved");
}
test("characters and notebook survive reload; backup is validated and restored", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await page.getByRole("button", { name: "+ New character" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ari <the brave>");
  await page.locator('[name="ability-0"]').fill("9");
  await expect(page.locator("#mod-0")).toHaveText("-1");
  await page
    .getByLabel("Backstory & features")
    .fill("A ranger from the northern woods.");
  await page.getByRole("button", { name: "World notebook" }).click();
  await page.getByLabel("Realm name").fill("The Amber Isles");
  await page
    .getByLabel("Campaign notebook")
    .fill("The lantern guild guards the old harbor.");
  await expect(page.locator("#save-status")).toContainText("Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const file = await download;
  const path = await file.path();
  await page.reload();
  await expect(page.locator(".map-bar")).toContainText("The Amber Isles");
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ari <the brave>",
  );
  await expect(page.getByLabel("Backstory & features")).toHaveValue(
    "A ranger from the northern woods.",
  );
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });
  await expect(page.locator("#notice")).toContainText("Import failed");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ari <the brave>",
  );
  await page.getByLabel("Name", { exact: true }).fill("Changed");
  await page.locator("#import-file").setInputFiles(path);
  await page.locator("#confirm-yes").click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ari <the brave>",
  );
  expect(errors).toEqual([]);
});
test("2D painting, undo, location and 3D view work", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await page.locator('[data-terrain="5"]').click();
  const map = page.locator("#map");
  await map.click({ position: { x: 30, y: 30 } });
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "Redo", exact: false }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Redo", exact: false }).click();
  await page.getByRole("button", { name: "Place location" }).click();
  await page.locator("#map").click({ position: { x: 120, y: 100 } });
  await page.locator("#pin-name").fill("Lantern Harbor");
  await page.locator("#pin-name").press("Tab");
  await expect(page.locator(".pin-item")).toContainText("Lantern Harbor");
  await page.getByRole("button", { name: "3D world" }).click();
  await expect(page.locator("#scene canvas")).toBeVisible();
  await page.getByRole("button", { name: "Enable terrain painting" }).click();
  await page.locator("#scene canvas").click({ position: { x: 300, y: 260 } });
  await expect(page.locator("#save-status")).toContainText("Saved");
  await page.screenshot({ path: "test-results/world-3d.png" });
  await page.getByRole("button", { name: "2D map" }).click();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".pin-item")).toContainText("Lantern Harbor");
  await page.screenshot({ path: "test-results/world-2d.png" });
  expect(errors).toEqual([]);
});
test("a second tab cannot overwrite the active workspace", async ({
  page,
  context,
}) => {
  await ready(page);
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator("#app")).toContainText(
    "already open in another tab",
  );
});
test("mobile layout stays within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/mobile.png" });
});

test("save failures stay visible and do not break backup export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
  });
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#save-status")).toContainText("Save failed");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  expect((await download).suggestedFilename()).toContain(".realm.json");
});

test("invalid character edits are not reported as saved", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await page.getByRole("button", { name: "+ New character" }).click();
  await page.getByLabel("Level", { exact: true }).fill("99");
  await expect(page.locator("#save-status")).toContainText("not saved");
  await page.getByRole("button", { name: "World atlas" }).click();
  await expect(page.locator("#character-form")).toBeVisible();
  await page.getByLabel("Level", { exact: true }).fill("3");
  await expect(page.locator("#save-status")).toContainText("Saved");
});
