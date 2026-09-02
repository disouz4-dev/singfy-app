// setlist.js — Gerenciamento de Setlist (persistência, ordem, edição)

const STORAGE_KEY = "singfy_setlist_v1";

export class SetlistManager {
  constructor() {
    this.songs = [];
    this.currentIndex = -1;
    this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.songs = data.songs || [];
        this.currentIndex = data.currentIndex ?? -1;
      }
    } catch (e) {
      console.warn("Erro ao carregar setlist:", e);
      this.songs = [];
      this.currentIndex = -1;
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        songs: this.songs,
        currentIndex: this.currentIndex,
        updatedAt: Date.now()
      }));
    } catch (e) {
      console.error("Erro ao salvar setlist:", e);
    }
  }

  // Adiciona música à setlist
  add(songData) {
    const song = {
      id: crypto.randomUUID(),
      ...songData,
      addedAt: Date.now(),
      transpose: 0, // semitons relativos ao tom original
      customKey: songData.metadata?.tom || null // tom original
    };
    this.songs.push(song);
    if (this.currentIndex === -1) this.currentIndex = 0;
    this.save();
    return song;
  }

  // Remove por ID
  remove(id) {
    const idx = this.songs.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.songs.splice(idx, 1);
      if (this.currentIndex >= this.songs.length) {
        this.currentIndex = this.songs.length - 1;
      }
      if (this.currentIndex < 0 && this.songs.length > 0) this.currentIndex = 0;
      this.save();
    }
  }

  // Reordena (drag & drop)
  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.songs.length) return;
    if (toIndex < 0 || toIndex >= this.songs.length) return;
    const [item] = this.songs.splice(fromIndex, 1);
    this.songs.splice(toIndex, 0, item);
    if (this.currentIndex === fromIndex) this.currentIndex = toIndex;
    else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) this.currentIndex--;
    else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) this.currentIndex++;
    this.save();
  }

  // Move currentIndex para próxima/anterior
  next() {
    if (this.currentIndex < this.songs.length - 1) {
      this.currentIndex++;
      this.save();
      return this.currentSong();
    }
    return null;
  }

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.save();
      return this.currentSong();
    }
    return null;
  }

  // Define música atual por índice
  setCurrent(index) {
    if (index >= 0 && index < this.songs.length) {
      this.currentIndex = index;
      this.save();
      return this.currentSong();
    }
    return null;
  }

  currentSong() {
    if (this.currentIndex >= 0 && this.currentIndex < this.songs.length) {
      return this.songs[this.currentIndex];
    }
    return null;
  }

  getAll() {
    return [...this.songs];
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  // Transpõe música individual
  setTranspose(songId, semitones) {
    const song = this.songs.find(s => s.id === songId);
    if (song) {
      song.transpose = semitones;
      this.save();
    }
  }

  // Define tom customizado (sobrescreve detecção automática)
  setCustomKey(songId, key) {
    const song = this.songs.find(s => s.id === songId);
    if (song) {
      song.customKey = key;
      this.save();
    }
  }

  // Exporta setlist (JSON)
  export() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      songs: this.songs.map(s => ({
        id: s.id,
        metadata: s.metadata,
        transpose: s.transpose,
        customKey: s.customKey
      }))
    }, null, 2);
  }

  // Importa setlist
  import(json) {
    try {
      const data = JSON.parse(json);
      if (data.songs && Array.isArray(data.songs)) {
        this.songs = data.songs.map(s => ({
          ...s,
          id: s.id || crypto.randomUUID()
        }));
        this.currentIndex = 0;
        this.save();
        return true;
      }
    } catch (e) {
      console.error("Erro ao importar:", e);
    }
    return false;
  }

  clear() {
    this.songs = [];
    this.currentIndex = -1;
    this.save();
  }

  // Retorna tom efetivo (customKey ou original + transpose)
  getEffectiveKey(song) {
    if (song.customKey) return song.customKey;
    const original = song.metadata?.tom;
    if (!original || song.transpose === 0) return original;
    return transposeKeyBySemitones(original, song.transpose);
  }
}

// Função auxiliar (reutiliza lógica de transpose.js)
function transposeKeyBySemitones(key, semitones) {
  if (!key) return null;
  const isMinor = key.endsWith("m");
  const base = key.replace("m", "");
  const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const ENHARMONIC = { "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#" };
  const n = ENHARMONIC[base] || base;
  const idx = NOTE_ORDER.indexOf(n);
  if (idx === -1) return key;
  return NOTE_ORDER[(idx + semitones + 12) % 12] + (isMinor ? "m" : "");
}

// Instância singleton
export const setlist = new SetlistManager();