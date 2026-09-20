import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/ddb-character.json", import.meta.url),
    "utf8",
  ),
);
async function openImport(page) {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await page
    .getByRole("button", { name: "Import D&D Beyond", exact: true })
    .click();
}
async function loadFile(page, value = fixture) {
  await page.locator("#ddb-file").setInputFiles({
    name: "character.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}

test("preview, correct, append, reload and back up a DDB character without replacing world", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openImport(page);
  await loadFile(page);
  await expect(page.locator("#ddb-review-form")).toBeVisible();
  await expect(page.locator("#character-count")).toHaveText("0");
  await expect(page.locator('#ddb-review-form [name="ability-3"]')).toHaveValue(
    "16",
  );
  await expect(page.getByLabel("Maximum HP")).toHaveValue("20");
  await page.getByLabel("Maximum HP").fill("24");
  await page.getByRole("button", { name: "Add character to realm" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ari <the brave>",
  );
  await expect(page.getByLabel("Hit points", { exact: true })).toHaveValue(
    "24",
  );
  await expect(page.getByLabel("Inventory & equipment")).toContainText("");
  await expect(page.getByLabel("Inventory & equipment")).toHaveValue(
    /3 × Torch/,
  );
  await expect(page.getByLabel("Spells & abilities")).toHaveValue(
    /Magic Missile/,
  );
  await expect(page.getByLabel("Backstory & features")).toHaveValue(
    /Background: Sage/,
  );
  await expect(page.locator(".import-source")).toContainText("one-time copy");
  const sourceDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original JSON" }).click();
  const source = JSON.parse(
    await readFile(await (await sourceDownload).path(), "utf8"),
  );
  expect(source.customFutureField.preserve).toContain("unsupported");
  await expect(page.locator("#save-status")).toContainText("Saved");
  await page.reload();
  await expect(page.locator(".map-bar")).toContainText("My first realm");
  await page.getByRole("button", { name: "Characters", exact: false }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ari <the brave>",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const backup = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  expect(backup.tiles).toHaveLength(1120);
  expect(backup.characters[0].source.id).toBe(123456789);
  expect(backup.characters[0].hp).toBe(24);
  expect(errors).toEqual([]);
});

test("duplicate imports require a choice and replacing preserves other characters", async ({
  page,
}) => {
  await openImport(page);
  await loadFile(page);
  await page.getByRole("button", { name: "Add character to realm" }).click();
  await page.getByRole("button", { name: "+ New character" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Local hero");
  await page
    .getByRole("button", { name: "Import D&D Beyond", exact: true })
    .click();
  await loadFile(page);
  await expect(page.locator("#ddb-duplicate")).toHaveValue("copy");
  await page.locator("#ddb-duplicate").selectOption("replace");
  await page.getByLabel("Character name", { exact: true }).fill("Updated Ari");
  await page
    .getByRole("button", { name: "Replace existing character" })
    .click();
  await expect(page.locator("#character-count")).toHaveText("2");
  await expect(page.locator(".character-list")).toContainText("Local hero");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Updated Ari",
  );
});

test("cancel and invalid files leave the realm untouched", async ({ page }) => {
  await openImport(page);
  await loadFile(page, { version: 1 });
  await expect(page.locator("#ddb-error")).toBeVisible();
  await expect(page.locator("#ddb-add")).toHaveCount(0);
  await loadFile(page);
  await page.getByRole("button", { name: "Close character import" }).click();
  await expect(page.locator("#character-count")).toHaveText("0");
});

test("public-link import uses only the DDB endpoint without credentials", async ({
  page,
}) => {
  await page.route(
    "https://character-service.dndbeyond.com/**",
    async (route) => {
      expect(route.request().url()).toBe(
        "https://character-service.dndbeyond.com/character/v5/character/123456789",
      );
      expect(route.request().headers().cookie).toBeUndefined();
      await route.fulfill({
        json: fixture,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await openImport(page);
  await page
    .getByLabel("D&D Beyond character link or ID")
    .fill("https://www.dndbeyond.com/characters/123456789");
  await page
    .getByRole("button", { name: "Load character", exact: true })
    .click();
  await expect(page.locator("#ddb-review-form")).toBeVisible();
});

test("blocked network shows file fallback; arbitrary URLs are rejected", async ({
  page,
}) => {
  await page.route("https://character-service.dndbeyond.com/**", (r) =>
    r.abort("blockedbyclient"),
  );
  await openImport(page);
  await page
    .getByLabel("D&D Beyond character link or ID")
    .fill("https://evil.example/characters/123456789");
  await page
    .getByRole("button", { name: "Load character", exact: true })
    .click();
  await expect(page.locator("#ddb-error")).toContainText(
    "Use an https://www.dndbeyond.com",
  );
  await expect(page.locator("#ddb-data")).toBeHidden();
  await page.getByLabel("D&D Beyond character link or ID").fill("123456789");
  await page
    .getByRole("button", { name: "Load character", exact: true })
    .click();
  await expect(page.locator("#ddb-error")).toContainText("save the JSON");
  await expect(page.locator("#ddb-data")).toHaveAttribute(
    "href",
    "https://character-service.dndbeyond.com/character/v5/character/123456789",
  );
  await loadFile(page);
  await expect(page.locator("#ddb-review-form")).toBeVisible();
});

test("invalid review can be corrected without trapping the editor", async ({
  page,
}) => {
  await openImport(page);
  await loadFile(page);
  await page.getByLabel("Character name", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Add character to realm" }).click();
  await expect(page.locator("#ddb-error")).toContainText(
    "Character fields are invalid",
  );
  await page
    .getByLabel("Character name", { exact: true })
    .fill("Corrected hero");
  await page.getByRole("button", { name: "Add character to realm" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Corrected hero",
  );
  await page.getByRole("button", { name: "World atlas" }).click();
  await expect(page.locator("#map")).toBeVisible();
});
