// app.js — Aplicação principal Singfy
// Inicialização, roteamento, estado global, integração dos módulos

import { parseSongResponse, linesToHtml, linesToClassic, extractUniqueChords } from './parser.js';
import { transposeChord, transposeSong, getHarmonicField, detectKey, formatChord, generateTransposeButtons } from './transpose.js';
import { setlist, SetlistManager } from './setlist.js';
import { AutoRollPlayer, estimateDuration, TapTempo } from './player.js';
import { fetchSong, toSlug, isValidSlug } from './api.js';

// ===== Estado Global =====
const state = {
  currentScreen: 'search',
  currentSongData: null,        // { metadata, lines }
  currentTransposeMap: {},      // chordName -> transposedName
  currentTransposeSemitones: 0,
  player: null,
  tapTempo: new TapTempo(),
  wakeLock: null,
  isFullscreen: false
};

// ===== Elementos DOM (cache) =====
const els = {};

// ===== Inicialização =====
document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  restoreScreen();
  updateSetlistBadge();
  
  // Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  
  // Previne zoom em inputs no iOS
  document.addEventListener('touchstart', () => {}, { passive: true });
}

function cacheElements() {
  // Telas
  els.screenSearch = document.getElementById('screen-search');
  els.screenSetlist = document.getElementById('screen-setlist');
  els.screenShow = document.getElementById('screen-show');
  
  // Search
  els.searchForm = document.getElementById('search-form');
  els.inputArtist = document.getElementById('input-artist');
  els.inputSong = document.getElementById('input-song');
  els.btnSearch = document.getElementById('btn-search');
  els.searchResult = document.getElementById('search-result');
  els.searchError = document.getElementById('search-error');
  els.btnSetlist = document.getElementById('btn-setlist');
  els.setlistBadge = document.getElementById('setlist-badge');
  
  // Setlist
  els.btnBackSearch = document.getElementById('btn-back-search');
  els.setlistList = document.getElementById('setlist-list');
  els.setlistEmpty = document.getElementById('setlist-empty');
  els.btnClearSetlist = document.getElementById('btn-clear-setlist');
  els.btnStartShow = document.getElementById('btn-start-show');
  
  // Show
  els.showTopbar = document.getElementById('show-topbar');
  els.showBottombar = document.getElementById('show-bottombar');
  els.showScrollContainer = document.getElementById('show-scroll-container');
  els.showCifraContent = document.getElementById('show-cifra-content');
  els.showProgressFill = document.getElementById('show-progress-fill');
  els.showCurrentPosition = document.getElementById('show-current-position');
  els.showSongTitle = document.getElementById('show-song-title');
  els.showSongArtist = document.getElementById('show-song-artist');
  els.showPlayPause = document.getElementById('show-play-pause');
  els.iconPlay = document.getElementById('icon-play');
  els.iconPause = document.getElementById('icon-pause');
  els.showPrev = document.getElementById('show-prev');
  els.showNext = document.getElementById('show-next');
  els.showExit = document.getElementById('show-exit');
  els.speedDown = document.getElementById('speed-down');
  els.speedUp = document.getElementById('speed-up');
  els.speedValue = document.getElementById('speed-value');
  els.micToggle = document.getElementById('mic-toggle');
  els.transposeButtons = document.getElementById('transpose-buttons');
  
  // Toast
  els.toastContainer = document.getElementById('toast-container');
}

