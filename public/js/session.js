// session.js — Compartilhamento de sessão (setlist colaborativo)

import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

let db = null;
let currentSessionId = null;
let currentSessionUnsubscribe = null;
let isHost = false;
const sessionListeners = [];

export function initSession(firebaseApp) {
  db = getFirestore(firebaseApp);
}

// Garante que o Firestore esteja inicializado (fallback caso initSession
// ainda não tenha sido chamado quando uma operação de sessão for disparada).
function ensureDb() {
  if (db) return db;
  if (window && window.FIREBASE_CONFIG) {
    try {
      const app = initializeApp(window.FIREBASE_CONFIG);
      db = getFirestore(app);
    } catch (err) {
      // initializeApp falha se já foi inicializado; tenta pegar instância existente
      try {
        db = getFirestore(getApp());
      } catch (e) {
        console.error('Falha ao inicializar Firestore de sessões:', e);
      }
    }
  }
  return db;
}

export function getCurrentSessionId() {
  return currentSessionId;
}

export function getIsHost() {
  return isHost;
}

// Cria nova sessão (host)
export async function createSession(userId, setlistData) {
  if (!ensureDb()) throw new Error('Firestore não inicializado');
  
  const sessionRef = await addDoc(collection(db, 'sessions'), {
    hostId: userId,
    setlist: setlistData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    participants: [userId],
    isActive: true
  });
  
  currentSessionId = sessionRef.id;
  isHost = true;
  
  // Escuta mudanças na sessão
  watchSession(currentSessionId);
  
  return currentSessionId;
}

// Entra em sessão existente (convidado)
export async function joinSession(sessionId, userId) {
  if (!ensureDb()) throw new Error('Firestore não inicializado');
  
  const sessionRef = doc(db, 'sessions', sessionId);
  const snap = await getDoc(sessionRef);
  
  if (!snap.exists()) {
    throw new Error('Sessão não encontrada');
  }
  
  const data = snap.data();
  if (!data.isActive) {
    throw new Error('Sessão encerrada');
  }
  
  // Adiciona participante se não estiver na lista
  const participants = data.participants || [];
  if (!participants.includes(userId)) {
    await updateDoc(sessionRef, {
      participants: [...participants, userId],
      updatedAt: serverTimestamp()
    });
  }
  
  currentSessionId = sessionId;
  isHost = (data.hostId === userId);
  
  watchSession(sessionId);
  
  return { sessionId, isHost, setlist: data.setlist };
}

// Sai da sessão
export async function leaveSession(userId) {
  if (!currentSessionId || !db) return;
  
  if (currentSessionUnsubscribe) {
    currentSessionUnsubscribe();
    currentSessionUnsubscribe = null;
  }
  
  // Remove participante (opcional: só se não for host)
  const sessionRef = doc(db, 'sessions', currentSessionId);
  const snap = await getDoc(sessionRef);
  if (snap.exists()) {
    const data = snap.data();
    const participants = (data.participants || []).filter(id => id !== userId);
    await updateDoc(sessionRef, { participants, updatedAt: serverTimestamp() });
  }
  
  currentSessionId = null;
  isHost = false;
  notifyListeners(null);
}

// Encerra sessão (apenas host)
export async function endSession(userId) {
  if (!currentSessionId || !db || !isHost) return;
  
  const sessionRef = doc(db, 'sessions', currentSessionId);
  await updateDoc(sessionRef, { isActive: false, updatedAt: serverTimestamp() });
  
  await leaveSession(userId);
}

// Atualiza setlist na sessão (apenas host)
export async function updateSessionSetlist(setlistData) {
  if (!currentSessionId || !db || !isHost) return false;
  
  try {
    const sessionRef = doc(db, 'sessions', currentSessionId);
    await updateDoc(sessionRef, {
      setlist: setlistData,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error('Erro ao atualizar setlist da sessão:', err);
    return false;
  }
}

// Escuta mudanças em tempo real
function watchSession(sessionId) {
  if (!db) return;
  
  const sessionRef = doc(db, 'sessions', sessionId);
  
  currentSessionUnsubscribe = onSnapshot(sessionRef, (snap) => {
    if (!snap.exists()) {
      notifyListeners({ ended: true });
      return;
    }
    
    const data = snap.data();
    notifyListeners({
      sessionId,
      setlist: data.setlist,
      participants: data.participants,
      hostId: data.hostId,
      isActive: data.isActive
    });
  }, (err) => {
    console.error('Erro na sessão:', err);
  });
}

// Gera link de convite
export function getInviteLink(sessionId) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?session=${sessionId}`;
}

// Verifica se URL tem parâmetro de sessão
export function getSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session');
}

// Listeners de mudanças na sessão
export function onSessionChange(callback) {
  sessionListeners.push(callback);
  return () => {
    const idx = sessionListeners.indexOf(callback);
    if (idx > -1) sessionListeners.splice(idx, 1);
  };
}

function notifyListeners(data) {
  sessionListeners.forEach(cb => cb(data));
}

// Detecta parâmetro de sessão na URL ao carregar
export function checkUrlForSession() {
  const sessionId = getSessionIdFromUrl();
  if (sessionId) {
    // Remove parâmetro da URL (limpo)
    const url = new URL(window.location.href);
    url.searchParams.delete('session');
    window.history.replaceState({}, '', url);
  }
  return sessionId;
}