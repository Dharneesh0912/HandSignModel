/* ============================================================
   SignSpeak — 3D Neural Network Background (Black & White)
   ============================================================ */

(function () {
  'use strict';

  // ---------- Config ----------
  const CONFIG = {
    neuronCount: 55,
    maxLinkDistance: 180,
    neuronRadius: { min: 1.2, max: 2.8 },
    colors: {
      neuron: '#ffffff',
      neuronGlow: 'rgba(255, 255, 255, 0.5)',
      link: 'rgba(255, 255, 255, 0.10)',
      pulse: 'rgba(255, 255, 255, 0.8)'
    },
    speed: 0.25,
    parallax: 0.03,
    pulseChance: 0.004,
    pulseSpeed: 0.015
  };

  // ---------- Setup ----------
  const canvas = document.createElement('canvas');
  canvas.id = 'ai-canvas';
  Object.assign(canvas.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
    opacity: '0.7'
  });

  function init() {
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
    let neurons = [];
    let links = [];
    let pulses = [];
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width  = W * DPR;
      canvas.height = H * DPR;
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      buildNetwork();
    }

    function buildNetwork() {
      neurons = [];
      links = [];
      pulses = [];

      const count = Math.max(25, Math.min(CONFIG.neuronCount, Math.floor((W * H) / 22000)));

      for (let i = 0; i < count; i++) {
        neurons.push({
          x: Math.random() * W,
          y: Math.random() * H,
          z: Math.random() * 0.6 + 0.4,
          vx: (Math.random() - 0.5) * CONFIG.speed,
          vy: (Math.random() - 0.5) * CONFIG.speed,
          r: CONFIG.neuronRadius.min +
             Math.random() * (CONFIG.neuronRadius.max - CONFIG.neuronRadius.min),
          pulse: Math.random() * Math.PI * 2
        });
      }

      for (let i = 0; i < neurons.length; i++) {
        const a = neurons[i];
        let connections = 0;
        for (let j = i + 1; j < neurons.length; j++) {
          const b = neurons[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < CONFIG.maxLinkDistance && connections < 3) {
            links.push({ a: i, b: j });
            connections++;
          }
        }
      }
    }

    function emitPulses() {
      for (const link of links) {
        if (Math.random() < CONFIG.pulseChance) {
          pulses.push({
            link,
            t: 0,
            dir: Math.random() < 0.5 ? 1 : -1,
            speed: CONFIG.pulseSpeed * (0.7 + Math.random() * 0.8)
          });
        }
      }
    }

    function project(n) {
      const px = n.x + mouse.x * CONFIG.parallax * (n.z * 40);
      const py = n.y + mouse.y * CONFIG.parallax * (n.z * 40);
      return { x: px, y: py };
    }

    function draw() {
      ctx.fillStyle = 'rgba(8, 9, 10, 0.35)';
      ctx.fillRect(0, 0, W, H);

      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;

      const time = performance.now() * 0.001;

      // --- Links ---
      ctx.lineWidth = 1;
      for (const link of links) {
        const a = neurons[link.a];
        const b = neurons[link.b];
        if (!a || !b) continue;

        const pa = project(a);
        const pb = project(b);
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        if (d > CONFIG.maxLinkDistance) continue;

        const alpha = (1 - d / CONFIG.maxLinkDistance) * 0.20;
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // --- Synapse pulses ---
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const a = neurons[p.link.a];
        const b = neurons[p.link.b];
        if (!a || !b) { pulses.splice(i, 1); continue; }

        const pa = project(a);
        const pb = project(b);

        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }

        const tt = p.dir > 0 ? p.t : 1 - p.t;
        const x = pa.x + (pb.x - pa.x) * tt;
        const y = pa.y + (pb.y - pa.y) * tt;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, 10);
        grad.addColorStop(0, CONFIG.colors.pulse);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Neurons ---
      for (const n of neurons) {
        const p = project(n);
        const twinkle = 0.6 + 0.4 * Math.sin(time * 1.5 + n.pulse);

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, n.r * 6);
        grad.addColorStop(0, `rgba(255, 255, 255, ${0.4 * twinkle})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, n.r * 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = CONFIG.colors.neuron;
        ctx.beginPath();
        ctx.arc(p.x, p.y, n.r * twinkle, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function update() {
      for (const n of neurons) {
        n.x += n.vx;
        n.y += n.vy;

        if (n.x < -20) n.x = W + 20;
        if (n.x > W + 20) n.x = -20;
        if (n.y < -20) n.y = H + 20;
        if (n.y > H + 20) n.y = -20;
      }
    }

    function loop() {
      update();
      emitPulses();
      draw();
      requestAnimationFrame(loop);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', (e) => {
      mouse.tx = (e.clientX / W - 0.5) * 2;
      mouse.ty = (e.clientY / H - 0.5) * 2;
    });
    window.addEventListener('mouseleave', () => {
      mouse.tx = 0;
      mouse.ty = 0;
    });

    resize();
    ctx.fillStyle = '#08090a';
    ctx.fillRect(0, 0, W, H);
    loop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();