import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
let viewState;
let paintEnabled = false;
export function mountWorld(container, initial, actions) {
  let data = initial;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9e1d1");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, 520);
  container.append(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "3D terrain: drag to orbit, scroll to zoom",
  );
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / 520,
    0.1,
    200,
  );
  camera.position.set(32, 35, 38);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 12;
  controls.maxDistance = 90;
  controls.enableDamping = true;
  if (viewState) {
    camera.position.fromArray(viewState.position);
    controls.target.fromArray(viewState.target);
  }
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4b5d40, 2.5));
  const sun = new THREE.DirectionalLight(0xfff2d9, 3);
  sun.position.set(10, 30, 20);
  scene.add(sun);
  const heights = [0.6, 0.18, 0.9, 2.8, 0.35, 0.5],
    matrix = new THREE.Matrix4(),
    color = new THREE.Color();
  const geo = new THREE.BoxGeometry(1, 1, 1),
    mat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const tiles = new THREE.InstancedMesh(geo, mat, 1120);
  scene.add(tiles);
  const treeGeo = new THREE.ConeGeometry(0.35, 1.1, 5),
    treeMat = new THREE.MeshStandardMaterial({ color: "#315940" });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, 1120);
  scene.add(trees);
  const pinGeo = new THREE.ConeGeometry(0.28, 1, 6),
    pinMat = new THREE.MeshStandardMaterial({ color: "#ffd381" }),
    pins = new THREE.Group();
  scene.add(pins);
  function draw() {
    let count = 0;
    for (let i = 0; i < data.tiles.length; i++) {
      const t = data.tiles[i],
        x = (i % 40) - 19.5,
        z = Math.floor(i / 40) - 13.5,
        h = heights[t];
      matrix.makeScale(0.98, h, 0.98);
      matrix.setPosition(x, h / 2, z);
      tiles.setMatrixAt(i, matrix);
      tiles.setColorAt(i, color.set(actions.colors[t]));
      if (t === 2) {
        matrix.makeTranslation(x, h + 0.55, z);
        trees.setMatrixAt(count++, matrix);
      }
    }
    tiles.instanceMatrix.needsUpdate = true;
    tiles.computeBoundingSphere();
    tiles.instanceColor.needsUpdate = true;
    trees.count = count;
    trees.instanceMatrix.needsUpdate = true;
    trees.computeBoundingSphere();
    pins.clear();
    for (const p of data.pins) {
      const mesh = new THREE.Mesh(pinGeo, pinMat);
      mesh.position.set(
        p.x - 19.5,
        heights[data.tiles[p.y * 40 + p.x]] + 0.9,
        p.y - 13.5,
      );
      pins.add(mesh);
    }
  }
  draw();
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let down;
  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => (down = [e.clientX, e.clientY]),
  );
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 ||
      (!paintEnabled && !actions.pinMode())
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(tiles)[0];
    if (hit) {
      const i = hit.instanceId,
        x = i % 40,
        y = Math.floor(i / 40);
      if (actions.pinMode()) actions.addPin(x, y);
      else {
        data = actions.paint(x, y);
        draw();
      }
    }
  });
  const button = document.querySelector("#paint-3d");
  function updateTool() {
    controls.enableRotate = !paintEnabled && !actions.pinMode();
    button.textContent = paintEnabled
      ? "Finish terrain painting"
      : "Enable terrain painting";
    button.classList.toggle("primary", paintEnabled);
  }
  button.onclick = () => {
    paintEnabled = !paintEnabled;
    updateTool();
  };
  updateTool();
  const observer = new ResizeObserver(() => {
    const w = container.clientWidth;
    if (!w) return;
    renderer.setSize(w, 520);
    camera.aspect = w / 520;
    camera.updateProjectionMatrix();
  });
  observer.observe(container);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  return () => {
    viewState = {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    };
    observer.disconnect();
    renderer.setAnimationLoop(null);
    controls.dispose();
    for (const r of [geo, mat, treeGeo, treeMat, pinGeo, pinMat]) r.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
