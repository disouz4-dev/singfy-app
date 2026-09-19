// app.js — Aplicação principal Singfy
// Inicialização, roteamento, estado global, integração dos módulos

import { parseSongResponse, linesToHtml, linesToClassic, extractUniqueChords, normalizeLines, isSectionLike } from './parser.js?v=20260918';
import { transposeChord, transposeSong, getHarmonicField, detectKey, formatChord, generateTransposeButtons } from './transpose.js';
import { setlist, SetlistManager } from './setlist.js';
import { AutoRollPlayer, estimateDuration, TapTempo, SPEED_STEP, clampSpeed } from './player.js?v=20260919';
import { fetchSong, toSlug, isValidSlug, isCifraLink, fetchSpotifyPlaylistTracks, extractSpotifyPlaylistId, spotifyTitleCandidates } from './api.js?v=20260918';
import { initAuth, signInWithGoogle, signOutUser, onAuthChange, getCurrentUser, isAuthenticated, setPostLoginHandler, onSetlistReady, registerWithEmail, loginWithEmail, resetPassword, setDisplayName, createPasswordForAccount } from './auth.js?v=20260905';
import { createSession, getInviteLink, checkUrlForSession, onSessionChange, joinSession, updateSessionPlayback, updateSessionSetlist, endSession, leaveSession } from './session.js';
import { VoiceSync } from './voicesync.js?v=20260224';
import { MidiController } from './midi.js?v=20260918';

// ===== Versão do App =====
const APP_VERSION = 'v1.5.1';

// ===== Estado Global =====
const state = {
  currentScreen: 'search',
  currentSongData: null,        // { metadata, lines }
  currentTransposeMap: {},      // chordName -> transposedName
  currentTransposeSemitones: 0,
  player: null,
  tapTempo: new TapTempo(),
  wakeLock: null,
  isFullscreen: false,
  cifraSize: loadPref('cifraSize', 18),   // tamanho da fonte da cifra (px)
  hideTabs: loadPref('hideTabs', true),    // tab ocultada por padrão
  lyricsOnly: false,                       // mostrar apenas a letra (sem acordes)
  savedSpeed: 1.0,                         // cache do último tempo (speed) da música atual
  voiceSync: null,                          // sincronização por voz (Web Speech API)
  midi: new MidiController(),               // controlador MIDI "chocolate"
  midiConnected: false
};

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem('singfy_' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function savePref(key, value) {
  try { localStorage.setItem('singfy_' + key, JSON.stringify(value)); } catch (e) {}
}

// ===== Elementos DOM (cache) =====
const els = {};

// ===== Inicialização =====
document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  setupCifraLinkInterceptor();
  
  // Mostra versão no rodapé em todas as telas
  document.querySelectorAll('.app-version').forEach(el => {
    el.textContent = `Singfy ${APP_VERSION}`;
  });
  
  // Mostra tela IMEDIATAMENTE (fallback visual)
  restoreScreen();
  updateSetlistBadge();
  
  // Habilita botão de login após cache
  if (els.btnLoginGoogle) {
    els.btnLoginGoogle.disabled = false;
  }
  
  try {
    // Navega para a home do usuário (setlist pessoal) assim que o login for
    // confirmado — direto após redirect, sem depender só do listener de estado
    setPostLoginHandler(() => {
      console.log('[singfy] postLoginHandler: usuário presente, navegando p/ setlist');
      if (state.currentScreen === 'login') showMySetlists();
    });
    
    // Inicializa autenticação (não bloqueia UI)
    await initAuth();
    
    // Modo sync: escuta a sessão, envia mudanças da setlist (host) e retoma
    // uma sessão ativa após recarregar a página
    onSessionChange(handleSessionUpdate);
    setlist.onChange = debounce(pushSessionSetlistIfChanged, 1000);
    setInterval(syncHeartbeat, SYNC_HEARTBEAT_MS);

    // Verifica se há sessão na URL (convite)
    const sessionId = checkUrlForSession();
    if (sessionId) {
      await joinSessionFromUrl(sessionId);
    } else {
      await resumeSync();
    }
    
    // Listener de auth
    onAuthChange(handleAuthChange);

    // Quando o setlist termina de carregar/sincronizar da nuvem, re-renderiza
    // a lista de setlists (importante para dispositivos com nuvem populada).
    onSetlistReady(() => {
      updateSetlistBadge();
      if (state.currentScreen === 'my-setlists') renderMySetlists();
      // Convite aberto antes do login: entra agora que a nuvem já carregou
      const pending = sessionStorage.getItem('pendingSessionId');
      if (pending && getCurrentUser()) joinSessionFromUrl(pending);
    });
  } catch (err) {
    console.error('Erro na autenticação (modo offline):', err);
    // Continua em modo convidado
  }
  
  // Service Worker desativado temporariamente p/ evitar cache quebrando módulos
  // if ('serviceWorker' in navigator) {
  //   navigator.serviceWorker.register('/sw.js').catch(() => {});
  // }
  
  // Previne zoom em inputs no iOS
  document.addEventListener('touchstart', () => {}, { passive: true });
}

function cacheElements() {
  // Telas
  els.screenLogin = document.getElementById('screen-login');
  els.screenSearch = document.getElementById('screen-search');
  els.screenMySetlists = document.getElementById('screen-my-setlists');
  els.screenSetlist = document.getElementById('screen-setlist');
  els.screenShow = document.getElementById('screen-show');
  
  // Login
  els.btnLoginGoogle = document.getElementById('btn-login-google');
  els.loginButtons = document.getElementById('login-buttons');
  els.tabLogin = document.getElementById('tab-login');
  els.tabRegister = document.getElementById('tab-register');
  els.formLogin = document.getElementById('form-login');
  els.formRegister = document.getElementById('form-register');
  els.authEmail = document.getElementById('auth-email');
  els.authPassword = document.getElementById('auth-password');
  els.btnAuthLogin = document.getElementById('btn-auth-login');
  els.btnAuthRegister = document.getElementById('btn-auth-register');
  els.btnAuthForgot = document.getElementById('btn-auth-forgot');
  els.btnAuthSetPassword = document.getElementById('btn-auth-set-password');
  els.regName = document.getElementById('reg-name');
  els.regEmail = document.getElementById('reg-email');
  els.regPassword = document.getElementById('reg-password');
  els.regPassword2 = document.getElementById('reg-password2');
  
  // Search
  els.gcseBox = document.getElementById('gcse-search-box');
  els.btnSetlist = document.getElementById('btn-setlist');
  els.setlistBadge = document.getElementById('setlist-badge');
  els.btnShareHome = document.getElementById('btn-share-home');
  
  // Minhas Setlists
  els.btnBackSearchML = document.getElementById('btn-back-search-ml');
  els.mySetlistsList = document.getElementById('my-setlists-list');
  els.mySetlistsEmpty = document.getElementById('my-setlists-empty');
  els.btnNewSetlistML = document.getElementById('btn-new-setlist-ml');
  els.btnEmptyNewSetlistML = document.getElementById('btn-empty-new-setlist-ml');

  // Setlist (detalhe)
  els.btnBackSetlist = document.getElementById('btn-back-setlist');
  els.setlistMeta = document.getElementById('setlist-meta');
  els.setlistMetaName = document.getElementById('setlist-meta-name');
  els.setlistMetaVenue = document.getElementById('setlist-meta-venue');
  els.setlistMetaDate = document.getElementById('setlist-meta-date');
  els.btnEditSetlist = document.getElementById('btn-edit-setlist');
  els.setlistList = document.getElementById('setlist-list');
  els.setlistMain = document.querySelector('#screen-setlist .setlist-main');
  els.setlistEmpty = document.getElementById('setlist-empty');
  els.btnClearSetlist = document.getElementById('btn-clear-setlist');
  els.btnNewSetlist = document.getElementById('btn-new-setlist');
  els.btnShareSession = document.getElementById('btn-share-session');
  els.btnStartShow = document.getElementById('btn-start-show');
  els.btnAddMusicEmpty = document.getElementById('btn-add-music-empty');
  els.btnAddMusic = document.getElementById('btn-add-music');

  // Modal de Setlist
  els.setlistModal = document.getElementById('setlist-modal');
  els.setlistModalTitle = document.getElementById('setlist-modal-title');
  els.setlistModalForm = document.getElementById('setlist-modal-form');
  els.setlistModalName = document.getElementById('setlist-name');
  els.setlistModalDate = document.getElementById('setlist-date');
  els.setlistModalVenue = document.getElementById('setlist-venue');
  els.setlistModalCancel = document.getElementById('setlist-modal-cancel');
  els.setlistModalSave = document.getElementById('setlist-modal-save');
  
  // Show
  els.showTopbar = document.getElementById('show-topbar');
  els.showBottombar = document.getElementById('show-bottombar');
  els.showScrollContainer = document.getElementById('show-scroll-container');
  els.showCifraContent = document.getElementById('show-cifra-content');
  els.showToggleLetra = document.getElementById('show-toggle-lettra');
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
  els.btnTapTempo = document.getElementById('btn-tap-tempo');
  els.btnMidi = document.getElementById('btn-midi');
  els.fontDown = document.getElementById('font-down');
  els.fontUp = document.getElementById('font-up');
  els.fontValue = document.getElementById('font-value');
  els.showHideTabs = document.getElementById('show-hide-tabs');
  els.micToggle = document.getElementById('mic-toggle');
  els.tomDec = document.getElementById('tom-dec');
  els.tomNote = document.getElementById('tom-note');
  els.tomInc = document.getElementById('tom-inc');
  
  els.inputCifraUrl = document.getElementById('input-cifra-url');
  els.btnFetchUrl = document.getElementById('btn-fetch-url');
  els.formUrlImport = document.getElementById('url-import');

  els.inputSpotifyUrl = document.getElementById('input-spotify-url');
  els.btnFetchSpotify = document.getElementById('btn-fetch-spotify');
  els.spotifyProgress = document.getElementById('spotify-progress');
  els.formSpotifyImport = document.getElementById('spotify-import');

  // Toast
  els.toastContainer = document.getElementById('toast-container');
}

