// frontend/static/js/text-to-sign.js
// Converts text to a letter sequence, plays it on the 2D skeleton,
// speaks each letter (or "space"), then reads the full sentence at the end.

import { initHandAvatar, showLetter, hideHand } from './hand-avatar.js';

const MAX_LENGTH = 200;

let sequence = [];
let currentIndex = -1;
let isPlaying = false;
let playTimer = null;
let speedMs = 900;
let voiceEnabled = true;

// Full text the user typed (for the final sentence voice)
let originalText = "";

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
export async function initTextToSign() {
  const stageContainer = $('ttsStage');
  if (!stageContainer) {
    console.warn('[text-to-sign] #ttsStage not found');
    return;
  }

  await initHandAvatar(stageContainer);

  $('ttsConvertBtn')?.addEventListener('click', convert);
  $('ttsClearBtn')?.addEventListener('click', clearAll);
  $('ttsPlayBtn')?.addEventListener('click', play);
  $('ttsPauseBtn')?.addEventListener('click', pause);
  $('ttsPrevBtn')?.addEventListener('click', prev);
  $('ttsNextBtn')?.addEventListener('click', next);

  const speedSlider = $('ttsSpeed');
  if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
      speedMs = parseInt(e.target.value, 10);
      updateSpeedLabel();
    });
    updateSpeedLabel();
  }

  const voiceToggle = $('ttsVoiceToggle');
  if (voiceToggle) {
    voiceEnabled = voiceToggle.checked;
    voiceToggle.addEventListener('change', () => {
      voiceEnabled = voiceToggle.checked;
      if (!voiceEnabled) stopSpeaking();
      showToast(voiceEnabled ? 'Voice ON' : 'Voice OFF');
    });
  }

  const input = $('ttsInput');
  if (input) {
    input.addEventListener('input', () => {
      const counter = $('ttsCharCount');
      if (counter) counter.textContent = `${input.value.length}/${MAX_LENGTH}`;
    });
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        convert();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space' && sequence.length > 0) {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === 'ArrowRight') next();
    if (e.code === 'ArrowLeft') prev();
  });

  updateNavButtons();
}

function updateSpeedLabel() {
  const label = $('ttsSpeedLabel');
  if (label) {
    const perSec = (1000 / speedMs).toFixed(1);
    label.textContent = `${perSec}/s`;
  }
}

// ------------------------------------------------------------
// SPEECH
// ------------------------------------------------------------
let cachedVoice = null;
function pickVoice() {
  if (cachedVoice) return cachedVoice;
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  // Prefer an English voice
  cachedVoice = voices.find(v => v.lang && v.lang.startsWith('en')) || voices[0] || null;
  return cachedVoice;
}

function speak(text, rate = 1.0, pitch = 1.0) {
  if (!voiceEnabled) return;
  if (!('speechSynthesis' in window)) return;
  if (!text) return;

  // Cancel previous utterance so letters don't overlap
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate;
  utter.pitch = pitch;
  utter.volume = 0.9;

  const v = pickVoice();
  if (v) utter.voice = v;

  window.speechSynthesis.speak(utter);
}

function stopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// Speak the whole sentence word-by-word (natural reading)
function speakSentenceAtEnd() {
  if (!voiceEnabled) return;
  if (!originalText) return;

  // Normalize: collapse multiple spaces, keep single spaces between words
  const clean = originalText.replace(/\s+/g, ' ').trim();
  if (!clean) return;

  // Slightly slower, lower pitch so it sounds like a sentence read aloud
  speak(clean, 0.95, 1.0);
}

// ------------------------------------------------------------
// CONVERT
// ------------------------------------------------------------
function convert() {
  const input = $('ttsInput');
  const text = (input?.value || '').trim().toUpperCase();

  if (!text) {
    showToast('Type something first', false);
    return;
  }
  if (text.length > MAX_LENGTH) {
    showToast(`Max ${MAX_LENGTH} characters`, false);
    return;
  }

  pause();
  stopSpeaking();

  originalText = text;   // keep the full sentence for end voice

  sequence = [];
  for (const char of text) {
    if (char === ' ') {
      sequence.push('Space');
    } else if (/[A-Z]/.test(char)) {
      sequence.push(char);
    }
  }

  if (sequence.length === 0) {
    showToast('No valid letters found', false);
    return;
  }

  currentIndex = -1;
  renderStrip();
  updateStats();

  if (sequence.length > 0) {
    goTo(0, true);
  }

  const emptyMsg = $('ttsEmptyMsg');
  if (emptyMsg) emptyMsg.style.display = 'none';

  showToast(`Generated ${sequence.length} signs`);
}

// ------------------------------------------------------------
// STRIP
// ------------------------------------------------------------
function renderStrip() {
  const strip = $('ttsSequenceStrip');
  if (!strip) return;
  strip.innerHTML = '';

  sequence.forEach((letter, idx) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tts-chip';
    chip.dataset.index = idx;
    chip.textContent = letter === 'Space' ? '␣' : letter;
    if (letter === 'Space') chip.classList.add('is-space');
    chip.addEventListener('click', () => goTo(idx, true));
    strip.appendChild(chip);
  });
}

