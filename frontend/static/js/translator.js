const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const sentenceEl = document.getElementById("sentence");
const sentenceTextEl = document.getElementById("sentenceText");
const statusEl = document.getElementById("status");
const letterPopup = document.getElementById("letterPopup");
const guidance = document.getElementById("guidance");
const guideReason = document.getElementById("guideReason");
const guideFix = document.getElementById("guideFix");
const fpsEl = document.getElementById("fps");
const confEl = document.getElementById("conf");
const handedEl = document.getElementById("handed");
const letterCountEl = document.getElementById("letterCount");
const ring = document.getElementById("progressRing");
const ringFg = ring.querySelector(".ring-fg");
const ringCountdown = document.getElementById("ringCountdown");
const ringLabel = document.getElementById("ringLabel");
const autoVoice = document.getElementById("autoVoice");
const videoPanel = document.querySelector(".video-panel");

// ============================================================
// CONFIRMATION LOGIC  (unchanged)
// ============================================================
const HOLD_DURATION = 1400;
const CONF_THRESHOLD = 0.70;
const CONF_THRESHOLD_SOFT = 0.55;
const MIN_AGREEMENT = 0.6;
const RING_CIRC = 2 * Math.PI * 52;

let sentence = "";
let letterCount = 0;
let currentPred = "";
let predStart = 0;
let lastAdded = "";
let lastLabel = "";
let currentAgreement = 1.0;

// ============================================================
// SMOOTHED HAND STATE  (unchanged)
// ============================================================
const SMOOTH = 0.35;

let handState = {
  active: false,
  target: [],
  current: [],
  palmCenter: { x: 0, y: 0 },
  palmTarget: { x: 0, y: 0 },
  rotation: 0,
  targetRotation: 0,
  power: 0,
  targetPower: 0,
  handWidth: 100,
  targetHandWidth: 100
};

let trailDots = [];
let orbitParticles = [];
let energyWaves = [];
let burstParticles = [];
let time = 0;

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];
const FINGERTIPS = [4, 8, 12, 16, 20];
const ALL_JOINTS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

// ============================================================
// CAMERA
// ============================================================
navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
  .then(stream => { video.srcObject = stream; })
  .catch(() => { statusEl.textContent = "Camera access denied."; });

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

function lerp(a, b, t) { return a + (b - a) * t; }
function dist(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }

// ============================================================
// UPDATE TARGET
// ============================================================
function setHandTarget(landmarks, confidence) {
  if (!landmarks || landmarks.length === 0) return;

  const W = canvas.width, H = canvas.height;
  const target = landmarks.map(p => ({ x: p.x * W, y: p.y * H }));

  if (handState.current.length !== target.length) {
    handState.current = target.map(p => ({ ...p }));
  }

  handState.target = target;
  handState.active = true;
  handState.targetPower = confidence;

  const palmIdx = [0, 5, 9, 13, 17];
  let cx = 0, cy = 0;
  palmIdx.forEach(i => { cx += target[i].x; cy += target[i].y; });
  handState.palmTarget = { x: cx / palmIdx.length, y: cy / palmIdx.length };

  const wrist = target[0];
  const middle = target[12];
  handState.targetRotation = Math.atan2(middle.y - wrist.y, middle.x - wrist.x) + Math.PI / 2;
  handState.targetHandWidth = dist(wrist, target[12]);
}

function markHandLost() {
  handState.active = false;
  handState.current = [];
  handState.target = [];
  trailDots = [];
  orbitParticles = [];
  energyWaves = [];
}