function bindEvents() {
  // Login
  if (els.btnLoginGoogle) els.btnLoginGoogle.addEventListener('click', handleLoginGoogle);
  if (els.tabLogin) els.tabLogin.addEventListener('click', () => setAuthMode('login'));
  if (els.tabRegister) els.tabRegister.addEventListener('click', () => setAuthMode('register'));
  if (els.formLogin) els.formLogin.addEventListener('submit', (e) => { e.preventDefault(); handleEmailLogin(); });
  if (els.formRegister) els.formRegister.addEventListener('submit', (e) => { e.preventDefault(); handleEmailRegister(); });
  if (els.btnAuthForgot) els.btnAuthForgot.addEventListener('click', handleForgotPassword);
  if (els.btnAuthSetPassword) els.btnAuthSetPassword.addEventListener('click', handleSetPassword);
  
  // URL fetch
  if (els.btnFetchUrl) els.btnFetchUrl.addEventListener('click', handleFetchFromUrl);
  if (els.formUrlImport) els.formUrlImport.addEventListener('submit', (e) => { e.preventDefault(); handleFetchFromUrl(); });

  // Spotify playlist
  if (els.btnFetchSpotify) els.btnFetchSpotify.addEventListener('click', handleSpotifyImport);
  if (els.formSpotifyImport) els.formSpotifyImport.addEventListener('submit', (e) => { e.preventDefault(); handleSpotifyImport(); });
  
  // Search
  if (els.btnSetlist) els.btnSetlist.addEventListener('click', () => showMySetlists());
  if (els.btnShareHome) els.btnShareHome.addEventListener('click', handleShareSession);

  // Minhas Setlists
  if (els.btnBackSearchML) els.btnBackSearchML.addEventListener('click', () => showScreen('search'));
  if (els.btnNewSetlistML) els.btnNewSetlistML.addEventListener('click', () => openSetlistModal());
  if (els.btnEmptyNewSetlistML) els.btnEmptyNewSetlistML.addEventListener('click', () => openSetlistModal());
  if (els.mySetlistsList) els.mySetlistsList.addEventListener('click', handleMySetlistsClick);

  // Setlist (detalhe)
  if (els.btnBackSetlist) els.btnBackSetlist.addEventListener('click', () => showMySetlists());
  if (els.btnClearSetlist) els.btnClearSetlist.addEventListener('click', handleClearSetlist);
  if (els.btnNewSetlist) els.btnNewSetlist.addEventListener('click', () => openSetlistModal());
  if (els.btnEditSetlist) els.btnEditSetlist.addEventListener('click', () => openSetlistModal(setlist.getActive()));
  if (els.btnShareSession) els.btnShareSession.addEventListener('click', handleShareSession);
  const btnShareMeta = document.getElementById('btn-share-meta');
  if (btnShareMeta) btnShareMeta.addEventListener('click', handleShareSession);
  if (els.btnStartShow) els.btnStartShow.addEventListener('click', handleStartShow);
  if (els.btnAddMusicEmpty) els.btnAddMusicEmpty.addEventListener('click', () => { showGcseSearch(); showScreen('search'); });
  if (els.btnAddMusic) els.btnAddMusic.addEventListener('click', () => { showGcseSearch(); showScreen('search'); });
  if (els.setlistList) els.setlistList.addEventListener('click', handleSetlistClick);

  // Modal Nova/Editar Setlist
  if (els.setlistModalForm) els.setlistModalForm.addEventListener('submit', handleSetlistModalSubmit);
  if (els.setlistModalCancel) els.setlistModalCancel.addEventListener('click', closeSetlistModal);
  if (els.setlistModal) els.setlistModal.addEventListener('click', (e) => {
    if (e.target === els.setlistModal) closeSetlistModal();
  });
  
  // Drag & Drop setlist
  setupDragAndDrop();
  
  // Show
  if (els.showPlayPause) els.showPlayPause.addEventListener('click', togglePlayPause);
  if (els.showPrev) els.showPrev.addEventListener('click', handlePrevSong);
  if (els.showNext) els.showNext.addEventListener('click', handleNextSong);
  if (els.showExit) els.showExit.addEventListener('click', () => showScreen('setlist'));
  if (els.speedDown) els.speedDown.addEventListener('click', () => adjustSpeed(-SPEED_STEP));
  if (els.speedUp) els.speedUp.addEventListener('click', () => adjustSpeed(SPEED_STEP));
  if (els.btnTapTempo) els.btnTapTempo.addEventListener('click', handleTapTempo);
  if (els.btnMidi) els.btnMidi.addEventListener('click', handleMidiToggle);
  const syncBadge = document.getElementById('sync-badge');
  if (syncBadge) syncBadge.addEventListener('click', handleSyncBadgeClick);
  if (els.fontDown) els.fontDown.addEventListener('click', () => adjustFontSize(-1));
  if (els.fontUp) els.fontUp.addEventListener('click', () => adjustFontSize(1));
  if (els.showHideTabs) els.showHideTabs.addEventListener('click', toggleHideTabs);
  if (els.showToggleLetra) els.showToggleLetra.addEventListener('click', toggleLyricsOnly);
  if (els.tomDec) els.tomDec.addEventListener('click', () => applyTranspose(state.currentTransposeSemitones - 1));
  if (els.tomInc) els.tomInc.addEventListener('click', () => applyTranspose(state.currentTransposeSemitones + 1));
  if (els.tomNote) els.tomNote.addEventListener('click', cycleTom);
  if (els.micToggle) els.micToggle.addEventListener('click', toggleMic);
  if (els.showScrollContainer) els.showScrollContainer.addEventListener('scroll', handleScroll);
  
  // Salvamento na nuvem falhou (antes só aparecia no console)
  window.addEventListener('singfy:cloud-save-failed', (e) => {
    const reason = e.detail && e.detail.reason;
    showToast(reason === 'too-large'
      ? 'Suas setlists ficaram grandes demais para salvar na nuvem. Estão salvas só neste aparelho.'
      : 'Não foi possível salvar na nuvem. Suas alterações estão salvas neste aparelho.', 'warning');
  });

  // Teclado
  document.addEventListener('keydown', handleKeydown);
  
  // Fullscreen change
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  
  // Visibilidade (pause ao sair)
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Wake lock
  if (els.showScrollContainer) els.showScrollContainer.addEventListener('click', requestWakeLock);
}

// ===== Navegação de Telas =====
function showScreen(screenName) {
  const screens = ['login', 'search', 'my-setlists', 'setlist', 'show'];
  screens.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('active', s === screenName);
  });
  
  state.currentScreen = screenName;

  // Fecha teclado/foco ao trocar de tela (no celular um input da busca ainda
  // focado deixa a tela nova "travada" — o teclado cobre a página).
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  
  if (screenName === 'show') {
    document.body.classList.add('show-mode');
    startShowMode();
  } else {
    document.body.classList.remove('show-mode');
    stopShowMode();
  }
  
  // Scroll para topo nas telas de lista
  if (screenName === 'search' || screenName === 'setlist' || screenName === 'login') {
    window.scrollTo(0, 0);
  }
  // Reexibe o buscador do Google ao voltar para a busca
  if (screenName === 'search') {
    showGcseSearch();
  }
}

function restoreScreen() {
  // Inicia na tela de login
  showScreen('login');
}

// ===== Handlers de Autenticação =====

async function handleLoginGoogle() {
  try {
    els.btnLoginGoogle.disabled = true;
    els.btnLoginGoogle.querySelector('span').textContent = 'Entrando...';
    const user = await signInWithGoogle();
    if (user) {
      // Popup retorna o usuário direto — navega imediatamente
      showMySetlists();
    }
  } catch (err) {
    console.error('Erro no login:', err);
    showToast('Erro ao entrar com Google', 'error');
  } finally {
    els.btnLoginGoogle.disabled = false;
    els.btnLoginGoogle.querySelector('span').textContent = 'Entrar com Google';
  }
}

function setAuthMode(mode) {
  const isLogin = mode === 'login';
  if (els.tabLogin) els.tabLogin.classList.toggle('active', isLogin);
  if (els.tabRegister) els.tabRegister.classList.toggle('active', !isLogin);
  if (els.tabLogin) els.tabLogin.setAttribute('aria-selected', String(isLogin));
  if (els.tabRegister) els.tabRegister.setAttribute('aria-selected', String(!isLogin));
  if (els.formLogin) els.formLogin.hidden = !isLogin;
  if (els.formRegister) els.formRegister.hidden = isLogin;
}