function bindEvents() {
  // Search
  els.searchForm.addEventListener('submit', handleSearch);
  els.btnSetlist.addEventListener('click', () => showScreen('setlist'));
  
  // Setlist
  els.btnBackSearch.addEventListener('click', () => showScreen('search'));
  els.btnClearSetlist.addEventListener('click', handleClearSetlist);
  els.btnStartShow.addEventListener('click', handleStartShow);
  els.setlistList.addEventListener('click', handleSetlistClick);
  
  // Drag & Drop setlist
  setupDragAndDrop();
  
  // Show
  els.showPlayPause.addEventListener('click', togglePlayPause);
  els.showPrev.addEventListener('click', handlePrevSong);
  els.showNext.addEventListener('click', handleNextSong);
  els.showExit.addEventListener('click', () => showScreen('setlist'));
  els.speedDown.addEventListener('click', () => adjustSpeed(-0.1));
  els.speedUp.addEventListener('click', () => adjustSpeed(0.1));
  els.micToggle.addEventListener('click', toggleMic);
  els.showScrollContainer.addEventListener('scroll', handleScroll);
  
  // Teclado
  document.addEventListener('keydown', handleKeydown);
  
  // Fullscreen change
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  
  // Visibilidade (pause ao sair)
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Wake lock
  els.showScrollContainer.addEventListener('click', requestWakeLock);
}

// ===== Navegação de Telas =====
function showScreen(screenName) {
  const screens = ['search', 'setlist', 'show'];
  screens.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('active', s === screenName);
  });
  
  state.currentScreen = screenName;
  
  if (screenName === 'show') {
    document.body.classList.add('show-mode');
    startShowMode();
  } else {
    document.body.classList.remove('show-mode');
    stopShowMode();
  }
  
  // Scroll para topo nas telas de lista
  if (screenName === 'search' || screenName === 'setlist') {
    window.scrollTo(0, 0);
  }
}

function restoreScreen() {
  // Sempre inicia na busca
  showScreen('search');
}

// ===== Busca de Cifra =====
async function handleSearch(e) {
  e.preventDefault();
  
  const artist = els.inputArtist.value.trim();
  const song = els.inputSong.value.trim();
  
  if (!artist || !song) {
    showToast('Preencha artista e música', 'error');
    return;
  }
  
  setSearchLoading(true);
  hideError();
  
  try {
    const artistSlug = toSlug(artist);
    const songSlug = toSlug(song);
    
    const data = await fetchSong(artistSlug, songSlug);
    const parsed = parseSongResponse(data);
    
    state.currentSongData = parsed;
    state.currentTransposeSemitones = 0;
    state.currentTransposeMap = {};
    
    renderPreview(parsed);
    showToast(`Encontrado: ${parsed.metadata.name} - ${parsed.metadata.artist}`, 'success');
  } catch (err) {
    showError(err.message);
    showToast('Não foi possível buscar a cifra', 'error');
  } finally {
    setSearchLoading(false);
  }
}

function setSearchLoading(loading) {
  els.btnSearch.disabled = loading;
  els.btnSearch.querySelector('.btn-text').textContent = loading ? 'Buscando...' : 'Buscar cifra';
  els.btnSearch.querySelector('.spinner').hidden = !loading;
}

function showError(msg) {
  els.searchError.textContent = msg;
  els.searchError.hidden = false;
  els.searchResult.hidden = true;
}

function hideError() {
  els.searchError.hidden = true;
}

function renderPreview(parsed) {
  const { metadata, lines } = parsed;
  const html = linesToClassic(lines);
  const uniqueChords = extractUniqueChords(lines);
  
  els.searchResult.innerHTML = `
    <div class="preview-card">
      <div class="preview-header">
        <div>
          <h3 class="preview-title">${escapeHtml(metadata.name)}</h3>
          <div class="preview-meta">
            <span class="meta-tag">${escapeHtml(metadata.artist)}</span>
            ${metadata.tom ? `<span class="meta-tag">Tom: ${escapeHtml(metadata.tom)}</span>` : ''}
            <span class="meta-tag">${uniqueChords.length} acordes</span>
          </div>
        </div>
      </div>
      <div class="preview-cifra">${html}</div>
      <div class="preview-actions">
        <button type="button" class="btn btn-primary" id="btn-add-setlist">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Adicionar ao Setlist
        </button>
        <button type="button" class="btn btn-ghost" id="btn-new-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          Nova busca
        </button>
      </div>
    </div>
  `;
  
  els.searchResult.hidden = false;
  
  // Eventos dos botões
  document.getElementById('btn-add-setlist').addEventListener('click', () => addToSetlist(parsed));
  document.getElementById('btn-new-search').addEventListener('click', () => {
    els.searchResult.hidden = true;
    els.inputArtist.value = '';
    els.inputSong.value = '';
    els.inputArtist.focus();
  });
}