// ============================================================
// SMOOTH UPDATE
// ============================================================
function smoothUpdate() {
  if (!handState.active) return;

  if (handState.current.length === handState.target.length) {
    for (let i = 0; i < handState.current.length; i++) {
      handState.current[i].x = lerp(handState.current[i].x, handState.target[i].x, SMOOTH);
      handState.current[i].y = lerp(handState.current[i].y, handState.target[i].y, SMOOTH);
    }
  } else {
    handState.current = handState.target.map(p => ({ ...p }));
  }

  handState.palmCenter.x = lerp(handState.palmCenter.x, handState.palmTarget.x, SMOOTH);
  handState.palmCenter.y = lerp(handState.palmCenter.y, handState.palmTarget.y, SMOOTH);

  let rotDiff = handState.targetRotation - handState.rotation;
  while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
  while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
  handState.rotation += rotDiff * SMOOTH;

  handState.power = lerp(handState.power, handState.targetPower, 0.1);
  handState.handWidth = lerp(handState.handWidth, handState.targetHandWidth, 0.15);

  if (Math.random() < 0.7) {
    trailDots.push({
      x: handState.palmCenter.x,
      y: handState.palmCenter.y,
      life: 1.0,
      size: 3 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5
    });
  }
  trailDots = trailDots.filter(d => {
    d.x += d.vx; d.y += d.vy;
    d.vx *= 0.94; d.vy *= 0.94;
    d.life -= 0.025;
    return d.life > 0;
  });
  if (trailDots.length > 40) trailDots.splice(0, trailDots.length - 40);

  if (orbitParticles.length < 12 && Math.random() < 0.15) {
    orbitParticles.push({
      angle: Math.random() * Math.PI * 2,
      radius: 30 + Math.random() * 30,
      speed: 0.02 + Math.random() * 0.04,
      size: 1.5 + Math.random() * 2,
      life: 1.0,
      decay: 0.008 + Math.random() * 0.01
    });
  }
  orbitParticles = orbitParticles.filter(p => {
    p.angle += p.speed;
    p.life -= p.decay;
    return p.life > 0;
  });

  if (Math.random() < 0.06) {
    const tip = handState.current[FINGERTIPS[Math.floor(Math.random() * 5)]];
    if (tip) {
      energyWaves.push({
        x: tip.x, y: tip.y,
        radius: 0,
        maxRadius: 40,
        life: 1.0,
        decay: 0.03
      });
    }
  }
  energyWaves = energyWaves.filter(w => {
    w.radius += (w.maxRadius - w.radius) * 0.15;
    w.life -= w.decay;
    return w.life > 0;
  });

  burstParticles = burstParticles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= 0.02;
    return p.life > 0;
  });

  time += 0.016;
}

