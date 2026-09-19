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
  // raw vem do backend: { entries: [{name, text, pos}], letra }
  // Normaliza para formato interno
  const chords = (raw.entries || []).map(e => ({
    name: normalizeChordName(e.name),
    display: e.text,
    originalName: e.name,
    pos: e.pos
  }));
  
  let text = raw.letra || "";
  // Limpa entidades
  text = decodeHtmlEntities(text);
  
  return { chords, text };
}

// Normaliza um array de linhas de qualquer formato ({entries,letra} ou {chords,text})
// para o formato interno {chords, text, raw}.
export function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(line => {
    if (line.chords && line.text !== undefined) return line;
    if (line.entries || line.letra) return parseLine(line);
    return { chords: [], text: line.letra || line.text || "" };
  });
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
  // &amp; por último, para não decodificar duas vezes ("&amp;lt;" -> "&lt;")
  return String(str)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
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

// Detecta se uma linha é uma tablatura (tab) de guitarra/violão
export function isTabLine(line) {
  const text = (line.text || "").trim();
  if (!text) return false;
  // Linhas de tab começam por uma corda: E A D G B e (maiúscula ou minúscula),
  // seguida de | ou -. Ex.: "E|----", "B|-12-", "A|--x--", "e|-----"
  const startsWithString = /^[EeAaDdGgBb]{1,2}[\||-]/.test(text);
  const hasLongDashes = text.replace(/\s/g, "").includes("----") && /[EeAaDdGgBb]/.test(text.charAt(0));
  // Bloco de tab dominado por caracteres de tablatura
  const tabChars = (text.match(/[-|xX*\/\\~rhp0-9]/g) || []).length;
  const tabRatio = tabChars / text.length;
  return startsWithString || hasLongDashes || (tabRatio > 0.55 && /[|xX*0-9-]/.test(text));
}

// Converte linhas para HTML renderizável (acordes inline na posição exata)
export function linesToHtml(lines, transposeMap = {}) {
  return lines.map(line => {
    const tabClass = isTabLine(line) ? ' tab-line' : '';
    const fullText = line.text;
    let html = "";
    let prev = 0;
    
    line.chords.forEach((chord) => {
      const chordName = transposeMap[chord.name] || chord.name;
      const display = chord.display || chordName;
      let pos = (typeof chord.pos === 'number') ? chord.pos : fullText.indexOf(display, prev);
      if (pos < prev) pos = prev;
      if (pos > prev && pos < fullText.length) {
        html += escapeHtml(fullText.slice(prev, pos));
      }
      html += `<span class="chord" data-original="${escapeHtml(chord.name)}">${escapeHtml(chordName)}</span>`;
      prev = pos + display.length;
    });
    
    if (prev < fullText.length) {
      html += escapeHtml(fullText.slice(prev));
    }
    
    return `<div class="cifra-line${tabClass}">${html}</div>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SECTION_WORDS = [
  'verso', 'refr', 'ponte', 'solo', 'intro', 'final', 'instrumental',
  'pré-refr', 'pre-refr', 'outro', 'pré'
];

// Detecta se um texto representa uma tag de seção (Verso, Refrão, Ponte, etc.).
export function isSectionLike(text) {
  if (!text) return false;
  const trimmed = String(text).trim();
  const t = trimmed.toLowerCase();
  // Entre colchetes: [Verso 1], [Refrão]
  if (/^\[.*\]$/.test(trimmed)) return true;
  // Termina com ":" e contém palavra-chave (ex.: "Refrão:")
  if (/^.{1,20}:$/.test(trimmed)) {
    return SECTION_WORDS.some(w => t.includes(w));
  }
  // Contém palavra-chave de seção
  return SECTION_WORDS.some(w => t.includes(w));
}

// Formata para exibição clássica (acordes acima da sílaba correspondente).
// Cada acorde vira um "chunk" inline-flex com a letra que vem depois dele:
// o texto quebra por palavra em vez de estourar o container. Antes a linha
// de acordes usava white-space: pre com colunas fixas e qualquer linha mais
// larga que a tela cortava letra/acorde à direita (overflow-x: hidden).
export function linesToClassic(lines, transposeMap = {}) {
  return lines.map(line => {
    const tabClass = isTabLine(line) ? ' tab-line' : '';
    const textLines = String(line.text || '').split('\n');
    const chords = line.chords || [];

    // Linha só de letra (ou tab): quebra em vez de cortar
    if (chords.length === 0) {
      return `<div class="cifra-line classic-text${tabClass}">${escapeHtml(textLines.join('\n'))}</div>`;
    }

    const first = textLines[0] || '';
    const firstLen = first.length;

    // Normaliza posições (clamp na primeira linha, mantém ordem crescente)
    let prev = 0;
    const positions = chords.map(chord => {
      let pos = typeof chord.pos === 'number' ? chord.pos : prev;
      if (pos > firstLen) pos = firstLen;
      if (pos < prev) pos = prev;
      prev = pos;
      return pos;
    });

    let html = `<div class="cifra-line classic chunked${tabClass}">`;

    // Letra antes do primeiro acorde (sem acorde no início da linha)
    if (positions[0] > 0) {
      html += `<span class="chunk"><span class="txt">${escapeHtml(first.slice(0, positions[0]))}</span></span>`;
    }

    chords.forEach((chord, i) => {
      const display = transposeMap[chord.name] || chord.name;
      const end = i + 1 < positions.length ? positions[i + 1] : firstLen;
      const seg = first.slice(positions[i], end);
      html += `<span class="chunk"><span class="chord" data-original="${escapeHtml(chord.name)}">${escapeHtml(display)}</span><span class="txt">${escapeHtml(seg)}</span></span>`;
    });

    // As linhas de letra seguintes (o parser agrupa várias linhas de letra
    // sob os mesmos acordes) ficam no MESMO .cifra-line (para preservar o
    // índice da linha no voice sync), cada uma quebrando para a linha de baixo
    // via .nl, sem acorde próprio.
    for (let i = 1; i < textLines.length; i++) {
      const text = textLines[i];
      if (text.trim() === '') continue;
      html += `<span class="chunk nl"><span class="txt">${escapeHtml(text)}</span></span>`;
    }
    html += '</div>';
    return html;
  }).join("");
}