function addToSetlist(parsed) {
  const song = setlist.add({
    metadata: parsed.metadata,
    lines: parsed.lines
  });
  
  updateSetlistBadge();
  renderSetlist();
  showScreen('setlist');
  showToast(`Adicionado: ${parsed.metadata.name}`, 'success');
}

// ===== Setlist UI =====
function updateSetlistBadge() {
  const count = setlist.getAll().length;
  els.setlistBadge.textContent = count;
  els.setlistBadge.hidden = count === 0;
}

function renderSetlist() {
  const songs = setlist.getAll();
  const currentIdx = setlist.getCurrentIndex();
  
  if (songs.length === 0) {
    els.setlistList.innerHTML = '';
    els.setlistEmpty.hidden = false;
    return;
  }
  
  els.setlistEmpty.hidden = true;
  
  els.setlistList.innerHTML = songs.map((song, idx) => {
    const effectiveKey = getEffectiveKeyForSong(song);
    const isCurrent = idx === currentIdx;
    
    return `
      <li class="setlist-item${isCurrent ? ' current' : ''}" data-id="${song.id}" draggable="true">
        <span class="setlist-drag" aria-label="Reordenar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
            <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
            <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
        </span>
        <div class="setlist-info">
          <div class="setlist-song-title">${escapeHtml(song.metadata.name)}</div>
          <div class="setlist-song-artist">${escapeHtml(song.metadata.artist)}</div>
          <div class="setlist-song-key">${effectiveKey || '—'}${song.transpose !== 0 ? ` (${song.transpose > 0 ? '+' : ''}${song.transpose})` : ''}</div>
        </div>
        <div class="setlist-actions">
          <button class="setlist-action transpose-down" data-action="transpose-down" aria-label="Transpor -½ tom" title="Descer ½ tom">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button class="setlist-action transpose-up" data-action="transpose-up" aria-label="Transpor +½ tom" title="Subir ½ tom">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          <button class="setlist-action play" data-action="play" aria-label="Tocar esta música" title="Iniciar show aqui">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
          </button>
          <button class="setlist-action delete" data-action="delete" aria-label="Remover do setlist">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </li>
    `;
  }).join('');
  
  // Eventos dos botões
  els.setlistList.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const li = btn.closest('.setlist-item');
      const id = li.dataset.id;
      handleSetlistAction(id, btn.dataset.action);
    });
  });
  
  // Click no item = editar/ver
  els.setlistList.querySelectorAll('.setlist-item > .setlist-info, .setlist-item > .setlist-drag').forEach(el => {
    el.addEventListener('click', (e) => {
      const li = e.currentTarget.closest('.setlist-item');
      const id = li.dataset.id;
      setlist.setCurrent(setlist.getAll().findIndex(s => s.id === id));
      renderSetlist();
    });
  });
}

function handleSetlistClick(e) {
  // Delegação para itens sem ação específica
}

function handleSetlistAction(id, action) {
  const song = setlist.getAll().find(s => s.id === id);
  if (!song) return;
  
  switch (action) {
    case 'transpose-up':
      setlist.setTranspose(id, song.transpose + 1);
      break;
    case 'transpose-down':
      setlist.setTranspose(id, song.transpose - 1);
      break;
    case 'play':
      setlist.setCurrent(setlist.getAll().findIndex(s => s.id === id));
      handleStartShow();
      return;
    case 'delete':
      setlist.remove(id);
      break;
  }
  
  updateSetlistBadge();
  renderSetlist();
}

function handleClearSetlist() {
  if (setlist.getAll().length === 0) return;
  if (confirm('Limpar todo o setlist?')) {
    setlist.clear();
    updateSetlistBadge();
    renderSetlist();
    showToast('Setlist limpo', 'info');
  }
}

