/* ============================================================
   Sign Translator — Sentence Panel Feature Layer
   Adds: live counters, recent chips, undo, copy, session stats
   ============================================================ */

(function () {
  'use strict';

  const MAX_RECENT = 6;
  const recentLetters = [];
  const historyStack = [];
  const sessionStats = {
    lettersSigned: 0,
    confidenceSum: 0,
    confidenceCount: 0,
    savedCount: 0
  };

  function $(id) { return document.getElementById(id); }

  // ----------------------------------------------------
  // 1. SENTENCE BOX PATCH
  //    Now observes the inner #sentenceText element
  //    (translator.js writes directly to it)
  // ----------------------------------------------------
  function patchSentenceBox() {
    const textSpan = $('sentenceText');
    if (!textSpan) return;

    const observer = new MutationObserver(() => {
      const text = textSpan.textContent || '';
      updateLiveCounters(text);
      updateUndoButton();
    });
    observer.observe(textSpan, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  // ----------------------------------------------------
  // 2. LIVE COUNTERS (letters / words / sentences)
  // ----------------------------------------------------
  function updateLiveCounters(text) {
    if (typeof text !== 'string') text = '';
    const lettersEl = $('statLetters');
    const wordsEl = $('statWords');
    const sentencesEl = $('statSentences');
    const badgeEl = $('letterCount');
    if (!lettersEl) return;

    const lettersOnly = text.replace(/\s/g, '').length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const sentences = text.trim() ? text.split(/[.!?]+/).filter(s => s.trim()).length : 0;

    lettersEl.textContent = lettersOnly;
    wordsEl.textContent = words;
    sentencesEl.textContent = sentences;

    if (badgeEl) badgeEl.textContent = lettersOnly + ' letters';
  }

  // ----------------------------------------------------
  // 3. RECENT CHIPS — watch letterPopup for new letters
  // ----------------------------------------------------
  function setupRecentChips() {
    const popup = $('letterPopup');
    const strip = $('recentStrip');
    const chips = $('recentChips');
    if (!popup || !strip || !chips) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.attributeName === 'class' && popup.classList.contains('show')) {
          const letter = (popup.textContent || '').trim();
          if (letter && letter !== 'CLEAR') addRecentChip(letter);
        }
      });
    });
    observer.observe(popup, { attributes: true });
  }

  function addRecentChip(letter) {
    const strip = $('recentStrip');
    const chips = $('recentChips');
    if (!strip || !chips) return;

    strip.classList.remove('hidden');

    historyStack.push(letter);
    if (historyStack.length > 100) historyStack.shift();

    sessionStats.lettersSigned++;
    const confEl = $('conf');
    if (confEl) {
      const c = parseInt(confEl.textContent, 10);
      if (!isNaN(c)) {
        sessionStats.confidenceSum += c;
        sessionStats.confidenceCount++;
      }
    }
    updateSessionStats();

    const chip = document.createElement('span');
    chip.className = 'recent-chip';
    chip.textContent = letter === 'Space' ? '␣' : (letter === 'Clear' ? 'CLR' : letter);
    chips.appendChild(chip);

    while (chips.children.length > MAX_RECENT) {
      chips.removeChild(chips.firstChild);
    }
  }

  // ----------------------------------------------------
  // 4. SESSION STATS UPDATE
  // ----------------------------------------------------
  function updateSessionStats() {
    const lEl = $('sessionLetters');
    const aEl = $('sessionAccuracy');
    const sEl = $('sessionSaved');
    if (lEl) lEl.textContent = sessionStats.lettersSigned;
    if (aEl) {
      const avg = sessionStats.confidenceCount
        ? Math.round(sessionStats.confidenceSum / sessionStats.confidenceCount)
        : 0;
      aEl.textContent = avg ? avg + '%' : '--%';
    }
    if (sEl) sEl.textContent = sessionStats.savedCount;
  }

  // ----------------------------------------------------
  // 5. UNDO BUTTON
  // ----------------------------------------------------
  function setupUndo() {
    const undoBtn = $('undoBtn');
    if (!undoBtn) return;

    undoBtn.addEventListener('click', doUndo);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      }
    });
  }

  function doUndo() {
    const textEl = $('sentenceText');
    const boxEl  = $('sentence');
    if (!textEl || !boxEl) return;

    const text = (textEl.textContent || '');
    if (!text) return;

    // Remove last character (and any trailing space)
    let newText = text.replace(/\s+$/, '');
    if (newText.length === 0) return;
    newText = newText.slice(0, -1);

    textEl.textContent = newText;
    boxEl.dataset.empty = newText ? 'false' : 'true';

    boxEl.classList.remove('ripple');
    void boxEl.offsetWidth;
    boxEl.classList.add('ripple');

    if (historyStack.length > 0) historyStack.pop();
    showToast('Undone');
    updateUndoButton();
  }

  function updateUndoButton() {
    const undoBtn = $('undoBtn');
    const textEl = $('sentenceText');
    if (!undoBtn || !textEl) return;
    const text = (textEl.textContent || '').trim();
    undoBtn.disabled = !text;
  }

  // ----------------------------------------------------
  // 6. COPY BUTTON
  // ----------------------------------------------------
  function setupCopy() {
    const copyBtn = $('copyBtn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', async () => {
      const textEl = $('sentenceText');
      const text = (textEl.textContent || '').trim();
      if (!text) {
        showToast('Nothing to copy', false);
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard');
      } catch (e) {
        showToast('Copy failed', false);
      }
    });
  }

  // ----------------------------------------------------
  // 7. SAVE COUNTER
  // ----------------------------------------------------
  function setupSaveCounter() {
    const saveBtn = $('saveBtn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', () => {
      sessionStats.savedCount++;
      updateSessionStats();
    });
  }

  // ----------------------------------------------------
  // 8. TOAST
  // ----------------------------------------------------
  let toastTimer;
  function showToast(msg, success = true) {
    let toast = document.getElementById('ss-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ss-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    const icon = success
      ? '<svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>'
      : '';
    toast.innerHTML = icon + '<span>' + msg + '</span>';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ----------------------------------------------------
  // 9. INIT
  // ----------------------------------------------------
  function init() {
    patchSentenceBox();
    setupRecentChips();
    setupUndo();
    setupCopy();
    setupSaveCounter();

    updateLiveCounters('');
    updateUndoButton();
    updateSessionStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();