function highlightChip(idx) {
  const strip = $('ttsSequenceStrip');
  if (!strip) return;
  strip.querySelectorAll('.tts-chip').forEach((c, i) => {
    c.classList.toggle('is-active', i === idx);
  });
  const active = strip.querySelector('.tts-chip.is-active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

// ------------------------------------------------------------
// NAV
// ------------------------------------------------------------
function goTo(idx, speakNow = false) {
  if (idx < 0 || idx >= sequence.length) return;
  currentIndex = idx;

  const letter = sequence[idx];
  showLetter(letter);

  if (speakNow) {
    if (letter === 'Space') speak('space');
    else speak(letter);
  }

  highlightChip(idx);
  updateStageCaption(letter);
  updateProgress();
  updateNavButtons();
}

function next() {
  if (currentIndex < sequence.length - 1) goTo(currentIndex + 1, true);
}

function prev() {
  if (currentIndex > 0) goTo(currentIndex - 1, true);
}

function updateStageCaption(letter) {
  const caption = $('ttsStageCaption');
  if (!caption) return;
  if (letter === 'Space') caption.textContent = 'Space (word break)';
  else if (letter === 'Clear') caption.textContent = 'Clear';
  else caption.textContent = `Letter: ${letter}`;

  const letterEl = $('ttsStageLetter');
  if (letterEl) letterEl.textContent = letter === 'Space' ? '␣' : letter;
}

function updateProgress() {
  const bar = $('ttsProgressBar');
  if (!bar) return;
  const pct = sequence.length === 0 ? 0 : ((currentIndex + 1) / sequence.length) * 100;
  bar.style.width = pct + '%';
}

function updateStats() {
  const total = $('ttsStatTotal');
  const unique = $('ttsStatUnique');
  if (total) total.textContent = sequence.length;
  if (unique) unique.textContent = new Set(sequence).size;
}

function updateNavButtons() {
  const prevBtn = $('ttsPrevBtn');
  const nextBtn = $('ttsNextBtn');
  const playBtn = $('ttsPlayBtn');
  const pauseBtn = $('ttsPauseBtn');

  if (prevBtn) prevBtn.disabled = currentIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentIndex >= sequence.length - 1;
  if (playBtn) playBtn.disabled = sequence.length === 0 || isPlaying;
  if (pauseBtn) pauseBtn.disabled = !isPlaying;
}

// ------------------------------------------------------------
// PLAYBACK
// ------------------------------------------------------------
function play() {
  if (sequence.length === 0 || isPlaying) return;
  isPlaying = true;
  updateNavButtons();

  if (currentIndex >= sequence.length - 1) {
    goTo(0, true);
  } else {
    const letter = sequence[currentIndex];
    speak(letter === 'Space' ? 'space' : letter);
  }

  function tick() {
    if (!isPlaying) return;

    if (currentIndex >= sequence.length - 1) {
      // ---- END OF SEQUENCE ----
      isPlaying = false;
      clearTimeout(playTimer);
      playTimer = null;
      updateNavButtons();

      // Wait for the last letter's voice to finish, then read the sentence
      waitForVoicesThen(() => {
        if (!isPlaying) speakSentenceAtEnd();
      });
      return;
    }

    goTo(currentIndex + 1, true);
    playTimer = setTimeout(tick, speedMs);
  }

  playTimer = setTimeout(tick, speedMs);
}

function pause() {
  isPlaying = false;
  clearTimeout(playTimer);
  playTimer = null;
  stopSpeaking();
  updateNavButtons();
}

function togglePlay() {
  if (isPlaying) pause();
  else play();
}

// Wait until speechSynthesis is idle, then call cb
function waitForVoicesThen(cb) {
  if (!('speechSynthesis' in window)) { cb(); return; }
  if (!window.speechSynthesis.speaking) { setTimeout(cb, 150); return; }

  const check = () => {
    if (!window.speechSynthesis.speaking) {
      setTimeout(cb, 150);
    } else {
      setTimeout(check, 120);
    }
  };
  check();
}

// ------------------------------------------------------------
// CLEAR
// ------------------------------------------------------------
function clearAll() {
  pause();
  stopSpeaking();

  const input = $('ttsInput');
  if (input) input.value = '';

  sequence = [];
  currentIndex = -1;
  originalText = "";

  const strip = $('ttsSequenceStrip');
  if (strip) strip.innerHTML = '';

  hideHand();

  const caption = $('ttsStageCaption');
  if (caption) caption.textContent = 'Ready';

  const letterEl = $('ttsStageLetter');
  if (letterEl) letterEl.textContent = '';

  const bar = $('ttsProgressBar');
  if (bar) bar.style.width = '0%';

  const emptyMsg = $('ttsEmptyMsg');
  if (emptyMsg) emptyMsg.style.display = 'block';

  const counter = $('ttsCharCount');
  if (counter) counter.textContent = `0/${MAX_LENGTH}`;

  updateStats();
  updateNavButtons();
}

// ------------------------------------------------------------
// TOAST
// ------------------------------------------------------------
function showToast(msg, success = true) {
  let toast = document.getElementById('ss-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ss-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ------------------------------------------------------------
// AUTO INIT
// ------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTextToSign);
} else {
  initTextToSign();
}

// Warm-up: some browsers load voices asynchronously
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { cachedVoice = null; };
}