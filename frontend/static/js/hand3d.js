import * as THREE from 'three';

// ============================================================
// SCENE SETUP
// ============================================================
const container = document.querySelector('.video-panel');

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.inset = '0';
renderer.domElement.style.pointerEvents = 'none';
renderer.domElement.style.zIndex = '2';
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  50, container.clientWidth / container.clientHeight, 0.1, 100
);
camera.position.z = 5;

// Lighting — metallic look needs key + fill + rim
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(2, 3, 4);
scene.add(key);

const fill = new THREE.DirectionalLight(0x88aaff, 1.2);
fill.position.set(-3, -1, 2);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffffff, 1.5);
rim.position.set(0, 0, -5);
scene.add(rim);

scene.add(new THREE.AmbientLight(0x404060, 1.0));

// ============================================================
// PROCEDURAL HAND GEOMETRY
// ============================================================
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

const FINGERTIPS = [4, 8, 12, 16, 20];
const WRIST = 0;

// Group holds all hand parts so we can move/scale it as one
const handGroup = new THREE.Group();
handGroup.visible = false; // hidden until landmarks arrive
scene.add(handGroup);

// Metallic material — shared but we'll clone for color changes
const baseMaterial = new THREE.MeshStandardMaterial({
  color: 0x4f9dff,
  metalness: 0.9,
  roughness: 0.25,
  emissive: 0x1a3a6c,
  emissiveIntensity: 0.4
});

// Create 21 joint spheres
const jointMeshes = [];
for (let i = 0; i < 21; i++) {
  const radius = FINGERTIPS.includes(i) ? 0.11 : (i === WRIST ? 0.14 : 0.085);
  const geo = new THREE.SphereGeometry(radius, 20, 16);
  const mat = baseMaterial.clone();
  const mesh = new THREE.Mesh(geo, mat);
  handGroup.add(mesh);
  jointMeshes.push(mesh);
}

// Create 20 bone cylinders (one per connection)
const boneMeshes = [];
for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 12, 1, true);
  geo.translate(0, 0.5, 0); // pivot at bottom so we can stretch
  const mat = baseMaterial.clone();
  const mesh = new THREE.Mesh(geo, mat);
  handGroup.add(mesh);
  boneMeshes.push(mesh);
}

// Palm plate — a flattened box that fills the center of the hand
const palmGeo = new THREE.BoxGeometry(0.6, 0.05, 0.5);
const palmMat = baseMaterial.clone();
palmMat.metalness = 0.95;
palmMat.roughness = 0.15;
const palmMesh = new THREE.Mesh(palmGeo, palmMat);
handGroup.add(palmMesh);

// ============================================================
// LANDMARK → 3D POSITION MAPPING
// ============================================================
// MediaPipe gives normalized (0..1) x, y. We flip x (mirror),
// recenter around 0, and map y upward (Three.js +y is up).
const SCALE = 3.2; // controls hand size in the scene

function landmarkTo3D(lm) {
  return new THREE.Vector3(
    (0.5 - lm.x) * SCALE,      // mirror x, center, scale
    (0.5 - lm.y) * SCALE,      // flip y (screen down → world up)
    -(lm.z || 0) * SCALE * 0.6 // depth, dampened
  );
}

// ============================================================
// UPDATE FROM LANDMARKS
// ============================================================
let currentColor = new THREE.Color(0x4f9dff);
let targetColor = new THREE.Color(0x4f9dff);

export function updateHand(landmarks, confidence) {
  if (!landmarks || landmarks.length === 0) {
    handGroup.visible = false;
    return;
  }
  handGroup.visible = true;

  // Position joints
  const positions = landmarks.map(landmarkTo3D);
  for (let i = 0; i < 21; i++) {
    jointMeshes[i].position.copy(positions[i]);
    if (FINGERTIPS.includes(i)) {
      const s = 1 + 0.15 * Math.sin(performance.now() * 0.005 + i);
      jointMeshes[i].scale.setScalar(s);
    }
  }

  // Position + stretch bones
  for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
    const [a, b] = HAND_CONNECTIONS[i];
    const p1 = positions[a];
    const p2 = positions[b];
    const bone = boneMeshes[i];

    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();

    bone.position.copy(mid);
    bone.scale.set(1, len, 1);

    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
    bone.quaternion.copy(quat);
  }

  // Palm plate
  const palmIndices = [0, 5, 9, 13, 17];
  const palmCenter = new THREE.Vector3();
  palmIndices.forEach(i => palmCenter.add(positions[i]));
  palmCenter.multiplyScalar(1 / palmIndices.length);
  palmMesh.position.copy(palmCenter);

  const palmDir = new THREE.Vector3().subVectors(positions[9], positions[0]);
  const palmQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), palmDir.clone().normalize()
  );
  palmMesh.quaternion.copy(palmQuat);

  // ===== COLOR BY CONFIDENCE =====
  if (confidence >= 0.70) {
    targetColor.setHex(0x4ade80);
  } else if (confidence >= 0.55) {
    targetColor.setHex(0xfbbf24);
  } else {
    targetColor.setHex(0x4f9dff);
  }
  currentColor.lerp(targetColor, 0.15);

  const emissive = currentColor.clone().multiplyScalar(0.4);
  jointMeshes.forEach(m => {
    m.material.color.copy(currentColor);
    m.material.emissive.copy(emissive);
  });
  boneMeshes.forEach(m => {
    m.material.color.copy(currentColor);
    m.material.emissive.copy(emissive);
  });
  palmMesh.material.color.copy(currentColor);
  palmMesh.material.emissive.copy(emissive);
}

export function hideHand() {
  handGroup.visible = false;
}

// ============================================================
// RENDER LOOP
// ============================================================
function animate() {
  requestAnimationFrame(animate);
  handGroup.rotation.y = Math.sin(performance.now() * 0.0005) * 0.15;
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});