// ===== Modo Show =====
function handleStartShow() {
  if (setlist.getAll().length === 0) {
    showToast('Setlist vazio', 'warning');
    return;
  }
  
  // Se nenhuma música selecionada, começa da primeira
  if (setlist.getCurrentIndex() === -1) {
    setlist.setCurrent(0);
  }
  
  showScreen('show');
}

function startShowMode() {
  loadCurrentSong();
  initPlayer();
  setupAutoHideBars();
  requestWakeLock();
}

function stopShowMode() {
  if (state.player) {
    state.player.stop();
    state.player = null;
  }
  releaseWakeLock();
}

function loadCurrentSong() {
  const song = setlist.currentSong();
  if (!song) return;
  
  state.currentSongData = {
    metadata: song.metadata,
    lines: song.lines
  };
  
  // Aplica transposição salva
  const semitones = song.transpose || 0;
  state.currentTransposeSemitones = semitones;
  
  if (semitones !== 0 && song.metadata.tom) {
    const { map } = transposeSong(song.lines, song.metadata.tom, transposeKeyBySemitones(song.metadata.tom, semitones));
    state.currentTransposeMap = map;
  } else {
    state.currentTransposeMap = {};
  }
  
  renderShowCifra();
  updateShowInfo();
  renderTransposeButtons();
}

function getEffectiveKeyForSong(song) {
  if (song.customKey) return song.customKey;
  const original = song.metadata?.tom;
  if (!original || song.transpose === 0) return original;
  return transposeKeyBySemitones(original, song.transpose);
}

function transposeKeyBySemitones(key, semitones) {
  if (!key) return null;
  const isMinor = key.endsWith('m');
  const base = key.replace('m', '');
  const NOTE_ORDER = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ENHARMONIC = {'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'};
  const n = ENHARMONIC[base] || base;
  const idx = NOTE_ORDER.indexOf(n);
  if (idx === -1) return key;
  return NOTE_ORDER[(idx + semitones + 12) % 12] + (isMinor ? 'm' : '');
}

function renderShowCifra() {
  if (!state.currentSongData) return;
  
  const html = linesToClassic(state.currentSongData.lines, state.currentTransposeMap);
  els.showCifraContent.innerHTML = html;
  
  // Atualiza player com nova altura
  if (state.player) {
    state.player.updateMaxScroll();
  }
}

function updateShowInfo() {
  const song = setlist.currentSong();
  const idx = setlist.getCurrentIndex();
  const total = setlist.getAll().length;
  
  els.showCurrentPosition.textContent = `${idx + 1} / ${total}`;
  els.showSongTitle.textContent = song?.metadata?.name || '—';
  els.showSongArtist.textContent = song?.metadata?.artist || '—';
}

function renderTransposeButtons() {
  const song = setlist.currentSong();
  const originalKey = song?.metadata?.tom || 'C';
  const currentKey = transposeKeyBySemitones(originalKey, state.currentTransposeSemitones);
  
  const buttons = generateTransposeButtons(currentKey, (semitones) => {
    applyTranspose(semitones);
  });
  
  els.transposeButtons.innerHTML = buttons.map(btn => `
    <button type="button" class="transpose-btn${btn.active ? ' active' : ''}" 
            data-semitones="${btn.semitones}" 
            aria-label="${btn.label} semitons"
            title="${btn.key}">
      ${btn.label}
    </button>
  `).join('');
  
  els.transposeButtons.querySelectorAll('.transpose-btn').forEach(b => {
    b.addEventListener('click', () => applyTranspose(parseInt(b.dataset.semitones, 10)));
  });
}

function applyTranspose(semitones) {
  const song = setlist.currentSong();
  if (!song || !song.metadata.tom) return;
  
  const newSemitones = semitones;
  const fromKey = song.metadata.tom;
  const toKey = transposeKeyBySemitones(fromKey, newSemitones);
  
  const { map } = transposeSong(song.lines, fromKey, toKey);
  state.currentTransposeMap = map;
  state.currentTransposeSemitones = newSemitones;
  
  // Salva na setlist
  setlist.setTranspose(song.id, newSemitones);
  
  renderShowCifra();
  renderTransposeButtons();
  updateShowInfo();
  showToast(`Tom: ${toKey}`, 'info');
}

