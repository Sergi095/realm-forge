import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import {
  terrains,
  materials,
  textureCanvas,
  groundHeight,
} from "./materials.js";
let viewState,
  buildEnabled = false;
export function mountWorld(container, initial, actions) {
  let data = initial,
    disposed = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9e1d1");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, 520);
  container.append(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "3D material world: orbit to inspect, enable building to place or remove blocks",
  );
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / 520,
    0.1,
    300,
  );
  camera.position.set(32, 35, 38);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3;
  controls.maxDistance = 120;
  controls.enableDamping = true;
  if (viewState) {
    camera.position.fromArray(viewState.position);
    controls.target.fromArray(viewState.target);
  }
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4b5d40, 2.2));
  const sun = new THREE.DirectionalLight(0xfff2d9, 2.7);
  sun.position.set(10, 30, 20);
  scene.add(sun);
  const textures = [],
    renderMaterials = [...terrains, ...materials].map((m) => {
      const texture = new THREE.CanvasTexture(textureCanvas(m));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      textures.push(texture);
      return new THREE.MeshStandardMaterial({
        map: texture,
        roughness: m.texture === "metal" ? 0.45 : 0.95,
        metalness: m.texture === "metal" ? 0.25 : 0,
        emissive: m.texture === "lava" ? m.color : "#000000",
        emissiveIntensity: m.texture === "lava" ? 0.18 : 0,
      });
    });
  const cube = new THREE.BoxGeometry(1, 1, 1),
    treeGeo = new THREE.ConeGeometry(0.35, 1.1, 5),
    treeMat = new THREE.MeshStandardMaterial({ color: "#315940" }),
    pinGeo = new THREE.ConeGeometry(0.28, 1, 6),
    pinMat = new THREE.MeshStandardMaterial({ color: "#ffd381" }),
    matrix = new THREE.Matrix4();
  let meshes = [],
    objects = [];
  const trees = new THREE.Group(),
    pins = new THREE.Group();
  scene.add(trees, pins);
  const ghostMat = new THREE.MeshBasicMaterial({
      color: "#ffe7a1",
      transparent: true,
      opacity: 0.45,
      wireframe: true,
    }),
    ghost = new THREE.Mesh(cube, ghostMat);
  ghost.visible = false;
  scene.add(ghost);
  function draw() {
    for (const m of meshes) {
      scene.remove(m);
      m.dispose();
    }
    meshes = [];
    objects = [];
    trees.clear();
    pins.clear();
    for (const terrain of terrains) {
      const ids = data.tiles.flatMap((t, i) => (t === terrain.id ? [i] : []));
      if (!ids.length) continue;
      const mesh = new THREE.InstancedMesh(
        cube,
        renderMaterials[terrain.id],
        ids.length,
      );
      ids.forEach((i, n) => {
        const x = i % 40,
          y = Math.floor(i / 40),
          height = groundHeight(data, x, y);
        matrix.makeScale(0.99, height, 0.99);
        matrix.setPosition(x - 19.5, height / 2, y - 13.5);
        mesh.setMatrixAt(n, matrix);
      });
      mesh.userData = { kind: "terrain", ids };
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
      objects.push(mesh);
      scene.add(mesh);
    }
    for (const material of materials) {
      const blocks = data.blocks.filter((b) => b.material === material.id);
      if (!blocks.length) continue;
      const mesh = new THREE.InstancedMesh(
        cube,
        renderMaterials[terrains.length + material.id],
        blocks.length,
      );
      blocks.forEach((b, i) => {
        matrix.makeTranslation(b.x - 19.5, b.z + 0.5, b.y - 13.5);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.userData = { kind: "block", blocks };
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
      objects.push(mesh);
      scene.add(mesh);
    }
    for (let i = 0; i < data.tiles.length; i++)
      if (
        data.tiles[i] === 2 &&
        !data.blocks.some((b) => b.x === i % 40 && b.y === Math.floor(i / 40))
      ) {
        const x = i % 40,
          y = Math.floor(i / 40),
          mesh = new THREE.Mesh(treeGeo, treeMat);
        mesh.position.set(x - 19.5, groundHeight(data, x, y) + 0.55, y - 13.5);
        trees.add(mesh);
      }
    for (const p of data.pins) {
      const mesh = new THREE.Mesh(pinGeo, pinMat);
      mesh.position.set(
        p.x - 19.5,
        groundHeight(data, p.x, p.y) + 0.9,
        p.y - 13.5,
      );
      pins.add(mesh);
    }
    const count = document.querySelector("#block-count");
    if (count)
      count.textContent = `${data.blocks.length.toLocaleString()} / 12,000 blocks`;
  }
  draw();
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let down;
  function target(e, removing = false) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(objects)[0];
    if (!hit) return null;
    let x, y, z;
    if (hit.object.userData.kind === "block") {
      const b = hit.object.userData.blocks[hit.instanceId];
      ({ x, y, z } = b);
      if (!removing && actions.tool() === "block") {
        x += Math.round(hit.face.normal.x);
        y += Math.round(hit.face.normal.z);
        z += Math.round(hit.face.normal.y);
      }
    } else {
      if (removing) return null;
      const i = hit.object.userData.ids[hit.instanceId];
      x = i % 40;
      y = Math.floor(i / 40);
      z = Math.floor(groundHeight(data, x, y));
    }
    return { x, y, z };
  }
  renderer.domElement.onpointerdown = (e) => {
    down = [e.clientX, e.clientY];
  };
  renderer.domElement.onpointermove = (e) => {
    if (!buildEnabled && !actions.pinMode()) {
      ghost.visible = false;
      return;
    }
    const point = target(e, actions.tool() === "erase");
    ghost.visible = !!point;
    if (point) {
      const size = ["paint", "raise", "lower", "flatten"].includes(
        actions.tool(),
      )
        ? actions.brush()
        : 1;
      ghost.scale.set(size, 1, size);
      ghost.position.set(point.x - 19.5, point.z + 0.5, point.y - 13.5);
      ghostMat.color.set(actions.tool() === "erase" ? "#ff7777" : "#ffe7a1");
    }
  };
  renderer.domElement.onpointerleave = () => {
    ghost.visible = false;
  };
  renderer.domElement.onpointerup = (e) => {
    if (
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 ||
      (!buildEnabled && !actions.pinMode())
    )
      return;
    const erase = e.button === 2 || actions.tool() === "erase",
      point = target(e, erase);
    if (!point) return;
    if (actions.pinMode() && e.button === 0) {
      actions.addPin(point.x, point.y);
      return;
    }
    if (![0, 2].includes(e.button)) return;
    data = actions.edit(point.x, point.y, point.z, erase);
    if (!disposed) draw();
  };
  const button = document.querySelector("#paint-3d");
  if (actions.tool() !== "paint") buildEnabled = true;
  function updateTool() {
    controls.enableRotate = !buildEnabled && !actions.pinMode();
    controls.enablePan = !buildEnabled && !actions.pinMode();
    button.textContent = buildEnabled
      ? "Navigate / orbit"
      : actions.tool() === "paint"
        ? "Enable terrain painting"
        : "Enable building";
    button.classList.toggle("primary", buildEnabled);
    document.querySelector("#map-help").textContent = buildEnabled
      ? "Click to build · right-click removes a block · scroll to zoom"
      : "Drag to orbit · right-drag to pan · scroll to zoom";
  }
  button.onclick = () => {
    buildEnabled = !buildEnabled;
    updateTool();
  };
  updateTool();
  const reset = document.querySelector("#reset-camera");
  if (reset)
    reset.onclick = () => {
      camera.position.set(32, 35, 38);
      controls.target.set(0, 0, 0);
      controls.update();
    };
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
    disposed = true;
    viewState = {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    };
    observer.disconnect();
    renderer.setAnimationLoop(null);
    controls.dispose();
    meshes.forEach((m) => m.dispose());
    [
      cube,
      treeGeo,
      treeMat,
      pinGeo,
      pinMat,
      ghostMat,
      ...renderMaterials,
      ...textures,
    ].forEach((r) => r.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  };
}
