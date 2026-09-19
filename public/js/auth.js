// auth.js — Firebase Authentication com Google

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  EmailAuthProvider,
  linkWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  deleteDoc,
  deleteField,
  collection,
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let app = null;
let auth = null;
let db = null;
let googleProvider = null;
let currentUser = null;
let authReady = false;
let postLoginHandler = null;
let setlistReadyHandler = null;
const authListeners = [];

// Detecta Firefox
const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('firefox');

export function initAuth() {
  if (typeof window === 'undefined' || !window.FIREBASE_CONFIG) {
    console.warn('Firebase config não encontrada');
    return Promise.resolve();
  }
  
  app = initializeApp(window.FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  // Inicializa o Firestore de sessões (compartilhamento). Usa o mesmo app.
  import('./session.js').then(({ initSession }) => initSession(app)).catch(console.error);
  
  // Persistência local (mantém login entre sessões)
  setPersistence(auth, browserLocalPersistence).catch(console.error);
  
  // Verifica se há resultado de redirect (após login com redirect)
  getRedirectResult(auth).then(handleAuthResult).catch(console.error);
  
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      authReady = true;
      notifyListeners(user);

      if (user) {
        if (postLoginHandler) postLoginHandler(user);
        await loadUserSetlist(user.uid);
      } else {
        resetCloudState();
        import('./setlist.js').then(({ setlist }) => setlist.load());
        notifyListeners(null);
      }
      resolve();
    });
  });
}

function handleAuthResult(result) {
  if (result?.user) {
    console.log('Login via redirect concluído:', result.user.email);
    currentUser = result.user;
    notifyListeners(result.user);
    // Navegação explícita após redirect, independente do listener de estado
    if (postLoginHandler) postLoginHandler(result.user);
  }
}

// Registra handler para navegar à home do usuário após login confirmado
export function setPostLoginHandler(fn) {
  postLoginHandler = fn;
  if (currentUser && fn) fn(currentUser);
}

// Registra callback chamado quando o setlist termina de carregar/sincronizar na
// nuvem (após login), para a UI re-renderizar a lista.
export function onSetlistReady(fn) {
  setlistReadyHandler = fn;
}

export function getAuthInstance() { return auth; }
export function getCurrentUser() { return currentUser; }
export function isAuthenticated() { return !!currentUser; }

export function onAuthChange(callback) {
  authListeners.push(callback);
  if (authReady) callback(currentUser);
  return () => {
    const idx = authListeners.indexOf(callback);
    if (idx > -1) authListeners.splice(idx, 1);
  };
}

function notifyListeners(user) {
  authListeners.forEach(cb => cb(user));
}

export async function signInWithGoogle() {
  if (!auth) await initAuth();
  
  // Popup primeiro: retorna o usuário diretamente, sem depender do iframe
  // de cookies (que pode ser bloqueado por cookies de terceiros).
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    // Se popup bloqueado/COOP, cai para redirect
    if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
      return signInWithRedirect(auth, googleProvider);
    }
    throw err;
  }
}

export async function registerWithEmail(email, password) {
  if (!auth) await initAuth();
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function setDisplayName(name) {
  if (!auth || !auth.currentUser) return;
  try {
    await updateProfile(auth.currentUser, { displayName: name });
  } catch (err) {
    console.warn('Erro ao salvar nome:', err);
  }
}

export async function loginWithEmail(email, password) {
  if (!auth) await initAuth();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function resetPassword(email) {
  if (!auth) await initAuth();
  return sendPasswordResetEmail(auth, email);
}

// Cria/vincula uma senha e-mail/senha à conta já logada (ex.: conta que existe
// só pelo Google). Depois disso, o usuário entra direto com e-mail+senha.
// Requer que o usuário esteja logado (via Google) na conta do mesmo e-mail.
export async function createPasswordForAccount(email, password) {
  if (!auth) await initAuth();
  const user = auth.currentUser;
  if (!user) throw { code: 'auth/requires-recent-login', message: 'Entre com a sua conta do Google para confirmar que é você.' };
  const credential = EmailAuthProvider.credential(email, password);
  return linkWithCredential(user, credential);
}

export async function signOutUser() {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Erro no logout:', err);
    throw err;
  }
}

// ===== Firestore: sincroniza setlist na nuvem =====

// ===== Nuvem: formato v2 (uma setlist por documento) =====
// users/{uid}                  -> { version: 2, playlistIds, activePlaylistId, updatedAt }
// users/{uid}/playlists/{id}   -> { playlist, updatedAt }
// O formato antigo guardava tudo em users/{uid}.setlist — um único documento
// com limite de 1 MiB para TODAS as setlists. Agora o limite vale por setlist.
const CLOUD_VERSION = 2;
const PLAYLIST_DOC_LIMIT = 1000 * 1024; // 1 MiB por documento, com folga
const sentPlaylistHashes = new Map();   // id -> hash do que está na nuvem
let lastMetaHash = null;
let legacyFieldPresent = false;         // users/{uid}.setlist ainda existe
let cloudReady = false;                 // nuvem já carregada nesta sessão
let saveChain = Promise.resolve();      // salvamentos em série
let lastCloudErrorAt = 0;

// Setlists que não conseguiram subir (ex.: > 1 MB). Ficam lembradas neste
// aparelho para nunca serem descartadas ao carregar a nuvem de outro aparelho.
const PENDING_KEY = 'singfy_cloud_pending_v1';
function getPendingIds() {
  try { return new Set(JSON.parse(localStorage.getItem(PENDING_KEY)) || []); } catch (_) { return new Set(); }
}
function setPendingIds(set) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify([...set])); } catch (_) {}
}

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0) + ':' + str.length;
}

