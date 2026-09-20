import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
await mkdir("web/vendor", { recursive: true });
for (const [src, dest] of [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["examples/jsm/loaders/STLLoader.js", "STLLoader.js"],
  ["LICENSE", "THREE-LICENSE.txt"],
])
  await copyFile("node_modules/three/" + src, "web/vendor/" + dest);

await copyFile(
  "node_modules/pdf-lib/dist/pdf-lib.esm.min.js",
  "web/vendor/pdf-lib.js",
);
await copyFile(
  "node_modules/pdf-lib/LICENSE.md",
  "web/vendor/PDF-LIB-LICENSE.txt",
);
// The ES build imports a bare pako package. Use the self-contained browser
// bundle and expose its result to our ES module without a CDN dependency.
await writeFile(
  "web/vendor/fontkit.js",
  (await readFile(
    "node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js",
    "utf8",
  )) + "\nexport default globalThis.fontkit;\n",
);
await copyFile("node_modules/pako/LICENSE", "web/vendor/PAKO-LICENSE.txt");
await copyFile(
  "node_modules/@pdf-lib/fontkit/README.md",
  "web/vendor/FONTKIT-NOTICE.md",
);