async function handleEmailLogin() {
  const email = els.authEmail ? els.authEmail.value.trim() : '';
  const password = els.authPassword ? els.authPassword.value : '';
  if (!email || !password) {
    showToast('Preencha e-mail e senha', 'warning');
    return;
  }
  try {
    setEmailLoading(true);
    await loginWithEmail(email, password);
    showToast('Bem-vindo de volta!', 'success');
    // Navegação direta (fallback), além do onAuthStateChanged
    showMySetlists();
  } catch (err) {
    showToast(friendlyAuthError(err), 'error');
  } finally {
    setEmailLoading(false);
  }
}

async function handleEmailRegister() {
  const name = els.regName ? els.regName.value.trim() : '';
  const email = els.regEmail ? els.regEmail.value.trim() : '';
  const password = els.regPassword ? els.regPassword.value : '';
  const password2 = els.regPassword2 ? els.regPassword2.value : '';
  if (!name || !email || !password || !password2) {
    showToast('Preencha todos os campos', 'warning');
    return;
  }
  if (password.length < 6) {
    showToast('A senha deve ter pelo menos 6 caracteres', 'warning');
    return;
  }
  if (password !== password2) {
    showToast('As senhas não conferem', 'warning');
    return;
  }
  try {
    setEmailLoading(true);
    await registerWithEmail(email, password);
    if (name) await setDisplayName(name);
    showToast('Conta criada! Bem-vindo(a) ao Singfy', 'success');
    // Navegação direta (fallback), além do onAuthStateChanged
    showMySetlists();
  } catch (err) {
    if (err?.code === 'auth/email-already-in-use') {
      showToast('Este e-mail já tem uma conta. Faça login.', 'warning');
    } else {
      showToast(friendlyAuthError(err), 'error');
    }
  } finally {
    setEmailLoading(false);
  }
}

async function handleForgotPassword() {
  const email = els.authEmail ? els.authEmail.value.trim() : '';
  if (!email) {
    showToast('Digite seu e-mail acima', 'warning');
    return;
  }
  try {
    await resetPassword(email);
    showToast('E-mail de recuperação enviado!', 'success');
  } catch (err) {
    showToast(friendlyAuthError(err), 'error');
  }
}

// Cria uma senha para a conta do e-mail informado, sem precisar digitar senha
// sempre que entrar. Usado quando a conta existe só pelo Google: loga no
// Google UMA vez para provar que é você e vincula a senha digitada.
async function handleSetPassword() {
  const email = els.authEmail ? els.authEmail.value.trim() : '';
  const password = els.authPassword ? els.authPassword.value : '';
  if (!email || !password) {
    showToast('Digite seu e-mail e a senha que você quer usar', 'warning');
    return;
  }
  if (password.length < 6) {
    showToast('A senha deve ter pelo menos 6 caracteres', 'warning');
    return;
  }
  try {
    setEmailLoading(true);
    // Se já existe senha, o login direto funciona — nada a fazer.
    try {
      await loginWithEmail(email, password);
      showToast('Já era possível entrar com e-mail. Bem-vindo!', 'success');
      showMySetlists();
      return;
    } catch (e) {
      if (e?.code === 'auth/network-request-failed') throw e;
    }

    // Ainda não logado com Google nesta sessão: conecta uma vez para provar
    // que o e-mail é seu, e confere se é a MESMA conta.
    if (!getCurrentUser()) {
      const user = await signInWithGoogle();
      if (!user) return;
      if (String(user.email || '').toLowerCase() !== String(email).toLowerCase()) {
        showToast('Entre com a conta Google do mesmo e-mail digitado', 'error');
        return;
      }
    }

    await createPasswordForAccount(email, password);
    showToast('Senha criada! Agora é só entrar com e-mail e senha.', 'success');
    showMySetlists();
  } catch (err) {
    console.error('Erro ao criar senha:', err);
    if (err?.code === 'auth/email-already-in-use' || err?.code === 'auth/credential-already-in-use') {
      showToast('Este e-mail já tem senha. Use o botão "Entrar".', 'warning');
    } else if (err?.code === 'auth/requires-recent-login') {
      showToast('Entre com a sua conta do Google para confirmar que é você', 'warning');
    } else {
      showToast(friendlyAuthError(err), 'error');
    }
  } finally {
    setEmailLoading(false);
  }
}

function friendlyAuthError(err) {
  const map = {
    'auth/user-not-found': 'Conta não encontrada. Crie uma conta.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
    'auth/network-request-failed': 'Sem conexão. Tente novamente.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
    'auth/missing-password': 'Digite a senha.',
    'auth/operation-not-allowed': 'Login por e-mail desativado. Ative em Authentication → E-mail/Senha.',
    'auth/email-already-in-use': 'Este e-mail já tem uma conta. Faça login.',
    'auth/account-exists-with-different-credential': 'Este e-mail já tem conta com outro método (ex: Google).'
  };
  return map[err?.code] || 'Não foi possível concluir. Tente novamente.';
}

function setEmailLoading(loading) {
  if (els.btnAuthLogin) els.btnAuthLogin.disabled = loading;
  if (els.btnAuthRegister) els.btnAuthRegister.disabled = loading;
}

function updateAuthInputsLabel() {
  // Placeholder de confirmação após criar conta (limpa campo de senha)
  if (els.authPassword) els.authPassword.value = '';
}

async function handleLogout() {
  try {
    await signOutUser();
    showToast('Desconectado', 'info');
  } catch (err) {
    console.error('Erro no logout:', err);
  }
}

// ===== Handler URL Cifra =====

async function handleFetchFromUrl() {
  const url = els.inputCifraUrl.value.trim();
  if (!url) {
    showToast('Cole a URL da cifra', 'warning');
    return;
  }
  
  // Extrai artist/song da URL
  const match = url.match(/cifraclub\.com\.br\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    showToast('URL inválida. Use: https://www.cifraclub.com.br/artista/musica/', 'error');
    return;
  }
  
  const [, artist, song] = match;
  els.inputCifraUrl.value = '';
  
  setSearchLoading(true);
  hideError();
  
  try {
    const data = await fetchSong(artist, song);
    const parsed = parseSongResponse(data);
    state.currentSongData = parsed;
    state.currentTransposeSemitones = 0;
    state.currentTransposeMap = {};
    renderPreview(parsed);
  } catch (err) {
    showError(err.message);
    showToast('Não foi possível buscar a cifra', 'error');
  } finally {
    setSearchLoading(false);
  }
}
function handleAuthChange(user) {
  console.log('[singfy] handleAuthChange: user =', user ? user.email : null);
  if (user) {
    els.loginButtons.hidden = true;
    els.btnShareHome.hidden = false;
    // Navega para a home do usuário (setlist pessoal) após login
    if (state.currentScreen === 'login') {
      showMySetlists();
    }
  } else {
    els.loginButtons.hidden = false;
    els.btnShareHome.hidden = true;
    // Volta para login se deslogar
    if (state.currentScreen !== 'login') {
      showScreen('login');
    }
  }
}

async function joinSessionFromUrl(sessionId) {
  const { joinSession } = await import('./session.js');
  const { getCurrentUser } = await import('./auth.js?v=20260905');
  
  const user = getCurrentUser();
  if (!user) {
    // Retomado em onSetlistReady, depois do login + carga da nuvem
    sessionStorage.setItem('pendingSessionId', sessionId);
    showToast('Faça login para abrir o setlist compartilhado', 'info');
    return;
  }
  sessionStorage.removeItem('pendingSessionId');
  
  try {
    const result = await joinSession(sessionId, user.uid);
    // Já está nesta sessão (ex.: host abriu o próprio link, ou recarregou)
    if (state.sync && state.sync.sessionId === sessionId) {
      showToast('Você já está nesta sessão', 'info');
      return;
    }
    // Sessões antigas guardavam o setlist como string JSON
    let data = result.setlist;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = null; }
    }
    if (!data || !Array.isArray(data.songs)) throw new Error('Sessão sem setlist');
    // Nunca passa "playlists" adiante: import() faria importAll e apagaria
    // as setlists do convidado
    const { playlists, ...shared } = data;
    const { setlist } = await import('./setlist.js');
    if (!setlist.import(JSON.stringify(shared)) || setlist.getActive()?.songs.length === 0) {
      showToast('Este link é de uma versão antiga e veio sem as cifras. Peça um link novo.', 'warning');
      return;
    }
    setSync({
      sessionId,
      role: result.isHost ? 'host' : 'guest',
      playlistId: setlist.getActive().id,
      following: true,
      lastSeq: 0,
      setlistHash: hashString(JSON.stringify(result.setlist))
    });
    updateSetlistBadge();
    renderSetlist();
    showScreen('setlist');
    showToast(`Setlist "${shared.name || 'compartilhada'}" adicionada (${setlist.getActive().songs.length} músicas). Modo sync ativo: você acompanha o host.`, 'success');
    // Show já em andamento: entra direto na música/posição do host
    if (!result.isHost) {
      state.lastRemotePlayback = result.playback;
      applyRemotePlayback(result.playback);
    }
  } catch (err) {
    console.error('Erro ao entrar na sessão:', err);
    showToast('Sessão não encontrada ou expirada', 'error');
  }
}


