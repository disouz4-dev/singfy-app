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
  setDoc, 
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

async function loadUserSetlist(uid) {
  if (!db) return;
  try {
    const { setlist } = await import('./setlist.js');
    let userDoc;
    try {
      userDoc = await getDoc(doc(db, 'users', uid));
    } catch (err) {
      // Firestore indisponível/offline/permissão -> mantém o localStorage
      if (err?.code !== 'unavailable' && err?.code !== 'permission-denied') {
        console.warn('Erro ao ler setlist do Firestore:', err);
      }
      setlist.load();
      if (setlistReadyHandler) setlistReadyHandler();
      return;
    }
    const stored = userDoc.exists() ? userDoc.data()?.setlist : null;
    const hasCloudData = stored && (
      (Array.isArray(stored.playlists) && stored.playlists.length > 0) ||
      (Array.isArray(stored.songs) && stored.songs.length > 0)
    );

    const cloudUpdatedAt = Date.parse(userDoc.data()?.updatedAt || '') || 0;
    const localUpdatedAt = setlist.getLocalUpdatedAt();
    if (hasCloudData && localUpdatedAt > cloudUpdatedAt && setlist.getAllPlaylists().length > 0) {
      // O aparelho tem alterações mais novas que a nuvem (ex.: o salvamento
      // na nuvem falhou ou não terminou antes de recarregar). Antes a nuvem
      // sempre vencia e músicas excluídas voltavam. Reenvia o aparelho.
      await saveSetlistToCloud(JSON.stringify({ playlists: setlist.playlists, activePlaylistId: setlist.activePlaylistId }));
    } else if (hasCloudData) {
      // A nuvem tem setlists mais novas -> usa a nuvem
      setlist.import(JSON.stringify(stored));
    } else {
      // Nuvem vazia. Se o dispositivo tem setlists locais, envia para a nuvem
      // (sincroniza de local -> nuvem), para que apareçam em outros dispositivos.
      const local = setlist.getAllPlaylists();
      if (local.length > 0) {
        const all = { playlists: setlist.playlists, activePlaylistId: setlist.activePlaylistId };
        await saveSetlistToCloud(JSON.stringify(all));
        console.log('Setlists locais enviadas para a nuvem:', local.length);
      } else {
        setlist.load();
      }
    }
    if (setlistReadyHandler) setlistReadyHandler();
  } catch (err) {
    console.warn('Erro ao carregar setlist do Firestore:', err);
    import('./setlist.js').then(({ setlist }) => setlist.load()).finally(() => {
      if (setlistReadyHandler) setlistReadyHandler();
    });
  }
}

// Limite de 1 MiB por documento do Firestore (com folga para os metadados)
const CLOUD_DOC_LIMIT = 1000 * 1024;
let lastCloudErrorAt = 0;

function notifyCloudSaveFailed(reason) {
  // Evento para a UI avisar (no máximo a cada 30 s)
  if (Date.now() - lastCloudErrorAt < 30000) return;
  lastCloudErrorAt = Date.now();
  window.dispatchEvent(new CustomEvent('singfy:cloud-save-failed', { detail: { reason } }));
}

export async function saveSetlistToCloud(setlistData) {
  if (!auth || !currentUser || !db) return false;
  if (new Blob([setlistData]).size > CLOUD_DOC_LIMIT) {
    console.error('Setlists grandes demais para a nuvem:', setlistData.length);
    notifyCloudSaveFailed('too-large');
    return false;
  }
  try {
    await setDoc(doc(db, 'users', currentUser.uid), {
      setlist: JSON.parse(setlistData),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('Erro ao salvar setlist na nuvem:', err);
    notifyCloudSaveFailed(err && err.code);
    return false;
  }
}

export function watchSetlist(uid, callback) {
  if (!db) return () => {};
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists() && snap.data().setlist) {
      callback(snap.data().setlist);
    }
  });
}