function resetCloudState() {
  sentPlaylistHashes.clear();
  lastMetaHash = null;
  legacyFieldPresent = false;
  cloudReady = false;
}

function notifyCloudSaveFailed(reason) {
  // Evento para a UI avisar (no máximo a cada 30 s)
  if (Date.now() - lastCloudErrorAt < 30000) return;
  lastCloudErrorAt = Date.now();
  window.dispatchEvent(new CustomEvent('singfy:cloud-save-failed', { detail: { reason } }));
}

async function readCloudSetlists(uid) {
  const userDoc = await getDoc(doc(db, 'users', uid));
  if (!userDoc.exists()) return { playlists: [], activePlaylistId: null, updatedAt: 0, legacy: null };
  const data = userDoc.data() || {};
  const updatedAt = Date.parse(data.updatedAt || '') || 0;
  legacyFieldPresent = data.setlist !== undefined;

  if (data.version === CLOUD_VERSION && Array.isArray(data.playlistIds)) {
    const snap = await getDocs(collection(db, 'users', uid, 'playlists'));
    const byId = {};
    snap.forEach(d => {
      const pl = d.data() && d.data().playlist;
      // Registra tudo que existe na nuvem (inclusive órfãos, que serão apagados)
      sentPlaylistHashes.set(d.id, pl ? hashString(JSON.stringify(pl)) : '');
      if (pl) byId[d.id] = pl;
    });
    return {
      playlistIds: data.playlistIds,
      byId,
      playlists: data.playlistIds.map(id => byId[id]).filter(Boolean),
      activePlaylistId: data.activePlaylistId || null,
      updatedAt,
      legacy: null
    };
  }
  // Formato antigo: { playlists } ou { songs } em users/{uid}.setlist
  return { playlists: [], activePlaylistId: null, updatedAt, legacy: data.setlist || null };
}

async function loadUserSetlist(uid) {
  if (!db) return;
  resetCloudState();
  const { setlist } = await import('./setlist.js');
  try {
    let cloud;
    try {
      cloud = await readCloudSetlists(uid);
    } catch (err) {
      // Firestore indisponível/offline/permissão -> mantém o localStorage
      if (err?.code !== 'unavailable' && err?.code !== 'permission-denied') {
        console.warn('Erro ao ler setlist do Firestore:', err);
      }
      setlist.load();
      return; // cloudReady continua false: não sobrescreve uma nuvem que não lemos
    }

    const legacy = cloud.legacy;
    const hasCloudData = cloud.playlists.length > 0 || !!(legacy && (
      (Array.isArray(legacy.playlists) && legacy.playlists.length > 0) ||
      (Array.isArray(legacy.songs) && legacy.songs.length > 0)
    ));
    const localNewer = setlist.getLocalUpdatedAt() > cloud.updatedAt && setlist.getAllPlaylists().length > 0;

    if (hasCloudData && !localNewer) {
      // Nuvem mais nova -> usa a nuvem
      if (legacy) {
        setlist.import(JSON.stringify(legacy));
      } else {
        // Setlist listada no índice mas sem documento na nuvem (ex.: passou de
        // 1 MB e não subiu): mantém a cópia deste aparelho em vez de perdê-la
        const local = new Map(setlist.getAllPlaylists().map(p => [p.id, setlist.getPlaylist(p.id)]));
        const merged = cloud.playlistIds.map(id => cloud.byId[id] || local.get(id)).filter(Boolean);
        // ...e as que nunca conseguiram subir, mesmo que outro aparelho tenha
        // salvo um índice sem elas
        for (const id of getPendingIds()) {
          if (!cloud.playlistIds.includes(id) && local.has(id)) merged.push(local.get(id));
        }
        setlist.importAll(JSON.stringify({ playlists: merged, activePlaylistId: cloud.activePlaylistId }));
      }
    } else if (!hasCloudData && setlist.getAllPlaylists().length === 0) {
      setlist.load();
    }
    // Aparelho mais novo (o salvamento anterior falhou ou não terminou antes
    // de recarregar) ou nuvem vazia: o aparelho vence e é enviado abaixo.

    cloudReady = true;
    // Migra do formato antigo / envia o que o aparelho tem de novo
    // (só grava o que mudou; se nada mudou, não escreve nada)
    await saveSetlistToCloud(JSON.stringify({ playlists: setlist.playlists, activePlaylistId: setlist.activePlaylistId }));
  } catch (err) {
    console.warn('Erro ao carregar setlist do Firestore:', err);
    setlist.load();
  } finally {
    if (setlistReadyHandler) setlistReadyHandler();
  }
}

