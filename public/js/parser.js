// parser.js — Parsing de resposta da Cloud Function (Cifra Club)
// Retorna estrutura normalizada para o app

export function parseSongResponse(data) {
  if (!data || data.error) throw new Error(data.error || "Dados inválidos");
  
  const lines = (data.lines || []).map(parseLine);
  const metadata = {
    name: data.name || data.songSlug || "Sem nome",
    artist: data.artist || data.artistSlug || "Desconhecido",
    tom: data.tom || detectKeyFromLines(lines),
    url: data.url,
    artistSlug: data.artistSlug,
    songSlug: data.songSlug,
  };
  
  return { metadata, lines };
}

function parseLine(raw) {
  // raw vem do backend: { entries: [{name, text}], letra }
  // Normaliza para formato interno
  const chords = (raw.entries || []).map(e => ({
    name: normalizeChordName(e.name),
    display: e.text,
    originalName: e.name
  }));
  
  let text = raw.letra || "";
  // Limpa entidades
  text = decodeHtmlEntities(text);
  
  return { chords, text, raw };
}

function normalizeChordName(name) {
  if (!name) return "";
  // Remove espaços extras, padroniza sustenido/bemol
  return name.trim()
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/\s+/g, "");
}

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "\"")
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/'/g, "'");
}

// Heurística: detecta tom a partir dos acordes das linhas
export function detectKeyFromLines(lines) {
  const chords = lines.flatMap(l => l.chords.map(c => c.name)).filter(Boolean);
  if (chords.length === 0) return null;
  
  // Último acorde (mais provável tônica)
  const last = chords[chords.length - 1];
  const baseLast = last.replace(/[^A-G#b].*/, "");
  
  // Dois maiores a 1 tom = IV e V
  const majors = chords
    .filter(c => /^[A-G](#|b)?$/.test(c.replace(/m.*/, "").replace(/7.*/, "").replace(/maj.*/, "").replace(/dim.*/, "").replace(/°/, "")))
    .map(c => c.replace(/m.*/, "").replace(/7.*/, "").replace(/maj.*/, "").replace(/dim.*/, "").replace(/°/, ""));
  
  // Tenta achar par IV-V
  for (let i = 0; i < majors.length - 1; i++) {
    const interval = semitoneDistance(majors[i], majors[i+1]);
    if (interval === 2 || interval === -10) { // 1 tom = 2 semitons
      // O maior mais grave é IV, o mais agudo é V
      const iv = majors[i];
      const v = majors[i+1];
      // Tônica = V - 5 semitons (ou IV + 5)
      return transposeNote(v, -5);
    }
  }
  
  return baseLast;
}

const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ENHARMONIC = { "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "E#": "F", "B#": "C", "Cb": "B", "Fb": "E" };

function noteToIndex(note) {
  const n = ENHARMONIC[note] || note;
  return NOTE_ORDER.indexOf(n);
}

function indexToNote(idx) {
  return NOTE_ORDER[(idx + 12) % 12];
}

function semitoneDistance(note1, note2) {
  return (noteToIndex(note2) - noteToIndex(note1) + 12) % 12;
}

function transposeNote(note, semitones) {
  const idx = noteToIndex(note);
  return indexToNote(idx + semitones);
}

// Extrai todos os acordes únicos da música
export function extractUniqueChords(lines) {
  const set = new Set();
  lines.forEach(l => l.chords.forEach(c => set.add(c.name)));
  return Array.from(set);
}

// Converte linhas para HTML renderizável (preserva acordes inline)
export function linesToHtml(lines, transposeMap = {}) {
  return lines.map(line => {
    let html = "";
    let textIdx = 0;
    const fullText = line.text;
    
    line.chords.forEach((chord, i) => {
      const chordName = transposeMap[chord.name] || chord.name;
      const displayName = chord.display;
      const pos = fullText.indexOf(displayName, textIdx);
      
      if (pos > textIdx) {
        html += escapeHtml(fullText.slice(textIdx, pos));
      }
      html += `<span class="chord" data-original="${escapeHtml(chord.name)}">${escapeHtml(chordName)}</span>`;
      textIdx = pos + displayName.length;
    });
    
    if (textIdx < fullText.length) {
      html += escapeHtml(fullText.slice(textIdx));
    }
    
    return `<div class="cifra-line">${html}</div>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "\"")
    .replace(/'/g, "'");
}

// Formata para exibição clássica (acordes acima, letra abaixo)
export function linesToClassic(lines, transposeMap = {}) {
  return lines.map(line => {
    if (line.chords.length === 0 && line.text.trim()) {
      return `<div class="cifra-line classic-text">${escapeHtml(line.text)}</div>`;
    }
    
    // Constrói linha de acordes alinhada (aproximação)
    let chordLine = "";
    let textLine = line.text;
    let lastPos = 0;
    
    line.chords.forEach(chord => {
      const display = transposeMap[chord.name] || chord.name;
      const pos = textLine.indexOf(chord.display, lastPos);
      if (pos >= 0) {
        const spaces = pos - lastPos;
        chordLine += " ".repeat(spaces) + display;
        lastPos = pos + chord.display.length;
      }
    });
    
    return `
      <div class="cifra-line classic">
        <div class="chord-row">${escapeHtml(chordLine)}</div>
        <div class="text-row">${escapeHtml(textLine)}</div>
      </div>
    `;
  }).join("");
}