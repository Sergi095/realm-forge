import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#map")).toBeVisible();
}
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

test("materials, structures, elevation and scale persist across both views", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(page).toHaveTitle(/DND Campaign Building/);
  await page.locator("#build-tool").selectOption("block");
  await page.getByLabel("Find a material").fill("glass");
  await page.locator('[data-material="3"]').click();
  await page.locator("#map").click({ position: { x: 200, y: 160 } });
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  expect((await snapshot(page)).blocks[0].material).toBe(3);
  await page.locator("#build-tool").selectOption("raise");
  await page.locator("#brush-size").selectOption("3");
  await page.locator("#map").click({ position: { x: 300, y: 200 } });
  await expect
    .poll(async () =>
      (await snapshot(page)).elevations.reduce((a, b) => a + b, 0),
    )
    .toBe(9);
  await page.locator("#structure-preset").selectOption("tower");
  await page.locator("#map").click({ position: { x: 200, y: 180 } });
  await expect
    .poll(async () => (await snapshot(page)).blocks.length)
    .toBeGreaterThan(50);
  await page.getByRole("button", { name: "Undo", exact: false }).click();
  await expect.poll(async () => (await snapshot(page)).blocks.length).toBe(1);
  await page.getByRole("button", { name: "Redo", exact: false }).click();
  await expect
    .poll(async () => (await snapshot(page)).blocks.length)
    .toBeGreaterThan(50);
  await page.getByLabel("Distance per tile").selectOption("10");
  await page.getByRole("button", { name: "3D world" }).click();
  await expect(page.locator("#scene canvas")).toBeVisible();
  await page.locator("#build-tool").selectOption("block");
  const beforeBuild = (await snapshot(page)).blocks.length;
  const scene = page.locator("#scene canvas");
  await expect(scene).toBeVisible();
  const box = await scene.boundingBox();
  await scene.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect
    .poll(async () => (await snapshot(page)).blocks.length)
    .toBe(beforeBuild + 1);
  await expect(page.locator("#block-count")).toHaveText(
    `${beforeBuild + 1} / 12,000 blocks`,
  );
  await page.getByLabel("Find a material").fill("");
  await page.screenshot({ path: "test-results/material-world.png" });
  await page.reload();
  expect((await snapshot(page)).meters_per_tile).toBe(10);
  expect((await snapshot(page)).blocks.length).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test("color 3MF exports a closed model and configurable colors", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "3D print & scale" }).click();
  await expect(page.locator("#print-download")).toBeEnabled();
  await expect(page.locator("#print-measurements")).toContainText("180 × 126");
  await expect(page.locator("#print-preview canvas")).toBeVisible();
  await page.getByText("Print colors", { exact: true }).click();
  await page.locator('[data-print-color="0"]').fill("#ff0000");
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download color 3MF" }).click();
  const download = await wait;
  expect(download.suggestedFilename()).toMatch(/\.3mf$/);
  const path = await download.path();
  const result = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import sys,zipfile,xml.etree.ElementTree as E,json
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
m=E.fromstring(z.read('3D/3dmodel.model'));ns={'c':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02','m':'http://schemas.microsoft.com/3dmanufacturing/material/2015/02'}
v=m.findall('.//c:vertex',ns);t=m.findall('.//c:triangle',ns);colors=m.findall('.//m:color',ns)
edges={}
for f in t:
 ids=[int(f.attrib[k]) for k in ('v1','v2','v3')]
 assert all(0<=i<len(v) for i in ids)
 assert int(f.attrib['p1'])<len(colors)
 for a,b in zip(ids,ids[1:]+ids[:1]):
  key=tuple(sorted((a,b)));n,d=edges.get(key,(0,0));edges[key]=(n+1,d+(1 if a<b else -1))
assert all(e==(2,0) for e in edges.values())
print(json.dumps({'unit':m.attrib['unit'],'vertices':len(v),'triangles':len(t),'colors':len(colors),'first':colors[0].attrib['color']}))`,
        path,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(result.unit).toBe("millimeter");
  expect(result.colors).toBe(37);
  expect(result.first).toBe("#FF0000FF");
  expect(result.triangles).toBeGreaterThan(70000);
  await page.screenshot({ path: "test-results/color-print-preview.png" });
});

test("tabletop scale warns for full world, sections fit and ZIP preserves scale", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "3D print & scale" }).click();
  await page.locator("#print-scale").selectOption("60");
  await expect(page.locator("#print-measurements")).toContainText(
    "25.4 mm per tile",
  );
  await expect(page.locator("#print-measurements")).toContainText("Too large");
  await page.locator("#print-section").selectOption("8");
  await expect(page.locator("#print-measurements")).toContainText(
    "203.2 × 203.2",
  );
  await expect(page.locator("#print-measurements")).toContainText("Fits");
  await page.locator("#print-format").selectOption("stl");
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download all sections (.zip)" })
    .click();
  const d = await wait;
  const result = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import sys,zipfile,struct,json
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
files=[n for n in z.namelist() if n.endswith('.stl')];data=z.read(files[0]);n=struct.unpack_from('<I',data,80)[0];assert len(data)==84+n*50
verts=[struct.unpack_from('<3f',data,84+i*50+12+j*12) for i in range(n) for j in range(3)]
print(json.dumps({'files':len(files),'width':max(v[0] for v in verts),'depth':max(v[1] for v in verts)}))`,
        await d.path(),
      ],
      { encoding: "utf8" },
    ),
  );
  expect(result.files).toBe(20);
  expect(result.width).toBeCloseTo(203.2, 3);
  expect(result.depth).toBeCloseTo(203.2, 3);
});

test("invalid print sizes disable export and leave campaign unchanged", async ({
  page,
}) => {
  await ready(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "3D print & scale" }).click();
  await page.locator("#print-width").fill("0");
  await expect(page.locator("#print-download")).toBeDisabled();
  await expect(page.locator("#print-error")).toBeVisible();
  await page.getByRole("button", { name: "Close print preview" }).click();
  expect(await snapshot(page)).toEqual(before);
});