export function saveSetlistToCloud(setlistData) {
  if (!auth || !currentUser || !db) return Promise.resolve(false);
  // Antes de ler a nuvem, não escreve (evita um aparelho desatualizado
  // sobrescrever a nuvem durante o login). O que mudar nesse meio-tempo fica
  // com updatedAt local mais novo e é enviado ao terminar a carga.
  if (!cloudReady) return Promise.resolve(false);
  const uid = currentUser.uid;
  let data;
  try { data = JSON.parse(setlistData); } catch (_) { return Promise.resolve(false); }
  saveChain = saveChain.then(() => writeCloud(uid, data)).catch((err) => {
    console.error('Erro ao salvar setlist na nuvem:', err);
    notifyCloudSaveFailed(err && err.code);
    return false;
  });
  return saveChain;
}

async function writeCloud(uid, data) {
  if (!currentUser || currentUser.uid !== uid) return false; // trocou de conta
  const playlists = Array.isArray(data.playlists) ? data.playlists : [];
  const ids = playlists.map(p => p.id);
  const now = new Date().toISOString();
  let changed = false;
  let failure = null;
  const pending = getPendingIds();

  for (const pl of playlists) {
    const json = JSON.stringify(pl);
    const h = hashString(json);
    if (sentPlaylistHashes.get(pl.id) === h) continue;
    if (new Blob([json]).size > PLAYLIST_DOC_LIMIT) {
      console.error('Setlist grande demais para a nuvem:', pl.name, json.length);
      failure = failure || 'too-large';
      pending.add(pl.id);
      continue;
    }
    try {
      await setDoc(doc(db, 'users', uid, 'playlists', pl.id), { playlist: pl, updatedAt: now });
      sentPlaylistHashes.set(pl.id, h);
      pending.delete(pl.id);
      changed = true;
    } catch (err) {
      console.error('Erro ao salvar setlist na nuvem:', pl.name, err);
      failure = failure || (err && err.code) || 'error';
      pending.add(pl.id);
    }
  }
  // Excluídas neste aparelho deixam de ser pendentes
  for (const id of [...pending]) if (!ids.includes(id)) pending.delete(id);
  setPendingIds(pending);

  // Setlists excluídas (e órfãs de outros aparelhos)
  for (const id of [...sentPlaylistHashes.keys()]) {
    if (ids.includes(id)) continue;
    try {
      await deleteDoc(doc(db, 'users', uid, 'playlists', id));
      sentPlaylistHashes.delete(id);
      changed = true;
    } catch (err) {
      failure = failure || (err && err.code) || 'error';
    }
  }

  const meta = { version: CLOUD_VERSION, playlistIds: ids, activePlaylistId: data.activePlaylistId || null };
  const metaHash = hashString(JSON.stringify(meta));
  if (changed || metaHash !== lastMetaHash || legacyFieldPresent) {
    const payload = { ...meta, updatedAt: now };
    if (legacyFieldPresent) payload.setlist = deleteField(); // conclui a migração
    try {
      await setDoc(doc(db, 'users', uid), payload, { merge: true });
      lastMetaHash = metaHash;
      legacyFieldPresent = false;
    } catch (err) {
      failure = failure || (err && err.code) || 'error';
    }
  }

  if (failure) notifyCloudSaveFailed(failure);
  return !failure;
}

export function watchSetlist(uid, callback) {
  if (!db) return () => {};
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists() && snap.data().setlist) {
      callback(snap.data().setlist);
    }
  });
}