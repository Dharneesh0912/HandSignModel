// frontend/static/js/hand-avatar.js
// 2D canvas skeleton — MediaPipe style: thin colored lines + small dots.
// No 3D, no spheres. Pure canvas rendering.

let canvas, ctx;
let poseData = {};
let initialized = false;

// Smooth transition state
let currentPositions = null;    // [{x,y} x21]
let targetPositions  = null;    // [{x,y} x21]
let transitionStart  = 0;
const TRANSITION_MS  = 260;

// Finger colors (MediaPipe Holistic style)
const FINGER_COLORS = {
  thumb:  '#ff4d4d',
  index:  '#4d9bff',
  middle: '#4dff88',
  ring:   '#ffe24d',
  pinky:  '#4de0ff',
  palm:   '#ff4d4d',
};

// Landmark → finger mapping (0..20)
const LANDMARK_FINGER = [
  'palm',
  'thumb','thumb','thumb','thumb',
  'index','index','index','index',
  'middle','middle','middle','middle',
  'ring','ring','ring','ring',
  'pinky','pinky','pinky','pinky',
];

// Bones per finger
const BONE_GROUPS = {
  thumb:  [[0,1],[1,2],[2,3],[3,4]],
  index:  [[0,5],[5,6],[6,7],[7,8]],
  middle: [[5,9],[9,10],[10,11],[11,12]],
  ring:   [[9,13],[13,14],[14,15],[15,16]],
  pinky:  [[13,17],[17,18],[18,19],[19,20]],
  palm:   [[0,17]],
};

const ALL_BONES = [];
for (const finger in BONE_GROUPS) {
  for (const [a, b] of BONE_GROUPS[finger]) {
    ALL_BONES.push({ a, b, finger });
  }
}

const FINGERTIPS = [4, 8, 12, 16, 20];

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
export async function initHandAvatar(container) {
  if (initialized) return;
  initialized = true;

  // Load poses
  try {
    const res = await fetch('/static/js/poses.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    poseData = await res.json();
    console.log(`[hand-avatar] Loaded ${Object.keys(poseData).length} poses`);
  } catch (e) {
    console.warn('[hand-avatar] Could not load poses.json:', e);
    poseData = {};
  }

  // Create canvas on top of the stage
  canvas = document.createElement('canvas');
  canvas.id = 'hand-avatar-canvas';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '2';
  container.appendChild(canvas);

  ctx = canvas.getContext('2d');

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resize();
  window.addEventListener('resize', resize);

  // Render loop
  function loop() {
    if (currentPositions) {
      animateTowards();
      draw();
    }
    requestAnimationFrame(loop);
  }
  loop();
}

// ------------------------------------------------------------
// LANDMARK → canvas point
// ------------------------------------------------------------
function landmarkToPoint(lm) {
  const rect = canvas.getBoundingClientRect();
  const margin = 0.10;
  const w = rect.width  * (1 - margin * 2);
  const h = rect.height * (1 - margin * 2);
  return {
    x: rect.width  * margin + (1 - lm.x) * w,   // mirror X
    y: rect.height * margin + lm.y * h,
  };
}

// ------------------------------------------------------------
// SHOW LETTER
// ------------------------------------------------------------
export function showLetter(letter) {
  const pose = poseData[letter];
  if (!pose) {
    console.warn(`[hand-avatar] No pose for "${letter}"`);
    return;
  }

  targetPositions = pose.map(landmarkToPoint);
  transitionStart = performance.now();

  if (!currentPositions) {
    currentPositions = targetPositions.map(p => ({ ...p }));
  }
}

// ------------------------------------------------------------
// ANIMATE toward target
// ------------------------------------------------------------
function animateTowards() {
  if (!currentPositions || !targetPositions) return;

  const t = Math.min(
    (performance.now() - transitionStart) / TRANSITION_MS,
    1
  );
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  for (let i = 0; i < 21; i++) {
    currentPositions[i].x += (targetPositions[i].x - currentPositions[i].x) * ease;
    currentPositions[i].y += (targetPositions[i].y - currentPositions[i].y) * ease;
  }
}

// ------------------------------------------------------------
// DRAW
// ------------------------------------------------------------
function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  const pts = currentPositions;
  if (!pts || pts.length !== 21) return;

  // ---- Bones ----
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const { a, b, finger } of ALL_BONES) {
    const p1 = pts[a];
    const p2 = pts[b];

    // Black outline for visibility
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 7;
    ctx.stroke();

    // Colored line
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = FINGER_COLORS[finger] || '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // ---- Joints ----
  for (let i = 0; i < 21; i++) {
    const p = pts[i];
    const isTip = FINGERTIPS.includes(i);
    const isWrist = i === 0;
    const finger = LANDMARK_FINGER[i];
    const color = FINGER_COLORS[finger] || '#ffffff';
    const r = isWrist ? 7 : (isTip ? 6 : 5);

    // Black outline
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();

    // Colored dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // White highlight
    ctx.beginPath();
    ctx.arc(p.x - 1.5, p.y - 1.5, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  }
}

// ------------------------------------------------------------
// HIDE
// ------------------------------------------------------------
export function hideHand() {
  if (ctx && canvas) {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }
  currentPositions = null;
  targetPositions  = null;
}

export function getPoseCount() {
  return Object.keys(poseData).length;
}