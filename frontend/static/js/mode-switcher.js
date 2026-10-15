/* ============================================================
   SignSpeak — Mode Switcher
   Toggles between "Sign to Text" and "Text to Sign" views
   ============================================================ */

(function () {
  'use strict';

  function init() {
    const switcher = document.getElementById('modeSwitcher');
    const pill = document.getElementById('modePill');
    const buttons = switcher ? switcher.querySelectorAll('.mode-btn') : [];
    const views = {
      'sign-to-text': document.getElementById('view-sign-to-text'),
      'text-to-sign': document.getElementById('view-text-to-sign')
    };

    if (!switcher || !pill || buttons.length === 0) return;

    // ----------------------------------------------------
    // Position the sliding pill under the active button
    // ----------------------------------------------------
    function positionPill(btn) {
      if (!btn) return;
      const switcherRect = switcher.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      pill.style.left = (btnRect.left - switcherRect.left) + 'px';
      pill.style.width = btnRect.width + 'px';
    }

    // ----------------------------------------------------
    // Activate a mode — toggles BOTH class AND hidden attribute
    // ----------------------------------------------------
    function setMode(mode) {
      // Toggle button states
      buttons.forEach((b) => {
        const isActive = b.dataset.mode === mode;
        b.classList.toggle('active', isActive);
        if (isActive) positionPill(b);
      });

      // Toggle view visibility — class + hidden attribute (double safety)
      Object.keys(views).forEach((key) => {
        const view = views[key];
        if (!view) return;

        if (key === mode) {
          view.classList.add('active');
          view.removeAttribute('hidden');
        } else {
          view.classList.remove('active');
          view.setAttribute('hidden', '');
        }
      });

      // Persist choice
      try { localStorage.setItem('ss-mode', mode); } catch (e) {}
    }

    // ----------------------------------------------------
    // Click handlers
    // ----------------------------------------------------
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    // ----------------------------------------------------
    // Restore saved mode (or default to sign-to-text)
    // ----------------------------------------------------
    let saved = 'sign-to-text';
    try { saved = localStorage.getItem('ss-mode') || saved; } catch (e) {}
    setMode(saved);

    // ----------------------------------------------------
    // Reposition pill on resize & after fonts load
    // ----------------------------------------------------
    window.addEventListener('resize', () => {
      const active = switcher.querySelector('.mode-btn.active');
      if (active) positionPill(active);
    });

    setTimeout(() => {
      const active = switcher.querySelector('.mode-btn.active');
      if (active) positionPill(active);
    }, 100);

    // Also reposition after webfonts are fully loaded
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        const active = switcher.querySelector('.mode-btn.active');
        if (active) positionPill(active);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();