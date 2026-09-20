import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const catalog = JSON.parse(
  readFileSync(new URL("../web/material-catalog.json", import.meta.url)),
);
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
test("every published catalog entry is available with distinct stable IDs and search filters", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  const result = await page.evaluate(async () => {
    const { materials } = await import("/materials.js");
    return {
      count: materials.length,
      keys: materials.filter((m) => m.source === "Blocks").map((m) => m.key),
      ids: materials.map((m) => m.id),
    };
  });
  expect(result.count).toBe(catalog.blocks.length + 24);
  expect(new Set(result.keys)).toEqual(new Set(catalog.current_keys));
  expect(new Set(result.ids).size).toBe(result.count);
  await page
    .getByRole("button", { name: "All materials", exact: true })
    .click();
  await expect(page.locator("body")).not.toContainText(/minecraft/i);
  await expect(page.locator("#catalog-count")).toContainText("1,312");
  await page.locator("#catalog-source").selectOption("Blocks");
  await expect(page.locator("#catalog-count")).toContainText("1,288");
  await page.locator("#catalog-search").fill("diamond_ore");
  await expect(page.locator('[data-block-key="diamond_ore"]')).toBeVisible();
  await page.locator("#catalog-search").fill("wool");
  await page.locator("#catalog-category").selectOption("Colored blocks");
  await expect(page.locator("#catalog-count")).toContainText("48 materials");
  await page.locator("#catalog-search").fill("not a real material");
  await expect(page.locator("#catalog-results")).toContainText(
    "No materials match",
  );
});

test("phone catalog builds a high-ID material, saves it, renders it and exports its print color", async ({
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
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.getByRole("button", { name: "Expand editor", exact: true }).tap();
  await page.getByRole("button", { name: "All materials", exact: true }).tap();
  await page.screenshot({ path: "test-results/phone-material-library.png" });
  await page.locator("#catalog-search").fill("waxed oxidized copper bulb");
  const choice = page.locator('[data-block-key="waxed_oxidized_copper_bulb"]');
  const id = Number(await choice.getAttribute("data-catalog-material"));
  expect(id).toBeGreaterThan(255);
  await choice.tap();
  await page.locator("#map").tap({ position: { x: 150, y: 120 } });
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  expect((await snapshot(page)).blocks[0].material).toBe(id);
  await page.reload();
  await expect(page.locator("#map")).toBeVisible();
  expect((await snapshot(page)).blocks[0].material).toBe(id);
  await page.getByRole("button", { name: "3D world", exact: true }).tap();
  await expect(page.locator("#scene canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "3D print & scale", exact: true })
    .tap();
  await expect(page.locator("#print-preview canvas")).toBeVisible();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download color 3MF", exact: true })
    .tap();
  const d = await wait;
  const result = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import sys,zipfile,xml.etree.ElementTree as E,json
z=zipfile.ZipFile(sys.argv[1]);m=E.fromstring(z.read('3D/3dmodel.model'));ns={'c':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02','m':'http://schemas.microsoft.com/3dmanufacturing/material/2015/02'}
print(json.dumps({'colors':len(m.findall('.//m:color',ns)),'used':sorted(set(int(t.attrib['p1']) for t in m.findall('.//c:triangle',ns)))}))`,
        await d.path(),
      ],
      { encoding: "utf8" },
    ),
  );
  expect(result.colors).toBe(1325);
  expect(result.used).toContain(12 + id);
  expect(result.used).toContain(1324);
  expect(errors).toEqual([]);
  await context.close();
});