// ===== Player =====
function initPlayer() {
  state.player = new AutoRollPlayer({
    container: els.showScrollContainer,
    duration: estimateDurationFromSong(setlist.currentSong()),
    onPositionChange: (progress) => {
      els.showProgressFill.style.height = `${progress * 100}%`;
    },
    onSongEnd: () => {
      handleNextSong();
    },
    onSilence: () => {
      // Silêncio detectado - opcional: auto-pular
      showToast('Silêncio detectado', 'info');
    },
    onSound: () => {
      // Som detectado
    },
    onMicError: (err) => {
      showToast('Microfone indisponível', 'warning');
      els.micToggle.classList.remove('active');
      els.micToggle.setAttribute('aria-pressed', 'false');
    }
  });
  
  // Atualiza controles
  updatePlayPauseIcon(false);
  els.speedValue.textContent = '1.0x';
}

function estimateDurationFromSong(song) {
  // Heurística: ~3 min por música, ou calcula por número de linhas
  if (!song) return 180;
  const lines = song.lines?.length || 30;
  return Math.max(60, Math.min(600, lines * 4)); // 4 seg por linha aprox
}

function togglePlayPause() {
  if (!state.player) return;
  
  if (state.player.isPlaying) {
    state.player.pause();
    updatePlayPauseIcon(false);
  } else {
    state.player.start();
    updatePlayPauseIcon(true);
    requestWakeLock();
  }
}

function updatePlayPauseIcon(playing) {
  els.iconPlay.hidden = playing;
  els.iconPause.hidden = !playing;
  els.showPlayPause.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
}

function adjustSpeed(delta) {
  if (!state.player) return;
  const newSpeed = Math.max(0.25, Math.min(3, state.player.speed + delta));
  state.player.setSpeed(newSpeed);
  els.speedValue.textContent = `${newSpeed.toFixed(1)}x`;
}

async function toggleMic() {
  if (!state.player) return;
  
  const currentlyEnabled = els.micToggle.classList.contains('active');
  await state.player.enableMic(!currentlyEnabled);
  
  els.micToggle.classList.toggle('active', !currentlyEnabled);
  els.micToggle.setAttribute('aria-pressed', !currentlyEnabled);
  
  showToast(!currentlyEnabled ? 'Microfone ativado' : 'Microfone desativado', 'info');
}

function handleScroll() {
  // Sincroniza player se usuário scrollou manualmente
  if (state.player && state.player.isPlaying) {
    const progress = els.showScrollContainer.scrollTop / (els.showScrollContainer.scrollHeight - els.showScrollContainer.clientHeight);
    state.player.seek(progress);
  }
}

function handlePrevSong() {
  const song = setlist.prev();
  if (song) {
    loadCurrentSong();
    if (state.player) {
      state.player.stop();
      updatePlayPauseIcon(false);
    }
    showToast(`Anterior: ${song.metadata.name}`, 'info');
  }
}

function handleNextSong() {
  const song = setlist.next();
  if (song) {
    loadCurrentSong();
    if (state.player) {
      state.player.start();
      updatePlayPauseIcon(true);
    }
    showToast(`Próxima: ${song.metadata.name}`, 'success');
  } else {
    // Fim do setlist
    if (state.player) {
      state.player.stop();
      updatePlayPauseIcon(false);
    }
    showToast('Fim do setlist! 🎉', 'success');
  }
}