// Intercepta cliques em links do Cifra Club dentro do gcse-search do Google
function setupCifraLinkInterceptor() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let href = a.getAttribute('href') || '';
    const qMatch = href.match(/[?&]q=([^&]+)/);
    if (qMatch) {
      try { href = decodeURIComponent(qMatch[1]); } catch (_) { href = qMatch[1]; }
    }
    if (/cifraclub\.com\.br\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      importCifraFromUrl(href);
    }
  }, true);
}

async function importCifraFromUrl(url) {
  if (!url) return;
  hideError();
  try {
    const match = url.match(/cifraclub\.com\.br\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      showToast('Link não é uma cifra do Cifra Club. Coloque na caixa de URL.', 'error');
      return;
    }
    const [, artist, song] = match;
    const data = await fetchSong(artist, song);
    const parsed = parseSongResponse(data);
    state.currentSongData = parsed;
    state.currentTransposeSemitones = 0;
    state.currentTransposeMap = {};
    renderPreview(parsed);
    clearGcseSearch();
  } catch (err) {
    showError(err.message);
    showToast('Não foi possível importar esta cifra', 'error');
  }
}

async function handleSpotifyImport() {
  const url = (els.inputSpotifyUrl && els.inputSpotifyUrl.value || '').trim();
  if (!url) { showToast('Cole o link da playlist do Spotify', 'error'); return; }

  const playlistId = extractSpotifyPlaylistId(url);
  if (!playlistId) { showToast('Link de playlist do Spotify inválido', 'error'); return; }

  hideError();
  if (els.btnFetchSpotify) els.btnFetchSpotify.disabled = true;
  if (els.spotifyProgress) {
    els.spotifyProgress.hidden = false;
    els.spotifyProgress.textContent = 'Lendo playlist...';
  }

  let tracks;
  try {
    tracks = await fetchSpotifyPlaylistTracks(playlistId);
  } catch (err) {
    showToast(err.message || 'Não foi possível ler a playlist', 'error');
    if (els.btnFetchSpotify) els.btnFetchSpotify.disabled = false;
    return;
  }

  if (!tracks.length) {
    showToast('Nenhuma faixa encontrada nesta playlist', 'error');
    if (els.btnFetchSpotify) els.btnFetchSpotify.disabled = false;
    return;
  }

  let ok = 0, fail = 0, dup = 0;
  const failedTracks = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (els.spotifyProgress) {
      els.spotifyProgress.textContent = `Buscando ${i + 1}/${tracks.length}: ${t.title}`;
    }
    try {
      let parsed = null, lastErr = null;
      for (const title of spotifyTitleCandidates(t.title)) {
        try {
          parsed = await fetchSong(t.mainArtist || t.artist, title);
          if (parsed && parsed.lines && parsed.lines.length > 0) break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!parsed && lastErr) throw lastErr;
      if (parsed && parsed.lines && parsed.lines.length > 0) {
        const added = addSongToSetlist(parsed);
        if (added) {
          ok++;
        } else {
          dup++;
        }
      } else {
        fail++;
        failedTracks.push(`${t.title} - ${t.artist}`);
        console.warn('Sem cifra válida para', t.title);
      }
    } catch (err) {
      fail++;
      failedTracks.push(`${t.title} - ${t.artist}`);
      console.warn('Falha ao buscar', t.title, err);
    }
  }

  try {
    if (els.spotifyProgress) {
      // Mostra quais não foram encontradas (antes só ia para o console)
      if (fail > 0) {
        els.spotifyProgress.textContent = `Não encontradas no Cifra Club (${fail}): ${failedTracks.join(' · ')}`;
      } else {
        els.spotifyProgress.hidden = true;
      }
    }
    if (els.btnFetchSpotify) els.btnFetchSpotify.disabled = false;
    renderSetlist();
    updateSetlistBadge();
    if (els.inputSpotifyUrl) els.inputSpotifyUrl.value = '';

    if (ok > 0) {
      showToast(`Playlist importada: ${ok} música(s) adicionada(s)${dup ? `, ${dup} já estavam` : ''}${fail ? `, ${fail} não encontrada(s)` : ''}`, 'success');
      showScreen('setlist');
    } else if (dup > 0 && fail === 0) {
      showToast(`Todas as músicas já estavam no setlist (${dup})`, 'info');
      showScreen('setlist');
    } else {
      showToast('Nenhuma música da playlist foi encontrada no Cifra Club', 'error');
    }
    if (fail > 0) console.warn('Não encontradas:', failedTracks.join(' | '));
  } catch (err) {
    console.warn('Erro ao finalizar importação', err);
  }
}

function addSongToSetlist(parsed) {
  const metadata = parsed.metadata || {
    name: parsed.name,
    artist: parsed.artist,
    tom: parsed.tom
  };
  const lines = normalizeLines(parsed.lines);
  return setlist.add({ metadata, lines });
}

function setSearchLoading(loading) {
  if (!els.btnSearch) return;
  els.btnSearch.disabled = loading;
  els.btnSearch.querySelector('.btn-text').textContent = loading ? 'Buscando...' : 'Buscar cifra';
  els.btnSearch.querySelector('.spinner').hidden = !loading;
}

function showError(msg) {
  showToast(msg, 'error');
}

function hideError() {
  // Sem contêiner dedicado de erro: mensagens vão por toast.
}

// Após importar/buscar uma cifra, adiciona diretamente à setlist e navega.
function renderPreview(parsed) {
  addToSetlist(parsed);
}

// Esconde o buscador do Google (usado após importar uma cifra)
function hideGcseSearch() {
  if (els.gcseBox) els.gcseBox.style.display = 'none';
  clearGcseResults();
}

// Mostra o buscador do Google de novo (já limpo)
function showGcseSearch() {
  if (!els.gcseBox) return;
  els.gcseBox.style.display = '';
  // Limpa após ficar visível para o CSE re-renderizar sem a última busca
  requestAnimationFrame(() => {
    clearGcseResults();
  });
}

// Tenta limpar os resultados do gcse-search (best-effort)
// getElement() recebe o NOME do buscador ("standard0"), não um índice — com
// getElement(0) nada era limpo e a última busca reaparecia.
function clearGcseResults() {
  try {
    if (window.google && google.search && google.search.cse) {
      const all = google.search.cse.element.getAllElements() || {};
      for (const el of Object.values(all)) {
        if (typeof el.prefillQuery === 'function') el.prefillQuery('');
        if (typeof el.clearAllResults === 'function') el.clearAllResults();
      }
    }
  } catch (_) {}
}

// Compatibilidade (mantém funcionando chamadas antigas)
function clearGcseSearch() {
  hideGcseSearch();
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
  const count = setlist.getAllPlaylists().reduce((sum, p) => sum + p.songCount, 0);
  els.setlistBadge.textContent = count;
  els.setlistBadge.hidden = count === 0;
}

function renderSetlistMeta() {
  const active = setlist.getActive();
  if (!active) {
    if (els.setlistMeta) els.setlistMeta.hidden = true;
    if (els.setlistEmpty) els.setlistEmpty.hidden = false;
    return false;
  }
  if (els.setlistMeta) els.setlistMeta.hidden = false;
  if (els.setlistMetaName) els.setlistMetaName.textContent = active.name || 'Sem nome';
  if (els.setlistMetaVenue) {
    els.setlistMetaVenue.textContent = active.venue || '';
    els.setlistMetaVenue.hidden = !active.venue;
  }
  if (els.setlistMetaDate) {
    els.setlistMetaDate.textContent = formatEventDate(active.eventDate);
    els.setlistMetaDate.hidden = !active.eventDate;
  }
  return true;
}

function formatEventDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function renderSetlist() {
  const songs = setlist.getAll();
  const currentIdx = setlist.getCurrentIndex();
  const hasActive = renderSetlistMeta();
  
  if (songs.length === 0) {
    els.setlistList.innerHTML = '';
    els.setlistEmpty.hidden = false;
    if (els.btnAddMusic) els.btnAddMusic.hidden = true;
    return;
  }
  
  els.setlistEmpty.hidden = true;
  if (els.btnAddMusic) els.btnAddMusic.hidden = false;
  
  els.setlistList.innerHTML = songs.map((song, idx) => {
    const meta = song && song.metadata ? song.metadata : {};
    const effectiveKey = getEffectiveKeyForSong(song);
    const isCurrent = idx === currentIdx;
    const title = meta.name ? meta.name : (song && song.title ? song.title : 'Sem nome');
    const artist = meta.artist ? meta.artist : (song && song.artist ? song.artist : 'Desconhecido');
    
    return `
      <li class="setlist-item${isCurrent ? ' current' : ''}" data-id="${song.id}" draggable="true">
        <span class="setlist-num" aria-hidden="true">${idx + 1}</span>
        <span class="setlist-drag" aria-label="Reordenar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
            <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
            <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
        </span>
        <div class="setlist-info">
          <div class="setlist-song-title">${escapeHtml(title)}</div>
          <div class="setlist-song-artist">${escapeHtml(artist)}</div>
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

  // Garante que a lista comece no topo após renderizar
  if (els.setlistMain) els.setlistMain.scrollTop = 0;
}

function handleSetlistClick(e) {
  const actionBtn = e.target.closest && e.target.closest('[data-action]');
  if (actionBtn) {
    const li = actionBtn.closest('.setlist-item');
    if (li && li.dataset.id) {
      handleSetlistAction(li.dataset.id, actionBtn.dataset.action);
    }
    return;
  }
  // Clique na área do item (info/drag) abre o modo show
  const item = e.target.closest && e.target.closest('.setlist-item');
  if (item && item.dataset.id) {
    const id = item.dataset.id;
    setlist.setCurrent(setlist.getAll().findIndex(s => s.id === id));
    updateSetlistBadge();
    handleStartShow();
  }
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
  if (confirm('Limpar todas as músicas desta setlist?')) {
    setlist.clear();
    updateSetlistBadge();
    renderSetlist();
    showToast('Setlist limpa', 'info');
  }
}

// ==== Minhas Setlists (visão geral) ====

function showMySetlists() {
  renderMySetlists();
  showScreen('my-setlists');
}

function renderMySetlists() {
  const playlists = setlist.getAllPlaylists();
  const empty = document.getElementById('my-setlists-empty');
  const list = document.getElementById('my-setlists-list');

  if (playlists.length === 0) {
    if (list) list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  list.innerHTML = playlists.map(p => `
    <div class="setlist-card" data-id="${p.id}">
      <div class="setlist-card-head">
        <h3 class="setlist-card-name">${escapeHtml(p.name)}</h3>
        <div class="setlist-card-actions">
          <button class="iconbtn setlist-card-share" data-action="share" title="Compartilhar com a banda" aria-label="Compartilhar setlist">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
          </button>
          <button class="iconbtn setlist-card-delete" data-action="delete" title="Excluir setlist" aria-label="Excluir setlist">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="setlist-card-meta">
        <span class="setlist-card-badge">${p.songCount} ${p.songCount === 1 ? 'música' : 'músicas'}</span>
        ${p.venue ? `<span class="setlist-card-venue">${escapeHtml(p.venue)}</span>` : ''}
        ${p.eventDate ? `<span class="setlist-card-date">${formatEventDate(p.eventDate)}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function handleMySetlistsClick(e) {
  const shareBtn = e.target.closest('[data-action="share"]');
  if (shareBtn) {
    e.stopPropagation();
    const id = shareBtn.closest('.setlist-card').dataset.id;
    // Compartilha a setlist do card (o compartilhamento usa a setlist ativa)
    setlist.setActive(id);
    updateSetlistBadge();
    handleShareSession();
    return;
  }
  const deleteBtn = e.target.closest('[data-action="delete"]');
  if (deleteBtn) {
    e.stopPropagation();
    const card = deleteBtn.closest('.setlist-card');
    const id = card.dataset.id;
    if (confirm('Excluir esta setlist? Esta ação não pode ser desfeita.')) {
      setlist.deletePlaylist(id);
      renderMySetlists();
      updateSetlistBadge();
      showToast('Setlist excluída', 'info');
    }
    return;
  }

  const card = e.target.closest('.setlist-card');
  if (card) {
    const id = card.dataset.id;
    setlist.setActive(id);
    renderSetlist();
    updateSetlistBadge();
    showScreen('setlist');
  }
}

// ==== Modal Nova / Editar Setlist ====

let editingSetlistId = null;

function openSetlistModal(playlist) {
  editingSetlistId = playlist ? playlist.id : null;
  if (els.setlistModalTitle) {
    els.setlistModalTitle.textContent = playlist ? 'Editar Setlist' : 'Nova Setlist';
  }
  if (els.setlistModalName) els.setlistModalName.value = playlist ? playlist.name : '';
  if (els.setlistModalDate) els.setlistModalDate.value = playlist ? (playlist.eventDate || '') : '';
  if (els.setlistModalVenue) els.setlistModalVenue.value = playlist ? (playlist.venue || '') : '';
  if (els.setlistModalSave) els.setlistModalSave.textContent = playlist ? 'Salvar' : 'Criar setlist';
  if (els.setlistModal) els.setlistModal.hidden = false;
  if (els.setlistModalName) setTimeout(() => els.setlistModalName.focus(), 50);
}

function closeSetlistModal() {
  if (els.setlistModal) els.setlistModal.hidden = true;
  editingSetlistId = null;
}

function handleSetlistModalSubmit(e) {
  e.preventDefault();
  const name = (els.setlistModalName.value || '').trim();
  const eventDate = els.setlistModalDate.value || '';
  const venue = (els.setlistModalVenue.value || '').trim();

  if (editingSetlistId) {
    setlist.updatePlaylist(editingSetlistId, {
      name: name || 'Sem nome',
      eventDate,
      venue
    });
    renderSetlist();
    updateSetlistBadge();
    showToast('Setlist atualizada', 'success');
  } else {
    if (!name) {
      showToast('Dê um nome à setlist', 'warning');
      return;
    }
    setlist.createPlaylist(name, eventDate, venue);
    renderSetlist();
    updateSetlistBadge();
    showScreen('setlist');
    showToast('Setlist criada', 'success');
  }
  closeSetlistModal();
}

async function handleShareSession() {
  const { createSession, getInviteLink } = await import('./session.js');
  const { getCurrentUser: getAuthUser } = await import('./auth.js?v=20260905');
  
  const user = getAuthUser();
  if (!user) {
    showToast('Faça login para compartilhar', 'warning');
    return;
  }
  
  // Já é host desta setlist: mostra o mesmo link (não cria outra sessão)
  if (state.sync && state.sync.role === 'host' && state.sync.playlistId === setlist.getActive()?.id) {
    showShareModal(getInviteLink(state.sync.sessionId));
    return;
  }
  
  const setlistData = setlist.exportForShare();
  if (setlistData.songs.length === 0) {
    showToast('Setlist vazia', 'warning');
    return;
  }
  // Documento do Firestore tem limite de 1 MiB
  if (new Blob([JSON.stringify(setlistData)]).size > 900 * 1024) {
    showToast('Setlist grande demais para compartilhar. Divida em duas.', 'error');
    return;
  }
  try {
    const sessionId = await createSession(user.uid, setlistData);
    const link = getInviteLink(sessionId);
    setSync({
      sessionId,
      role: 'host',
      playlistId: setlist.getActive().id,
      following: true,
      lastSeq: 0,
      setlistHash: hashString(JSON.stringify(setlistData))
    });
    broadcastPlayback();
    
    // Copia para clipboard (pode ser bloqueado no celular; o modal mostra o link)
    try {
      await navigator.clipboard.writeText(link);
      showToast('Link copiado! Envie para a banda', 'success');
    } catch (_) {}
    
    // Mostra modal com o link
    showShareModal(link);
  } catch (err) {
    console.error('Erro ao criar sessão:', err);
    showToast('Erro ao criar sessão', 'error');
  }
}

function showShareModal(link) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-labelledby="modal-title" aria-modal="true">
      <h3 id="modal-title">Compartilhar Setlist</h3>
      <p>Envie este link para os membros da banda entrarem na sessão:</p>
      <div class="modal-link">
        <input type="text" value="${link}" readonly id="modal-link-input">
        <button class="btn btn-ghost" id="modal-copy">Copiar</button>
      </div>
      <p class="modal-sync-info">Modo sync: você é o <strong>host</strong>. Play, pause, troca de música e velocidade são repetidos nos aparelhos da banda. Cada um escolhe se vê a cifra ou só a letra.${state.sync ? ` <br>Na sessão: <strong>${state.sync.participants || 1}</strong> aparelho(s).` : ''}</p>
      <div class="modal-actions">
        ${state.sync && state.sync.role === 'host' ? '<button class="btn btn-ghost danger" id="modal-end">Encerrar sessão</button>' : ''}
        <button class="btn btn-primary" id="modal-close">Fechar</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Focus e seleciona
  setTimeout(() => {
    const input = document.getElementById('modal-link-input');
    input.select();
  }, 50);
  
  modal.querySelector('#modal-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(link);
    showToast('Copiado!', 'success');
  });
  
  modal.querySelector('#modal-close').addEventListener('click', () => modal.remove());
  const endBtn = modal.querySelector('#modal-end');
  if (endBtn) endBtn.addEventListener('click', async () => {
    if (!confirm('Encerrar a sessão? A banda deixa de acompanhar você.')) return;
    modal.remove();
    await endSyncSession();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
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
  try {
    loadCurrentSong();
    applyCifraPrefs();
  } catch (err) {
    console.error('Erro ao carregar música no show mode:', err);
  }
  try {
    initPlayer();
  } catch (err) {
    console.error('Erro ao iniciar player:', err);
  }
  setupAutoHideBars();
  requestWakeLock();
  updateSyncBadge();
  broadcastPlayback();
}

function stopShowMode() {
  if (state.player) {
    state.player.stop();
    state.player = null;
  }
  if (state.voiceSync) state.voiceSync.stop();
  releaseWakeLock();
  broadcastPlayback();
}

function loadCurrentSong() {
  const song = setlist.currentSong();
  if (!song) return;
  
  state.currentSongData = {
    metadata: song.metadata,
    lines: song.lines
  };

  // Carrega a última velocidade registrada para esta música (rolagem ao vivo)
  state.savedSpeed = song.speed || 1.0;

  // Mantém o sincronizador de voz atualizado com a letra da música atual.
  if (state.voiceSync) state.voiceSync.setLyrics(song.lines || []);
  
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

  // Toda vez que uma música é carregada, a cifra aparece no topo
  if (els.showScrollContainer) els.showScrollContainer.scrollTop = 0;
  if (state.player) state.player.scrollTop = 0;
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
  return NOTE_ORDER[(((idx + semitones) % 12) + 12) % 12] + (isMinor ? 'm' : '');
}

function renderShowCifra() {
  if (!state.currentSongData) return;
  
  const html = linesToClassic(state.currentSongData.lines, state.currentTransposeMap);
  els.showCifraContent.innerHTML = html;
  markSectionLines();

  // Atualiza player com nova altura
  if (state.player) {
    state.player.updateMaxScroll();
  }
}

// Detecta linhas de seção (Verso, Refrão, Ponte, etc.) por heurística de
// texto e marca com a classe .cifra-section para dar destaque/espaçamento.
function markSectionLines() {
  const rows = els.showCifraContent.querySelectorAll('.cifra-line');
  rows.forEach(row => {
    const textEl = row.querySelector('.chunk .txt') || row.querySelector('.text-row') || row;
    const text = textEl ? textEl.textContent.trim() : '';
    if (isSectionLike(text)) {
      row.classList.add('cifra-section');
    }
  });
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
  if (els.tomNote) {
    els.tomNote.textContent = currentKey || 'C';
  }
}

// Cicla o tom pelos acordes do campo harmônico do tom original.
// Ao apertar a nota, o tom avança para o próximo acorde do campo
// harmônico (ex.: em C -> Dm -> Em -> F -> G -> Am -> B° ...).
function cycleTom() {
  const song = setlist.currentSong();
  const originalKey = song?.metadata?.tom || 'C';
  if (!originalKey) return;

  const isMinor = originalKey.endsWith('m');
  const field = getHarmonicField(originalKey, isMinor ? 'minor' : 'major');
  if (!field) return;

  // Extrai as notas raiz dos acordes do campo harmônico, na ordem.
  const roots = [];
  for (const deg of ['I','ii','iii','IV','V','vi','vii']) {
    const chord = field[deg] || field[deg.toLowerCase()];
    if (!chord) continue;
    const root = chord.replace(/[m\d°#b+\-()]/g, '');
    if (!roots.includes(root)) roots.push(root);
  }
  const fallback = isMinor ? ['C','D','D#','E','F','F#','G','G#','A','A#','B'] : roots;

  // Tom atual (a nota raiz, ignorando menor).
  const currentBase = originalKey.replace('m', '');
  const currentKey = transposeKeyBySemitones(originalKey, state.currentTransposeSemitones);
  const currentRoot = currentKey.replace('m', '');

  const list = roots.length ? roots : fallback;
  let idx = list.indexOf(currentRoot);
  if (idx === -1) idx = 0;
  const nextRoot = list[(idx + 1) % list.length];

  // Transpõe para que a nota original vire nextRoot (mesmo semitom preserva o modo).
  const semis = semitoneDistance(currentBase, nextRoot);
  applyTranspose(semis);
}

// Calcula distância em semitons entre duas notas (base, sem sufixo de menor).
function semitoneDistance(from, to) {
  const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ENH = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
  const f = ENH[from] || from;
  const t = ENH[to] || to;
  const fi = NOTES.indexOf(f);
  const ti = NOTES.indexOf(t);
  if (fi === -1 || ti === -1) return 0;
  return (ti - fi + 12) % 12;
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
    autoScroll: true,
    duration: estimateDurationFromSong(setlist.currentSong()),
    onPositionChange: (progress) => {
      els.showProgressFill.style.height = `${progress * 100}%`;
    },
    onSongEnd: () => {
      // Ao terminar a rolagem, para sem avançar automaticamente para a próxima música.
      updatePlayPauseIcon(false);
      broadcastPlayback();
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
  
  // Reaplica o último tempo (velocidade de rolagem) lembrado
  const saved = state.savedSpeed || 1.0;
  state.player.setSpeed(saved);
  
  // Atualiza controles
  updatePlayPauseIcon(false);
  els.speedValue.textContent = `${formatSpeed(state.player.speed)}`;
}

function estimateDurationFromSong(song) {
  // Heurística: ~3 min por música, ou calcula por número de linhas
  if (!song) return 180;
  const lines = song.lines?.length || 30;
  return Math.max(60, Math.min(600, lines * 4)); // 4 seg por linha aprox
}

function togglePlayPause() {
  if (!state.player || blockedByHost()) return;
  
  if (state.player.isPlaying) {
    state.player.pause();
    updatePlayPauseIcon(false);
  } else {
    state.player.start();
    updatePlayPauseIcon(true);
    requestWakeLock();
  }
  broadcastPlayback();
}

function updatePlayPauseIcon(playing) {
  els.iconPlay.hidden = playing;
  els.iconPause.hidden = !playing;
  els.showPlayPause.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
}

function rememberSpeed(speed) {
  state.savedSpeed = speed;
  const song = setlist.currentSong();
  if (song && song.id) setlist.setSpeed(song.id, speed);
}

// Aplica ao player a última velocidade registrada para a música atual.
function applyCurrentSpeed() {
  if (!state.player) return;
  state.player.setSpeed(state.savedSpeed);
  els.speedValue.textContent = `${formatSpeed(state.player.speed)}`;
}

// 1.25 -> "1.25x", 1.5 -> "1.5x", 2 -> "2x"
function formatSpeed(speed) {
  return `${Number(speed.toFixed(2))}x`;
}

function adjustSpeed(delta) {
  if (!state.player || blockedByHost()) return;
  const newSpeed = clampSpeed(state.player.speed + delta);
  state.player.setSpeed(newSpeed);
  els.speedValue.textContent = `${formatSpeed(newSpeed)}`;
  rememberSpeed(newSpeed);
  broadcastPlayback();
}

function handleTapTempo() {
  if (!state.player || blockedByHost()) return;
  state.tapTempo.tap();
  const bpm = state.tapTempo.getBPM();
  if (bpm) {
    const speed = clampSpeed(bpm / 120);
    state.player.setSpeed(speed);
    els.speedValue.textContent = `${formatSpeed(speed)}`;
    rememberSpeed(speed);
    broadcastPlayback();
    showToast(`BPM: ${bpm}`, 'info');
  } else {
    showToast('Toque novamente para definir o andamento', 'info');
  }
}

function handleMidiToggle() {
  if (state.midiConnected) {
    state.midi.disconnect();
    state.midiConnected = false;
    state.midi.onDisconnect = null;
    hideMidiDebug();
    if (els.btnMidi) {
      els.btnMidi.classList.remove('active');
      els.btnMidi.setAttribute('aria-pressed', 'false');
    }
    showToast('MIDI desconectado', 'info');
    return;
  }
  state.midi.onDisconnect = handleMidiDisconnect;
  state.midi.connect()
    .then(async (result) => {
      state.midiConnected = true;
      state.midi.onCommand = handleMidiCommand;
      state.midi.onMidiPacket = handleMidiPacket;
      if (els.btnMidi) {
        els.btnMidi.classList.add('active');
        els.btnMidi.setAttribute('aria-pressed', 'true');
      }
      if (result.transport === 'bluetooth') {
        showToast(`MIDI via Bluetooth (${result.device})`, 'success');
        const dbg = document.getElementById('midi-debug');
        if (dbg) {
          dbg.hidden = false;
          dbg.textContent = 'MIDI conectado: ' + result.device + ' — verificando...';
        }
        let st = '';
        try { st = await state.midi.bleNotifyStatus(); } catch (_) {}
        if (dbg) dbg.textContent = 'MIDI conectado: ' + result.device + ' — ' + st;
      } else {
        const names = (result.inputs || []).slice(0, 3).join(', ');
        showToast(`MIDI: ${names || result.inputs.length + ' entrada'}`, 'success');
      }
    })
    .catch((err) => {
      state.midi.onDisconnect = null;
      showToast('Falha ao conectar MIDI: ' + (err && err.message ? err.message : 'erro'), 'error');
    });
}

function handleMidiDisconnect() {
  state.midiConnected = false;
  hideMidiDebug();
  if (els.btnMidi) {
    els.btnMidi.classList.remove('active');
    els.btnMidi.setAttribute('aria-pressed', 'false');
  }
  showToast('Controle MIDI desconectado (Bluetooth caiu)', 'warning');
}

function fmtHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Mostra o último pacote Bluetooth recebido + decode na barra de diagnóstico
function handleMidiPacket(u8, messages, label) {
  const dbg = document.getElementById('midi-debug');
  if (!dbg) return;
  const parts = [`${label || 'bt'} ${fmtHex(u8)}`];
  if (messages && messages.length) {
    parts.push('→ ' + messages.map((m) => fmtHex(Uint8Array.from(m))).join(' + '));
    if (state.lastMidiCommand) parts.push('⇒ ' + state.lastMidiCommand);
  } else {
    parts.push('→ sem msg MIDI');
  }
  dbg.textContent = 'MIDI ' + parts.join(' ');
  dbg.hidden = false;
  if (messages && messages.length) {
    showToast('MIDI: ' + (state.lastMidiCommand || 'recebido'), 'success');
  } else {
    showToast('MIDI: pacote sem comando (' + fmtHex(u8) + ')', 'warning');
  }
}

function hideMidiDebug() {
  const dbg = document.getElementById('midi-debug');
  if (dbg) dbg.hidden = true;
}

function handleMidiCommand(command) {
  state.lastMidiCommand = command || null;
  // Comandos MIDI só fazem sentido no show mode
  if (state.currentScreen !== 'show') return;
  switch (command) {
    case 'play':
      if (blockedByHost()) break;
      if (state.player && !state.player.isPlaying) {
        state.player.start();
        updatePlayPauseIcon(true);
        requestWakeLock();
        broadcastPlayback();
      }
      break;
    case 'stop':
      if (blockedByHost()) break;
      if (state.player && state.player.isPlaying) {
        state.player.pause();
        updatePlayPauseIcon(false);
        broadcastPlayback();
      }
      break;
    case 'hideChords':
      state.lyricsOnly = true;
      applyCifraPrefs();
      if (state.player) state.player.updateMaxScroll();
      break;
    case 'showChords':
      state.lyricsOnly = false;
      applyCifraPrefs();
      if (state.player) state.player.updateMaxScroll();
      break;
    case 'speedDown':
      adjustSpeed(-SPEED_STEP);
      break;
    case 'speedUp':
      adjustSpeed(SPEED_STEP);
      break;
    case 'prevSong':
      handlePrevSong();
      break;
    case 'nextSong':
      handleNextSong();
      break;
  }
}

function adjustFontSize(delta) {
  state.cifraSize = Math.max(12, Math.min(34, state.cifraSize + delta));
  savePref('cifraSize', state.cifraSize);
  applyCifraPrefs();
}

function toggleHideTabs() {
  state.hideTabs = !state.hideTabs;
  savePref('hideTabs', state.hideTabs);
  applyCifraPrefs();
}

// Aplica tamanho de fonte, ocultação de tabs e modo só-letra no container da cifra
function applyCifraPrefs() {
  if (els.showScrollContainer) {
    els.showScrollContainer.style.setProperty('--cifra-size', state.cifraSize + 'px');
    els.showScrollContainer.classList.toggle('hide-tabs', state.hideTabs);
    els.showScrollContainer.classList.toggle('lyrics-only', state.lyricsOnly);
  }
  if (els.fontValue) els.fontValue.textContent = String(state.cifraSize);
  if (els.showHideTabs) {
    const hiding = state.hideTabs;
    els.showHideTabs.classList.toggle('active', hiding);
    els.showHideTabs.setAttribute('aria-pressed', String(hiding));
    els.showHideTabs.textContent = hiding ? 'Mostrar tab' : 'Ocultar tab';
  }
  if (els.showToggleLetra) {
    els.showToggleLetra.classList.toggle('active', state.lyricsOnly);
    els.showToggleLetra.setAttribute('aria-pressed', String(state.lyricsOnly));
    els.showToggleLetra.textContent = 'Ocultar cifra';
  }
}

function toggleLyricsOnly() {
  state.lyricsOnly = !state.lyricsOnly;
  applyCifraPrefs();
  if (state.player) state.player.updateMaxScroll();
  showToast(state.lyricsOnly ? 'Mostrando apenas a letra' : 'Mostrando cifra e letra', 'info');
}

async function toggleMic() {
  if (!state.player) return;

  const currentlyEnabled = els.micToggle.classList.contains('active');
  const enable = !currentlyEnabled;

  // Sincronização por voz via Web Speech API (se disponível).
  if (!state.voiceSync) state.voiceSync = new VoiceSync({
    onLine: (lineIdx, lyric) => {
      if (els.showScrollContainer) {
        syncScrollToLine(lineIdx);
      }
    }
  });

  const speechOk = state.voiceSync.isSupported();
  if (enable) {
    const song = setlist.currentSong();
    if (song) state.voiceSync.setLyrics(song.lines || []);
    if (speechOk) {
      state.voiceSync.start();
    } else if (!state.player.isPlaying) {
      showToast('Reconhecimento de voz indisponível (use Chrome/Android)', 'warning');
    }
  } else {
    state.voiceSync.stop();
  }

  await state.player.enableMic(enable);

  els.micToggle.classList.toggle('active', enable);
  els.micToggle.setAttribute('aria-pressed', String(enable));
  els.micToggle.querySelector('.mic-label').textContent = enable ? 'Voz' : 'Mic';

  showToast(enable ? 'Microfone ativado' : 'Microfone desativado', 'info');
}

// Rola o container do show até a linha correspondente.
function syncScrollToLine(lineIdx) {
  const container = els.showScrollContainer;
  if (!container) return;
  const rows = container.querySelectorAll('.cifra-line');
  const row = rows[lineIdx];
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (state.player && state.player.isPlaying) {
      const progress = container.scrollTop / (container.scrollHeight - container.clientHeight);
      state.player.seek(progress);
    }
  }
}

function handleScroll() {
  // Host parado rolando a cifra: a banda acompanha a posição
  if (state.player && !state.player.isPlaying && state.sync && state.sync.role === 'host') {
    debouncedScrollBroadcast();
  }
  // Sincroniza player se usuário scrollou manualmente
  if (state.player && state.player.isPlaying) {
    const progress = els.showScrollContainer.scrollTop / (els.showScrollContainer.scrollHeight - els.showScrollContainer.clientHeight);
    state.player.seek(progress);
  }
}

function handlePrevSong() {
  if (blockedByHost()) return;
  const song = setlist.prev();
  if (song) {
    loadCurrentSong();
    applyCurrentSpeed();
    if (state.player) {
      state.player.stop();
      state.player.setDuration(estimateDurationFromSong(song));
      updatePlayPauseIcon(false);
    }
    state.tapTempo.reset();
    broadcastPlayback();
    showToast(`Anterior: ${song.metadata.name}`, 'info');
  }
}

function handleNextSong() {
  if (blockedByHost()) return;
  const song = setlist.next();
  if (song) {
    loadCurrentSong();
    applyCurrentSpeed();
    if (state.player) {
      // Fica pausado após trocar de música; o play é feito manualmente (botão/pedal MIDI).
      state.player.stop();
      state.player.setDuration(estimateDurationFromSong(song));
      updatePlayPauseIcon(false);
    }
    state.tapTempo.reset();
    broadcastPlayback();
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
// Pedais/passadores de página Bluetooth em modo teclado mandam
// PageUp/PageDown, setas, Espaço ou Enter.
const SHOW_KEY_ACTIONS = {
  ' ': 'playPause',
  'Enter': 'playPause',
  'MediaPlayPause': 'playPause',
  'ArrowRight': 'next',
  'PageDown': 'next',
  'MediaTrackNext': 'next',
  'ArrowLeft': 'prev',
  'PageUp': 'prev',
  'MediaTrackPrevious': 'prev',
  'ArrowUp': 'speedUp',
  'ArrowDown': 'speedDown'
};

function handleKeydown(e) {
  // Atalhos globais
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  
  // Tap tempo (shift+space) — tratado antes para não disparar play/pause junto
  if (e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    handleTapTempo();
    return;
  }
  
  const action = state.currentScreen === 'show' ? SHOW_KEY_ACTIONS[e.key] : null;
  if (action) {
    // Evita que Espaço/Enter também "cliquem" o botão focado (ação dupla)
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    // Pedal segurado não deve pular várias músicas
    if (e.repeat && (action === 'next' || action === 'prev' || action === 'playPause')) return;
    if (action === 'playPause') togglePlayPause();
    else if (action === 'next') handleNextSong();
    else if (action === 'prev') handlePrevSong();
    else if (action === 'speedUp') adjustSpeed(SPEED_STEP);
    else if (action === 'speedDown') adjustSpeed(-SPEED_STEP);
    return;
  }
  if (e.key === ' ') e.preventDefault();
  
  switch (e.key) {
    case 's':
    case 'S':
      if (state.currentScreen !== 'my-setlists' && state.currentScreen !== 'setlist' && state.currentScreen !== 'login') showMySetlists();
      break;
    case 't':
    case 'T':
      if (state.currentScreen === 'show') toggleMic();
      break;
    case 'Escape':
      if (state.currentScreen === 'show') showScreen('setlist');
      else if (state.currentScreen === 'setlist') showMySetlists();
      break;
    case 'f':
    case 'F':
      if (state.currentScreen === 'show') toggleFullscreen();
      break;
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
// ===== Modo Sync (banda acompanha o host) =====
// O host publica na sessão o estado de reprodução; os integrantes aplicam.
// Individual (não sincroniza): cifra/só letra, tamanho da fonte, tabs.
const SYNC_STORAGE_KEY = 'singfy_sync_v1';
const SYNC_HEARTBEAT_MS = 5000;   // host reenvia a posição enquanto toca
const SYNC_SEEK_TOLERANCE_S = 0.3; // integrante corrige se desviar > 0,3 s

// Hash curto (djb2) para detectar mudança na setlist sem guardar o JSON inteiro
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0) + ':' + str.length;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const debouncedScrollBroadcast = debounce(() => broadcastPlayback(), 800);

function setSync(sync) {
  state.sync = sync;
  try {
    if (sync) localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(sync));
    else localStorage.removeItem(SYNC_STORAGE_KEY);
  } catch (_) {}
  updateSyncBadge();
}

function saveSync() {
  if (state.sync) setSync(state.sync);
}

function clearSync(message) {
  if (!state.sync) return;
  setSync(null);
  if (message) showToast(message, 'info');
}

// Retoma a sessão salva após recarregar a página
async function resumeSync() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY)); } catch (_) {}
  const user = getCurrentUser();
  if (!saved || !saved.sessionId || !user) return;
  if (!setlist.getPlaylist(saved.playlistId)) { setSync(null); return; }
  try {
    const result = await joinSession(saved.sessionId, user.uid);
    setSync({ ...saved, role: result.isHost ? 'host' : 'guest', lastSeq: 0 });
    if (!result.isHost && state.sync.following) {
      state.lastRemotePlayback = result.playback;
      applyRemotePlayback(result.playback);
    }
  } catch (err) {
    setSync(null); // sessão encerrada ou inexistente
  }
}

// Integrante seguindo o host não controla a reprodução
function isFollowingHost() {
  return !!(state.sync && state.sync.role === 'guest' && state.sync.following);
}

function blockedByHost() {
  if (!isFollowingHost() || state.currentScreen !== 'show') return false;
  showToast('Modo sync: quem controla é o host', 'info');
  return true;
}

function isSessionPlaylistActive() {
  return !!(state.sync && setlist.getActive()?.id === state.sync.playlistId);
}

function currentPlayerProgress() {
  if (state.player) return state.player.getProgress();
  const c = els.showScrollContainer;
  if (!c) return 0;
  const max = c.scrollHeight - c.clientHeight;
  return max > 0 ? Math.min(1, c.scrollTop / max) : 0;
}

// ---- Host ----
function broadcastPlayback() {
  const sync = state.sync;
  if (!sync || sync.role !== 'host' || !isSessionPlaylistActive()) return;
  const inShow = state.currentScreen === 'show';
  const p = state.player;
  updateSessionPlayback({
    active: inShow,
    songIndex: setlist.getCurrentIndex(),
    isPlaying: !!(inShow && p && p.isPlaying),
    progress: inShow && p ? currentPlayerProgress() : 0,
    speed: p ? p.speed : 1,
    // Relógio do host: ordena os eventos (sobrevive a recarregar a página)
    seq: Date.now(),
    sentAt: Date.now()
  });
}

function syncHeartbeat() {
  if (state.sync && state.sync.role === 'host' && state.currentScreen === 'show' &&
      state.player && state.player.isPlaying) {
    broadcastPlayback();
  }
}

// Host alterou a setlist da sessão (músicas, ordem, tom) -> envia à banda
function pushSessionSetlistIfChanged() {
  const sync = state.sync;
  if (!sync || sync.role !== 'host' || !isSessionPlaylistActive()) return;
  const data = setlist.exportForShare();
  const json = JSON.stringify(data);
  const hash = hashString(json);
  if (hash === sync.setlistHash) return;
  if (json.length > 900 * 1024) {
    showToast('Setlist grande demais para sincronizar com a banda', 'warning');
    return;
  }
  sync.setlistHash = hash;
  saveSync();
  updateSessionSetlist(data);
}

async function endSyncSession() {
  const user = getCurrentUser();
  const isHost = !!(state.sync && state.sync.role === 'host');
  try {
    if (isHost) await endSession(user && user.uid);
    else await leaveSession(user && user.uid);
  } catch (err) {
    console.warn('Erro ao sair da sessão:', err);
  }
  setSync(null);
  showToast(isHost ? 'Sessão encerrada' : 'Você saiu da sessão', 'info');
}

// ---- Atualizações da sessão (host e integrantes) ----
function handleSessionUpdate(data) {
  const sync = state.sync;
  if (!sync) return;
  if (!data) return; // saída local; clearSync já foi chamado
  if (data.ended || data.isActive === false) {
    clearSync(sync.role === 'guest' ? 'O host encerrou a sessão' : null);
    return;
  }
  sync.participants = (data.participants || []).length;
  updateSyncBadge();
  if (sync.role !== 'guest') return;
  state.lastRemotePlayback = data.playback || null; // para retomar ao voltar a acompanhar

  applyRemoteSetlist(data.setlist);
  if (sync.following) applyRemotePlayback(data.playback);
}

function applyRemoteSetlist(remote) {
  const sync = state.sync;
  if (!remote) return;
  const hash = hashString(typeof remote === 'string' ? remote : JSON.stringify(remote));
  if (hash === sync.setlistHash) return;
  let data = remote;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return; }
  }
  sync.setlistHash = hash;
  saveSync();
  if (!setlist.replaceSongs(sync.playlistId, data)) return;

  if (state.currentScreen === 'show' && isSessionPlaylistActive()) {
    // Recarrega a música atual (ex.: host mudou o tom) sem perder a posição
    const progress = currentPlayerProgress();
    const wasPlaying = state.player && state.player.isPlaying;
    loadCurrentSong();
    if (state.player) {
      state.player.updateMaxScroll();
      state.player.seek(progress);
      if (wasPlaying && !state.player.isPlaying) state.player.start();
    }
  } else if (state.currentScreen === 'setlist') {
    renderSetlist();
  }
  updateSetlistBadge();
}

function applyRemotePlayback(pb) {
  const sync = state.sync;
  if (!pb || !pb.seq || pb.seq <= (sync.lastSeq || 0)) return;
  sync.lastSeq = pb.seq;

  if (!pb.active) {
    // Host saiu do modo show: pausa quem está acompanhando
    if (state.currentScreen === 'show' && state.player && state.player.isPlaying) {
      state.player.pause();
      updatePlayPauseIcon(false);
    }
    return;
  }

  // Garante a setlist da sessão ativa e o modo show aberto
  if (!isSessionPlaylistActive()) {
    if (!setlist.getPlaylist(sync.playlistId)) return;
    setlist.setActive(sync.playlistId);
  }
  const songCount = setlist.getAll().length;
  if (pb.songIndex < 0 || pb.songIndex >= songCount) return;

  if (state.currentScreen !== 'show') {
    setlist.setCurrent(pb.songIndex);
    showScreen('show');
  } else if (pb.songIndex !== setlist.getCurrentIndex()) {
    setlist.setCurrent(pb.songIndex);
    loadCurrentSong();
    if (state.player) {
      state.player.stop();
      state.player.setDuration(estimateDurationFromSong(setlist.currentSong()));
    }
  }
  const player = state.player;
  if (!player) return;

  // Velocidade do host (não salva como preferência da música do integrante)
  if (typeof pb.speed === 'number' && pb.speed !== player.speed) {
    player.setSpeed(pb.speed);
    els.speedValue.textContent = formatSpeed(player.speed);
  }

  // Posição do host + atraso da mensagem (limitado: relógios podem divergir)
  let target = pb.progress || 0;
  if (pb.isPlaying && pb.sentAt) {
    const lag = Date.now() - pb.sentAt;
    if (lag > 0 && lag < 3000) target += (lag * player.speed) / (player.duration * 1000);
  }
  target = Math.max(0, Math.min(1, target));

  if (pb.isPlaying && !player.isPlaying) {
    player.start();
    updatePlayPauseIcon(true);
    requestWakeLock();
  } else if (!pb.isPlaying && player.isPlaying) {
    player.pause();
    updatePlayPauseIcon(false);
  }
  player.updateMaxScroll();
  const tolerance = SYNC_SEEK_TOLERANCE_S * player.speed / player.duration;
  if (Math.abs(currentPlayerProgress() - target) > tolerance) {
    player.seek(target);
  }
  updatePlayPauseIcon(player.isPlaying);
}

// ---- Indicador no modo show ----
function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  const sync = state.sync;
  const following = isFollowingHost();
  document.body.classList.toggle('sync-guest', following);
  if (!badge) return;
  if (!sync) { badge.hidden = true; return; }
  badge.hidden = false;
  badge.classList.toggle('paused', sync.role === 'guest' && !sync.following);
  const n = sync.participants || 1;
  badge.textContent = sync.role === 'host'
    ? `SYNC · Host · ${n}`
    : (sync.following ? 'SYNC · seguindo o host' : 'SYNC pausado');
}

function handleSyncBadgeClick() {
  const sync = state.sync;
  if (!sync) return;
  if (sync.role === 'host') {
    showShareModal(getInviteLink(sync.sessionId));
    return;
  }
  if (sync.following) {
    const choice = confirm('Parar de acompanhar o host?\n\nOK = controlar sozinho (continua na sessão)\nCancelar = continuar acompanhando');
    if (!choice) return;
    sync.following = false;
    saveSync();
    showToast('Você está controlando sozinho. Toque em "SYNC" para voltar a acompanhar.', 'info');
  } else {
    const choice = confirm('Voltar a acompanhar o host?\n\nOK = acompanhar\nCancelar = sair da sessão');
    if (choice) {
      sync.following = true;
      sync.lastSeq = 0;
      saveSync();
      applyRemotePlayback(state.lastRemotePlayback); // alcança o host agora
      showToast('Acompanhando o host', 'success');
    } else {
      endSyncSession();
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== Service Worker Registration (para PWA offline) =====
// sw.js será criado separadamente