// ============================================================
// DRAW
// ============================================================
function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!handState.active || handState.current.length === 0) {
    requestAnimationFrame(drawFrame);
    return;
  }

  const pts = handState.current;
  const power = handState.power;

  let c1, c2;
  if (power >= CONF_THRESHOLD) {
    c1 = [168, 213, 181];
    c2 = [200, 230, 210];
  } else if (power >= 0.5) {
    c1 = [224, 199, 138];
    c2 = [240, 220, 170];
  } else {
    c1 = [200, 200, 200];
    c2 = [230, 230, 230];
  }
  const [r, g, b] = c1;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  trailDots.forEach(d => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.size * d.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${d.life * 0.6})`;
    ctx.fill();
  });

  HAND_CONNECTIONS.forEach(([a, b]) => {
    const p1 = pts[a], p2 = pts[b];
    if (!p1 || !p2) return;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
    ctx.lineWidth = 12;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  HAND_CONNECTIONS.forEach(([a, b], idx) => {
    const p1 = pts[a], p2 = pts[b];
    if (!p1 || !p2) return;

    const phase = (time * 1.2 + idx * 0.2) % 1;
    const fade = Math.sin(phase * Math.PI);
    const dx = lerp(p1.x, p2.x, phase);
    const dy = lerp(p1.y, p2.y, phase);

    ctx.beginPath();
    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.5 * fade})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(dx, dy, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * fade})`;
    ctx.fill();
  });

  energyWaves.forEach(w => {
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${w.life * 0.7})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ALL_JOINTS.forEach((idx, i) => {
    const p = pts[idx];
    if (!p) return;

    const isTip = FINGERTIPS.includes(idx);
    const isWrist = idx === 0;
    const baseSize = isTip ? 5 : (isWrist ? 6 : 3.5);
    const pulse = 1 + 0.25 * Math.sin(time * 5 + i * 0.7);
    const size = baseSize * pulse;

    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 5);
    grd.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
    grd.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.beginPath();
    ctx.fillStyle = grd;
    ctx.arc(p.x, p.y, size * 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowBlur = 15;
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(p.x, p.y, size * 0.4, 0, Math.PI * 2);
    ctx.fill();

    if (!isTip) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size + 4, time * 3 + i, time * 3 + i + Math.PI * 1.3);
      ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  });

  FINGERTIPS.forEach((idx, i) => {
    const p = pts[idx];
    if (!p) return;

    for (let k = 0; k < 2; k++) {
      const phase = ((time * 1.5 + i * 0.3 + k * 0.5) % 1);
      const radius = 8 + phase * 22;
      const alpha = (1 - phase) * 0.8;

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  const palm = handState.palmCenter;
  orbitParticles.forEach(p => {
    const x = palm.x + Math.cos(p.angle) * p.radius;
    const y = palm.y + Math.sin(p.angle) * p.radius;
    ctx.beginPath();
    ctx.arc(x, y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.life * 0.9})`;
    ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  const coreGrad = ctx.createRadialGradient(palm.x, palm.y, 0, palm.x, palm.y, 50);
  coreGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.35 * power + 0.1})`);
  coreGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.beginPath();
  ctx.fillStyle = coreGrad;
  ctx.arc(palm.x, palm.y, 50, 0, Math.PI * 2);
  ctx.fill();

  burstParticles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.life})`;
    ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  ctx.restore();

  requestAnimationFrame(drawFrame);
}

function animationLoop() {
  smoothUpdate();
  requestAnimationFrame(animationLoop);
}
animationLoop();
drawFrame();

// ============================================================
// PREDICTION LOOP
// ============================================================
let frameTimes = [];
let sendingFrame = false;
let lastServerReply = 0;

async function sendFrame() {
  if (sendingFrame) {
    setTimeout(sendFrame, 20);
    return;
  }

  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter(t => now - t < 1000);
  fpsEl.textContent = `${frameTimes.length} FPS`;

  if (video.readyState === 4) {
    sendingFrame = true;

    const temp = document.createElement("canvas");
    temp.width = video.videoWidth || 640;
    temp.height = video.videoHeight || 480;
    temp.getContext("2d").drawImage(video, 0, 0, temp.width, temp.height);
    const dataURL = temp.toDataURL("image/jpeg", 0.7);

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataURL }),
      });
      const data = await res.json();
      handlePrediction(data);
      lastServerReply = performance.now();
    } catch (e) { /* silent */ }

    sendingFrame = false;
  }

  setTimeout(sendFrame, 30);
}

// Watchdog  (no emoji)
setInterval(() => {
  if (handState.active && performance.now() - lastServerReply > 1500) {
    markHandLost();
    videoPanel.classList.remove("hand-detected", "confidence-high", "confidence-medium", "confidence-low");
    statusEl.textContent = "Show your hand";
    statusEl.style.color = "#b0b0b0";
  }
}, 500);

// ============================================================
// CONFIRMATION ENGINE  (no emoji)
// ============================================================
function handlePrediction(data) {
  if (!data.hand) {
    markHandLost();
    statusEl.textContent = "Show your hand";
    statusEl.style.color = "#b0b0b0";
    ring.classList.remove("active");
    guidance.classList.add("hidden");
    currentPred = "";
    lastLabel = "";
    confEl.textContent = "--%";
    handedEl.textContent = "--";
    videoPanel.classList.remove("hand-detected", "confidence-high", "confidence-medium", "confidence-low");
    return;
  }

  const { label, confidence, landmarks, handedness, reason, fix, agreement } = data;
  currentAgreement = agreement || 1.0;

  setHandTarget(landmarks, confidence);

  confEl.textContent = `${(confidence * 100).toFixed(0)}%`;
  handedEl.textContent = handedness || "--";

  videoPanel.classList.add("hand-detected");
  videoPanel.classList.remove("confidence-high", "confidence-medium", "confidence-low");

  if (confidence >= CONF_THRESHOLD) {
    videoPanel.classList.add("confidence-high");
  } else if (confidence >= CONF_THRESHOLD_SOFT) {
    videoPanel.classList.add("confidence-medium");
  } else {
    videoPanel.classList.add("confidence-low");
  }

  const isConfident = confidence >= CONF_THRESHOLD && currentAgreement >= MIN_AGREEMENT;
  const isSoftConfident = confidence >= CONF_THRESHOLD_SOFT && currentAgreement >= MIN_AGREEMENT;

  // Case 1: too low
  if (!isSoftConfident) {
    statusEl.textContent = `Ignored — ${(confidence * 100).toFixed(0)}%`;
    statusEl.style.color = "#e0a0a0";
    showGuidance(reason || "Low confidence", fix || "Hold the sign steadier");
    ring.classList.remove("active");
    currentPred = "";
    lastLabel = "";
    return;
  }

  // Case 2: doubtful
  if (!isConfident) {
    statusEl.textContent = `Getting there — ${label} (${(confidence * 100).toFixed(0)}%)`;
    statusEl.style.color = "#e0c78a";
    showGuidance(reason || "Almost there",
                 fix || "Hold steady for a moment longer");
    if (label !== lastLabel) {
      currentPred = "";
      lastLabel = label;
    }
    ring.classList.remove("active");
    return;
  }

  // Case 3: confident → hold
  statusEl.textContent = `${label} — hold steady`;
  statusEl.style.color = "#a8d5b5";
  guidance.classList.add("hidden");

  if (label === currentPred) {
    const elapsed = Date.now() - predStart;
    const progress = Math.min(elapsed / HOLD_DURATION, 1);

    ring.classList.add("active");
    ringFg.style.strokeDashoffset = RING_CIRC * (1 - progress);
    ringFg.classList.toggle("warn", progress < 0.5);
    ringFg.classList.toggle("good", progress >= 0.5);

    if (ringCountdown) {
      const remaining = Math.max(0, (HOLD_DURATION - elapsed) / 1000);
      ringCountdown.textContent = remaining.toFixed(1);
    }

    if (elapsed > HOLD_DURATION && label !== lastAdded) {
      applyLabel(label);
      showLetterPopup(label);
      triggerBurstEffect();
      lastAdded = label;
      predStart = Date.now();
      ring.classList.remove("active");
      setTimeout(() => { lastAdded = ""; }, 800);
    }
  } else {
    currentPred = label;
    predStart = Date.now();
    lastAdded = "";
    ring.classList.remove("active");
  }
}

function triggerBurstEffect() {
  const center = handState.palmCenter;
  for (let i = 0; i < 40; i++) {
    const angle = (Math.PI * 2 * i) / 40 + Math.random() * 0.4;
    const speed = 2 + Math.random() * 4;
    burstParticles.push({
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 2 + Math.random() * 2
    });
  }
}

// ============================================================
// UI HELPERS  (no emoji)
// ============================================================
function showLetterPopup(label) {
  let text = label;
  if (label === "Space") text = "\u2423";
  else if (label === "Clear") text = "CLEAR";

  letterPopup.textContent = text;
  letterPopup.classList.toggle("word", label === "Clear");

  if (label === "Clear") {
    letterPopup.style.color = "#e0a0a0";
    letterPopup.style.textShadow = "0 0 60px rgba(224, 160, 160, 1), 0 0 120px rgba(224, 160, 160, 0.6)";
  } else {
    letterPopup.style.color = "#ffffff";
    letterPopup.style.textShadow = "0 0 60px rgba(168, 213, 181, 1), 0 0 120px rgba(168, 213, 181, 0.6), 0 4px 20px rgba(0,0,0,0.9)";
  }

  letterPopup.classList.remove("show");
  void letterPopup.offsetWidth;
  letterPopup.classList.add("show");
}

function showGuidance(reason, fix) {
  if (!reason) { guidance.classList.add("hidden"); return; }
  guideReason.textContent = reason;
  guideFix.textContent = fix;
  guidance.classList.remove("hidden");
}
function applyLabel(label) {
  if (label === "Space") {
    sentence += " ";
  } else if (label === "Clear") {
    // ---- BACKSPACE behavior ----
    // Trim trailing whitespace first, then remove one character.
    let s = sentence.replace(/\s+$/, "");
    if (s.length === 0) {
      // Nothing to delete, but still flash feedback
      flashRipple();
      return;
    }
    s = s.slice(0, -1);
    sentence = s;
    letterCount = Math.max(0, letterCount - 1);
  } else {
    sentence += label;
    letterCount++;
  }

  // Write to the inner text span
  if (sentenceTextEl) sentenceTextEl.textContent = sentence;
  sentenceEl.dataset.empty = sentence ? "false" : "true";
  letterCountEl.textContent = `${letterCount} letters`;

  // Ripple feedback
  flashRipple();

  // Voice
  if (autoVoice.checked && label !== "Clear" && label !== "Space") {
    const u = new SpeechSynthesisUtterance(label);
    u.rate = 1.2; u.volume = 0.6;
    speechSynthesis.speak(u);
  }
}

function flashRipple() {
  sentenceEl.classList.remove("ripple");
  void sentenceEl.offsetWidth;
  sentenceEl.classList.add("ripple");
}
document.getElementById("speakBtn").onclick = () => {
  if (!sentence.trim()) return;
  const u = new SpeechSynthesisUtterance(sentence);
  u.rate = 0.9;
  speechSynthesis.speak(u);
};
document.getElementById("spaceBtn").onclick = () => applyLabel("Space");
document.getElementById("clearBtn").onclick = () => applyLabel("Clear");
document.getElementById("saveBtn").onclick = async () => {
  if (!sentence.trim()) return;
  await fetch("/api/save_sentence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentence }),
  });
  statusEl.textContent = "Sentence saved";
  statusEl.style.color = "#a8d5b5";
  setTimeout(() => { statusEl.textContent = "Show your hand"; statusEl.style.color = "#b0b0b0"; }, 1500);
};

sendFrame();