// ===== Teclado =====
function handleKeydown(e) {
  // Atalhos globais
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  switch (e.key) {
    case 's':
    case 'S':
      if (state.currentScreen !== 'setlist') showScreen('setlist');
      break;
    case ' ':
      e.preventDefault();
      if (state.currentScreen === 'show') togglePlayPause();
      break;
    case 'ArrowRight':
      if (state.currentScreen === 'show') handleNextSong();
      break;
    case 'ArrowLeft':
      if (state.currentScreen === 'show') handlePrevSong();
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (state.currentScreen === 'show') adjustSpeed(0.1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (state.currentScreen === 'show') adjustSpeed(-0.1);
      break;
    case 't':
    case 'T':
      if (state.currentScreen === 'show') toggleMic();
      break;
    case 'Escape':
      if (state.currentScreen === 'show') showScreen('setlist');
      else if (state.currentScreen === 'setlist') showScreen('search');
      break;
    case 'f':
    case 'F':
      if (state.currentScreen === 'show') toggleFullscreen();
      break;
  }
  
  // Tap tempo (shift+space)
  if (e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    state.tapTempo.tap();
    const bpm = state.tapTempo.getBPM();
    if (bpm) {
      showToast(`BPM: ${bpm}`, 'info');
      if (state.player) {
        // Ajusta duração estimada baseado no BPM
        // Assumindo 4/4, ~120 compassos = duração
        const duration = estimateDuration(bpm, 120);
        state.player.setDuration(duration);
      }
    }
  }
}

// ===== Fullscreen & Wake Lock =====
async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
      state.isFullscreen = true;
    } catch (err) {
      console.warn('Fullscreen failed:', err);
    }
  } else {
    await document.exitFullscreen();
    state.isFullscreen = false;
  }
}

function handleFullscreenChange() {
  state.isFullscreen = !!document.fullscreenElement;
}

async function requestWakeLock() {
  if ('wakeLock' in navigator && !state.wakeLock) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    } catch (err) {
      console.warn('Wake lock failed:', err);
    }
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

function handleVisibilityChange() {
  if (document.hidden && state.player?.isPlaying) {
    // Opcional: pausar ao sair da aba
    // state.player.pause();
    // updatePlayPauseIcon(false);
  }
}

// ===== Auto-hide bars no modo show =====
function setupAutoHideBars() {
  let hideTimer;
  const bars = [els.showTopbar, els.showBottombar];
  
  function showBars() {
    bars.forEach(b => b.classList.remove('hidden'));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bars.forEach(b => b.classList.add('hidden')), 3000);
  }
  
  function hideBars() {
    bars.forEach(b => b.classList.add('hidden'));
  }
  
  els.showScrollContainer.addEventListener('mousemove', showBars);
  els.showScrollContainer.addEventListener('touchstart', showBars);
  els.showScrollContainer.addEventListener('scroll', showBars);
  
  // Inicia escondido após 3s
  hideTimer = setTimeout(hideBars, 3000);
}

// ===== Drag & Drop Setlist =====
function setupDragAndDrop() {
  let dragSrc = null;
  
  els.setlistList.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.setlist-item');
    if (!item) return;
    dragSrc = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  
  els.setlistList.addEventListener('dragend', (e) => {
    const item = e.target.closest('.setlist-item');
    if (item) item.classList.remove('dragging');
    dragSrc = null;
  });
  
  els.setlistList.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = e.target.closest('.setlist-item');
    if (item && item !== dragSrc) {
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        item.style.borderTop = '2px solid var(--accent)';
        item.style.borderBottom = '';
      } else {
        item.style.borderBottom = '2px solid var(--accent)';
        item.style.borderTop = '';
      }
    }
  });
  
  els.setlistList.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.setlist-item');
    if (item && !item.contains(e.relatedTarget)) {
      item.style.borderTop = '';
      item.style.borderBottom = '';
    }
  });
  
  els.setlistList.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.setlist-item');
    if (!target || !dragSrc || target === dragSrc) return;
    
    const songs = setlist.getAll();
    const fromIdx = songs.findIndex(s => s.id === dragSrc.dataset.id);
    let toIdx = songs.findIndex(s => s.id === target.dataset.id);
    
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY > midY) toIdx++;
    
    setlist.reorder(fromIdx, toIdx);
    renderSetlist();
  });
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Fechar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  els.toastContainer.appendChild(toast);
  
  // Auto-remove
  setTimeout(() => toast.remove(), 4000);
}

// ===== Utilidades =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

// ===== Service Worker Registration (para PWA offline) =====
// sw.js será criado separadamente