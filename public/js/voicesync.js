// voicesync.js — Auto-rolagem guiada por voz (Web Speech API)
// Transcreve o canto em tempo real e sincroniza com as linhas da letra,
// avançando a rolagem conforme as palavras são reconhecidas.

// ===== Utilidades puras (testáveis) =====

// Normaliza texto para comparação: minúsculas, sem acentos, sem pontuação.
export function normalizeText(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Divide um texto normalizado em palavras.
export function tokenize(str) {
  if (!str) return [];
  return normalizeText(str).split(" ").filter(Boolean);
}

// Constrói um índice de palavras por linha a partir das linhas de texto.
export function buildLineIndex(lines) {
  return (lines || [])
    .map((line, idx) => {
      const words = tokenize(line);
      return { idx, words, total: words.length, joined: normalizeText(line) };
    })
    .filter(l => l.total > 0);
}

// Verifica se a sequência de palavras `seq` aparece como subsequência
// CONTÍGUA (janela) dentro de `buffer` (comparação palavra a palavra).
function containsSequence(buffer, seq) {
  if (seq.length === 0 || buffer.length === 0) return false;
  for (let start = 0; start + seq.length <= buffer.length; start++) {
    let ok = true;
    for (let k = 0; k < seq.length; k++) {
      if (buffer[start + k] !== seq[k]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// Encontra a melhor linha correspondente a um buffer de palavras transcritas.
// Retorna o índice da linha (no array original) ou -1 se não houver match.
// Devolve a linha com a MAIOR sequência contígua de palavras presentes no
// buffer. Exige no mínimo `MIN_MATCH` palavras (evita falso positivo com
// palavras isoladas como "a", "de", "o").
export function matchLine(lyrics, bufferWords, minMatch = 2) {
  const index = buildLineIndex(lyrics);
  if (index.length === 0 || bufferWords.length === 0) return -1;

  let best = -1;
  let bestLen = 0;

  for (const entry of index) {
    if (entry.total === 0) continue;

    let longest = 0;
    const words = entry.words;
    for (let len = Math.min(words.length, Math.min(bufferWords.length, 40)); len >= minMatch; len--) {
      let found = false;
      for (let start = 0; start + len <= words.length; start++) {
        if (containsSequence(bufferWords, words.slice(start, start + len))) { found = true; break; }
      }
      if (found) { longest = len; break; }
    }

    if (longest > bestLen) {
      bestLen = longest;
      best = entry.idx;
    }
  }

  return best;
}

// ===== Integração Web Speech API =====

export class VoiceSync {
  constructor({ onLine = () => {}, lang = "pt-BR" } = {}) {
    this.onLine = onLine;
    this.lang = lang;
    this.recognition = null;
    this.active = false;
    this.lyrics = [];
    this.lineIndex = buildLineIndex(this.lyrics);
    this.buffer = [];       // palavras transcritas acumuladas
    this.currentLine = -1;  // última linha acionada
    this.lastWordTime = 0;
    this.restartTimeout = null;
    this.manualBufferWindow = 40000; // ms: janela para "esquecer" palavras antigas
  }

  isSupported() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SR;
  }

  setLyrics(lines) {
    this.lyrics = (lines || []).map(l => (typeof l === "string" ? l : l.text || ""));
    this.lineIndex = buildLineIndex(this.lyrics);
    this.reset();
  }

  start() {
    if (this.active) return true;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    this.active = true;
    this.reset();

    const rec = new SR();
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => this._onResult(event);
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.stop();
      }
      // Demais erros (network/no-speech/aborted) — tenta reiniciar.
      else if (this.active) {
        this._scheduleRestart();
      }
    };
    rec.onend = () => {
      // O reconhecimento contínuo encerra sozinho; reinicia se ainda ativo.
      if (this.active) this._scheduleRestart();
    };

    this.recognition = rec;
    try {
      rec.start();
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.active = false;
    if (this.restartTimeout) { clearTimeout(this.restartTimeout); this.restartTimeout = null; }
    if (this.recognition) {
      try { this.recognition.stop(); } catch {}
      this.recognition = null;
    }
    this.reset();
  }

  _scheduleRestart() {
    if (!this.active) return;
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    this.restartTimeout = setTimeout(() => {
      if (!this.active) return;
      try {
        this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        this.recognition.lang = this.lang;
        this.recognition.interimResults = true;
        this.recognition.continuous = true;
        const rec = this.recognition;
        rec.onresult = (e) => this._onResult(e);
        rec.onerror = (e) => { if (this.active && (e.error === "not-allowed" || e.error === "service-not-allowed")) this.stop(); };
        rec.onend = () => { if (this.active) this._scheduleRestart(); };
        rec.start();
      } catch { this.stop(); }
    }, 250);
  }

  _onResult(event) {
    const now = Date.now();

    // Descarta palavras antigas fora da janela (evita match em trechos já cantados).
    if (this.lastWordTime && (now - this.lastWordTime) > this.manualBufferWindow) {
      this.buffer = [];
    }
    this.lastWordTime = now;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        const transcript = res[0].transcript;
        const words = tokenize(transcript);
        if (words.length) {
          this.buffer = this.buffer.concat(words);
          // Mantém buffer razoável (últimas ~200 palavras)
          if (this.buffer.length > 200) this.buffer = this.buffer.slice(-200);
          this._tryAdvance();
        }
        this.buffer = this.buffer.slice(-Math.min(this.buffer.length, 80));
      }
    }
  }

  _tryAdvance() {
    const target = matchLine(this.lyrics, this.buffer);
    if (target >= 0) {
      // Só avança (nunca recua) para evitar saltos bruscos ao re-cantar.
      if (target > this.currentLine) {
        this.currentLine = target;
        this.onLine(target, this.lyrics[target] || "");
      }
    }
  }

  reset() {
    this.buffer = [];
    this.currentLine = -1;
    this.lastWordTime = 0;
  }
}
