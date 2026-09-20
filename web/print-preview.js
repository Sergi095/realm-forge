import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { STLLoader } from "./vendor/STLLoader.js";
export function createPrintPreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dce2d2");
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556048, 2.7));
  const light = new THREE.DirectionalLight(0xfff6e0, 3);
  light.position.set(100, 200, 100);
  scene.add(light);
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.9,
  });
  let mesh;
  const resize = () => {
    const width = container.clientWidth,
      height = 380;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  return {
    update(bytes, model, palette) {
      const geometry = new STLLoader().parse(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
      const colors = new Float32Array(model.colors.length * 9);
      const converted = palette.map((hex) => new THREE.Color(hex));
      model.colors.forEach((index, i) => {
        const c = converted[index];
        for (let j = 0; j < 3; j++) colors.set([c.r, c.g, c.b], i * 9 + j * 3);
      });
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.rotateX(-Math.PI / 2);
      geometry.center();
      geometry.computeBoundingBox();
      const size = geometry.boundingBox.getSize(new THREE.Vector3());
      if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
      }
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      const length = Math.max(size.x, size.y, size.z);
      camera.position.set(length * 0.85, length * 0.9, length * 1.15);
      camera.near = Math.max(0.01, length / 1000);
      camera.far = length * 20;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    },
    dispose() {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      mesh?.geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
