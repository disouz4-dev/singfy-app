// setlist.js — Gerenciamento de Múltiplas Setlists

const STORAGE_KEY = "singfy_playlists_v1";
const LEGACY_KEY = "singfy_setlist_v1";

export class SetlistManager {
  constructor() {
    this.playlists = [];
    this.activePlaylistId = null;
    this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.playlists = data.playlists || [];
        this.activePlaylistId = data.activePlaylistId || null;
        this._sanitize();
      } else {
        this._migrateLegacy();
      }
    } catch (e) {
      console.warn("Erro ao carregar setlists:", e);
      this.playlists = [];
      this.activePlaylistId = null;
    }
  }

  // Remove músicas corrompidas (sem metadados/lines válidos) e normaliza o
  // formato das linhas ({entries,letra} -> {chords,text}) para compatibilidade.
  _sanitize() {
    let changed = false;
    const normChord = (n) => String(n || "").trim()
      .replace(/♯/g, "#").replace(/♭/g, "b").replace(/\s+/g, "");
    for (const pl of this.playlists) {
      if (!pl || !Array.isArray(pl.songs)) { pl.songs = []; changed = true; continue; }
      const before = pl.songs.length;
      pl.songs = pl.songs.filter(s => s && s.metadata && typeof s.metadata === 'object' && Array.isArray(s.lines) && s.lines.length > 0);
      if (pl.songs.length !== before) {
        changed = true;
        if (pl.currentIndex === -1 || pl.currentIndex >= pl.songs.length) {
          pl.currentIndex = pl.songs.length > 0 ? 0 : -1;
        }
      }
      for (const song of pl.songs) {
        const needsNormalize = song.lines.some(l => (l.entries || l.letra) && !Array.isArray(l.chords));
        if (needsNormalize) {
          song.lines = song.lines.map(l => {
            if (l.chords && l.text !== undefined) return l;
            if (l.entries || l.letra) {
              return {
                chords: (l.entries || []).map(e => ({ name: normChord(e.name), display: e.text, originalName: e.name, pos: e.pos })),
                text: String(l.letra || "").replace(/&nbsp;/g, " "),
                raw: l
              };
            }
            return { chords: [], text: String(l.letra || l.text || ""), raw: l };
          });
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  _migrateLegacy() {
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const data = JSON.parse(legacy);
        if (data.songs && data.songs.length > 0) {
          const playlist = {
            id: crypto.randomUUID(),
            name: "Minha Setlist",
            eventDate: "",
            venue: "",
            songs: data.songs.map(s => ({ ...s, id: s.id || crypto.randomUUID() })),
            currentIndex: data.currentIndex ?? 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.playlists = [playlist];
          this.activePlaylistId = playlist.id;
          this.save();
          return;
        }
      }
    } catch (_) {}
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        playlists: this.playlists,
        activePlaylistId: this.activePlaylistId,
        updatedAt: Date.now()
      }));
    } catch (e) {
      console.error("Erro ao salvar setlists:", e);
    }
    this.syncToCloud();
  }

  syncToCloud() {
    try {
      import('./auth.js?v=20260905').then(async ({ isAuthenticated, saveSetlistToCloud }) => {
        if (!isAuthenticated()) return;
        await saveSetlistToCloud(JSON.stringify({
          playlists: this.playlists,
          activePlaylistId: this.activePlaylistId
        }));
      }).catch(() => {});
    } catch (_) {}
  }

  // === Gestão de setlists ===

  createPlaylist(name, eventDate, venue) {
    const playlist = {
      id: crypto.randomUUID(),
      name: name || "Nova Setlist",
      eventDate: eventDate || "",
      venue: venue || "",
      songs: [],
      currentIndex: -1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.playlists.push(playlist);
    this.activePlaylistId = playlist.id;
    this.save();
    return playlist;
  }

  deletePlaylist(id) {
    this.playlists = this.playlists.filter(p => p.id !== id);
    if (this.activePlaylistId === id) {
      this.activePlaylistId = this.playlists.length > 0 ? this.playlists[0].id : null;
    }
    this.save();
  }

  updatePlaylist(id, fields) {
    const p = this.playlists.find(p => p.id === id);
    if (p) {
      Object.assign(p, fields, { updatedAt: Date.now() });
      this.save();
    }
  }

  setActive(id) {
    if (this.playlists.find(p => p.id === id)) {
      this.activePlaylistId = id;
      this.save();
    }
  }

  getActive() {
    return this.playlists.find(p => p.id === this.activePlaylistId) || null;
  }

  getAllPlaylists() {
    return this.playlists.map(p => ({
      id: p.id,
      name: p.name,
      eventDate: p.eventDate,
      venue: p.venue,
      songCount: p.songs.length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));
  }

  hasAnyPlaylist() {
    return this.playlists.length > 0;
  }

  // === Operações na playlist ativa ===

  add(songData) {
    let active = this.getActive();
    if (!active) {
      active = this.createPlaylist("Minha Setlist", "", "");
    }
    const norm = (s) => String(s || "").toLowerCase().trim();
    const newName = norm(songData.metadata?.name);
    const newArtist = norm(songData.metadata?.artist);
    const isDup = active.songs.some(s =>
      norm(s.metadata?.name) === newName &&
      norm(s.metadata?.artist) === newArtist
    );
    if (isDup) return null;
    const song = {
      id: crypto.randomUUID(),
      ...songData,
      addedAt: Date.now(),
      transpose: 0,
      speed: 1.0,
      customKey: songData.metadata?.tom || null
    };
    active.songs.push(song);
    if (active.currentIndex === -1) active.currentIndex = 0;
    active.updatedAt = Date.now();
    this.save();
    return song;
  }

  remove(id) {
    const active = this.getActive();
    if (!active) return;
    const idx = active.songs.findIndex(s => s.id === id);
    if (idx !== -1) {
      active.songs.splice(idx, 1);
      if (active.currentIndex >= active.songs.length) {
        active.currentIndex = active.songs.length - 1;
      }
      if (active.currentIndex < 0 && active.songs.length > 0) active.currentIndex = 0;
      active.updatedAt = Date.now();
      this.save();
    }
  }

  clear() {
    const active = this.getActive();
    if (!active) return;
    active.songs = [];
    active.currentIndex = -1;
    active.updatedAt = Date.now();
    this.save();
  }

  reorder(fromIndex, toIndex) {
    const active = this.getActive();
    if (!active) return;
    const songs = active.songs;
    if (fromIndex < 0 || fromIndex >= songs.length) return;
    if (toIndex < 0 || toIndex >= songs.length) return;
    const [item] = songs.splice(fromIndex, 1);
    songs.splice(toIndex, 0, item);
    if (active.currentIndex === fromIndex) active.currentIndex = toIndex;
    else if (fromIndex < active.currentIndex && toIndex >= active.currentIndex) active.currentIndex--;
    else if (fromIndex > active.currentIndex && toIndex <= active.currentIndex) active.currentIndex++;
    active.updatedAt = Date.now();
    this.save();
  }

  next() {
    const active = this.getActive();
    if (!active) return null;
    if (active.currentIndex < active.songs.length - 1) {
      active.currentIndex++;
      active.updatedAt = Date.now();
      this.save();
      return this.currentSong();
    }
    return null;
  }

  prev() {
    const active = this.getActive();
    if (!active) return null;
    if (active.currentIndex > 0) {
      active.currentIndex--;
      active.updatedAt = Date.now();
      this.save();
      return this.currentSong();
    }
    return null;
  }

  setCurrent(index) {
    const active = this.getActive();
    if (!active) return null;
    if (index >= 0 && index < active.songs.length) {
      active.currentIndex = index;
      active.updatedAt = Date.now();
      this.save();
      return this.currentSong();
    }
    return null;
  }

  currentSong() {
    const active = this.getActive();
    if (!active) return null;
    if (active.currentIndex >= 0 && active.currentIndex < active.songs.length) {
      return active.songs[active.currentIndex];
    }
    return null;
  }

  getAll() {
    const active = this.getActive();
    return active ? [...active.songs] : [];
  }

  getCurrentIndex() {
    const active = this.getActive();
    return active ? active.currentIndex : -1;
  }

  setTranspose(songId, semitones) {
    const active = this.getActive();
    if (!active) return;
    const song = active.songs.find(s => s.id === songId);
    if (song) {
      song.transpose = semitones;
      active.updatedAt = Date.now();
      this.save();
    }
  }

  setSpeed(songId, speed) {
    const active = this.getActive();
    if (!active) return;
    const song = active.songs.find(s => s.id === songId);
    if (song && typeof speed === 'number' && isFinite(speed)) {
      song.speed = Math.max(0.25, Math.min(3, speed));
      active.updatedAt = Date.now();
      this.save();
    }
  }

  setCustomKey(songId, key) {
    const active = this.getActive();
    if (!active) return;
    const song = active.songs.find(s => s.id === songId);
    if (song) {
      song.customKey = key;
      active.updatedAt = Date.now();
      this.save();
    }
  }

  getEffectiveKey(song) {
    if (song.customKey) return song.customKey;
    const original = song.metadata?.tom;
    if (!original || song.transpose === 0) return original;
    return transposeKeyBySemitones(original, song.transpose);
  }

  // === Import/Export ===

  export() {
    const active = this.getActive();
    if (!active) return JSON.stringify({ songs: [] }, null, 2);
    return JSON.stringify({
      name: active.name,
      eventDate: active.eventDate,
      venue: active.venue,
      songs: active.songs.map(s => ({
        id: s.id,
        metadata: s.metadata,
        transpose: s.transpose,
        customKey: s.customKey
      }))
    }, null, 2);
  }

  // Setlist ativa como OBJETO, com as cifras (lines), para compartilhar numa
  // sessão. export() não serve: devolve string e sem lines, e o _sanitize do
  // convidado descartava todas as músicas.
  exportForShare() {
    const active = this.getActive();
    const data = {
      name: active?.name || "Setlist compartilhada",
      eventDate: active?.eventDate || "",
      venue: active?.venue || "",
      songs: (active?.songs || []).map(s => ({
        metadata: s.metadata,
        lines: s.lines,
        transpose: s.transpose || 0,
        customKey: s.customKey || null
      }))
    };
    // Firestore rejeita campos undefined; o round-trip JSON remove todos
    return JSON.parse(JSON.stringify(data));
  }

  exportAll() {
    return JSON.stringify({
      playlists: this.playlists,
      activePlaylistId: this.activePlaylistId
    });
  }

  importSetlist(json) {
    try {
      const data = JSON.parse(json);
      const playlist = this.createPlaylist(
        data.name || "Importada",
        data.eventDate || "",
        data.venue || ""
      );
      playlist.songs = (data.songs || []).map(s => ({
        ...s,
        id: s.id || crypto.randomUUID()
      }));
      playlist.currentIndex = playlist.songs.length > 0 ? 0 : -1;
      this.save();
      return playlist;
    } catch (e) {
      console.error("Erro ao importar setlist:", e);
      return null;
    }
  }

  importAll(json) {
    try {
      const data = JSON.parse(json);
      if (data.playlists && Array.isArray(data.playlists)) {
        this.playlists = data.playlists.map(p => ({
          ...p,
          id: p.id || crypto.randomUUID(),
          songs: (p.songs || []).map(s => ({
            ...s,
            id: s.id || crypto.randomUUID()
          }))
        }));
        this.activePlaylistId = data.activePlaylistId ||
          (this.playlists.length > 0 ? this.playlists[0].id : null);
        this._sanitize();
        this.save();
        return true;
      }
    } catch (e) {
      console.error("Erro ao importar setlists:", e);
    }
    return false;
  }

  // Compatibilidade com código legado
  import(json) {
    try {
      const data = JSON.parse(json);
      if (data.playlists && Array.isArray(data.playlists)) {
        return this.importAll(json);
      }
      if (data.songs && Array.isArray(data.songs)) {
        const playlist = this.createPlaylist(
          data.name || "Importada",
          data.eventDate || "",
          data.venue || ""
        );
        playlist.songs = data.songs.map(s => ({
          ...s,
          id: s.id || crypto.randomUUID()
        }));
        playlist.currentIndex = data.currentIndex ?? 0;
        this._sanitize();
        this.save();
        return true;
      }
    } catch (e) {
      console.error("Erro ao importar:", e);
    }
    return false;
  }
}

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

export const setlist = new SetlistManager();
