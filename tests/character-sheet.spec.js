import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

async function create(page) {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await page.getByRole("button", { name: "+ New character" }).click();
}
test("filled sheet calculates training, saves edits, restores backup and exports a multipage PDF", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page);
  await page.getByLabel("Name", { exact: true }).fill("Éowyn Nightfall");
  await page.getByLabel("Level", { exact: true }).fill("5");
  await page.locator('[name="ability-1"]').fill("18");
  await page.getByLabel("Armor Class", { exact: true }).fill("17");
  await page.getByLabel("Speed", { exact: true }).fill("35 ft.");
  await page.getByLabel("Current HP", { exact: true }).fill("23");
  await page
    .getByLabel("Stealth proficiency", { exact: true })
    .selectOption("2");
  await page.getByLabel("Dexterity save proficiency", { exact: true }).check();
  await page
    .getByLabel("Spellcasting ability", { exact: true })
    .selectOption("1");
  await page.getByLabel("Level 1 spell slots total", { exact: true }).fill("4");
  await page.getByLabel("Level 1 spell slots used", { exact: true }).fill("1");
  await page.getByLabel("Gold", { exact: true }).fill("123");
  await page.getByLabel("Temporary HP", { exact: true }).fill("");
  await page
    .getByLabel("Features & traits", { exact: true })
    .fill(
      "Moon ward — protection against shadows.\n".repeat(140) +
        "END OF FEATURES",
    );
  const preview = page.locator("#character-sheet-preview");
  await expect(
    preview.locator(".sheet-row").filter({ hasText: "Stealth" }),
  ).toContainText("+10");
  await expect(
    preview.locator(".sheet-row").filter({ hasText: "Dexterity" }),
  ).toContainText("+7");
  await expect(preview).toContainText("3 / 4");
  await expect(page.locator("#save-status")).toContainText("Saved");
  const backupWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const backup = await (await backupWait).path();
  const saved = JSON.parse(await readFile(backup, "utf8"));
  expect(saved.characters[0].sheet.currency[3]).toBe(123);
  await page.reload();
  await expect(page.locator("#map")).toBeVisible();
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await expect(page.getByLabel("Armor Class", { exact: true })).toHaveValue(
    "17",
  );
  await expect(
    page.getByLabel("Stealth proficiency", { exact: true }),
  ).toHaveValue("2");
  await page.getByLabel("Armor Class", { exact: true }).fill("12");
  await page.locator("#import-file").setInputFiles(backup);
  await page.locator("#confirm-yes").click();
  await expect(page.getByLabel("Armor Class", { exact: true })).toHaveValue(
    "17",
  );
  const pdfWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download character PDF" }).click();
  const download = await pdfWait;
  expect(download.suggestedFilename()).toBe("Éowyn Nightfall-sheet.pdf");
  const bytes = await readFile(await download.path());
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(3);
  expect(pdf.getTitle()).toContain("Éowyn");
  await download.saveAs("test-results/character-sheet.pdf");
  await page
    .locator("#character-sheet-preview")
    .screenshot({ path: "test-results/character-sheet.png" });
  expect(errors).toEqual([]);
});
test("phone character sheet and editor fit the viewport", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: "http://127.0.0.1:4173",
  });
  const page = await context.newPage();
  await create(page);
  await page.getByLabel("Name", { exact: true }).fill("Raven");
  await page
    .getByLabel("Features & traits", { exact: true })
    .fill("<img src=x onerror=alert(1)>");
  await page.locator("#character-sheet-preview").scrollIntoViewIfNeeded();
  await expect(page.locator("#character-sheet-preview img")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/phone-character-sheet.png" });
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download character PDF" }).tap();
  expect((await wait).suggestedFilename()).toBe("Raven-sheet.pdf");
  await context.close();
});
