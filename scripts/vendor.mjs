import { mkdir, copyFile } from "node:fs/promises";
await mkdir("web/vendor", { recursive: true });
for (const [src, dest] of [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["examples/jsm/loaders/STLLoader.js", "STLLoader.js"],
  ["LICENSE", "THREE-LICENSE.txt"],
])
  await copyFile("node_modules/three/" + src, "web/vendor/" + dest);
