/* ============================================================
   SignSpeak — Dashboard Effects Layer
   Adds premium micro-animations without breaking translator.js
   ============================================================ */

(function () {
  'use strict';

  function init() {
    // ----------------------------------------------------
    // 1. STATUS TEXT REDIRECT (fixes waveform + text coexist)
    // ----------------------------------------------------
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    if (statusEl && statusText) {
      // Store original text value
      let _text = statusText.textContent;
      // Redefine textContent on statusEl so translator.js writes go to statusText
      Object.defineProperty(statusEl, 'textContent', {
        get() { return _text; },
        set(v) { _text = v; statusText.textContent = v; },
        configurable: true
      });
    }

    // ----------------------------------------------------
    // 2. CURSOR SPOTLIGHT on .spotlight-card
    // ----------------------------------------------------
    document.querySelectorAll('.spotlight-card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
      });
    });

    // ----------------------------------------------------
    // 3. BUTTON RIPPLE on all controls
    // ----------------------------------------------------
    document.querySelectorAll('.controls button').forEach(btn => {
      btn.addEventListener('click', function (e) {
        const rect = this.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;

        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });

    // ----------------------------------------------------
    // 4. PARTICLE BURST when a letter is captured
    //    Watch the letterPopup for the "show" class
    // ----------------------------------------------------
    const letterPopup = document.getElementById('letterPopup');
    if (letterPopup) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          if (m.attributeName === 'class' &&
              letterPopup.classList.contains('show')) {
            const rect = letterPopup.getBoundingClientRect();
            burstParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
          }
        });
      });
      observer.observe(letterPopup, { attributes: true });
    }

    function burstParticles(cx, cy) {
      const count = 24;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const dist = 100 + Math.random() * 120;
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
        p.style.animationDelay = (Math.random() * 0.1) + 's';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1400);
      }
    }

    // ----------------------------------------------------
    // 5. STATS BAR PULSE on change (fps, conf, handed)
    // ----------------------------------------------------
    ['fps', 'conf', 'handed'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      let lastVal = el.textContent;
      const mo = new MutationObserver(() => {
        if (el.textContent !== lastVal) {
          lastVal = el.textContent;
          el.classList.remove('pulse');
          void el.offsetWidth;
          el.classList.add('pulse');
        }
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
    });

    // ----------------------------------------------------
    // 6. BADGE BUMP when letter count changes
    // ----------------------------------------------------
    const badge = document.getElementById('letterCount');
    if (badge) {
      let lastVal = badge.textContent;
      const mo = new MutationObserver(() => {
        if (badge.textContent !== lastVal) {
          lastVal = badge.textContent;
          badge.classList.remove('bump');
          void badge.offsetWidth;
          badge.classList.add('bump');
        }
      });
      mo.observe(badge, { childList: true, characterData: true, subtree: true });
    }

    // ----------------------------------------------------
    // 7. SPOTLIGHT on video panel too
    // ----------------------------------------------------
    const videoPanel = document.querySelector('.video-panel');
    if (videoPanel) {
      videoPanel.addEventListener('mousemove', (e) => {
        const rect = videoPanel.getBoundingClientRect();
        videoPanel.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
        videoPanel.style.setProperty('--my', (e.clientY - rect.top) + 'px');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();