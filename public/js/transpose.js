// transpose.js — Campo Harmônico e Transposição
// Implementação completa baseada na teoria musical

// Tabela do Campo Harmônico Maior (tríades)
export const MAJOR_FIELD = {
  "C":  { I:"C",   ii:"Dm",  iii:"Em",  IV:"F",  V:"G",  vi:"Am",  vii:"Bdim" },
  "C#": { I:"C#",  ii:"D#m", iii:"E#m", IV:"F#", V:"G#", vi:"A#m", vii:"B#dim" },
  "Db": { I:"Db",  ii:"Ebm", iii:"Fm",  IV:"Gb", V:"Ab", vi:"Bbm", vii:"Cdim" },
  "D":  { I:"D",   ii:"Em",  iii:"F#m", IV:"G",  V:"A",  vi:"Bm",  vii:"C#dim" },
  "Eb": { I:"Eb",  ii:"Fm",  iii:"Gm",  IV:"Ab", V:"Bb", vi:"Cm",  vii:"Ddim" },
  "E":  { I:"E",   ii:"F#m", iii:"G#m", IV:"A",  V:"B",  vi:"C#m", vii:"D#dim" },
  "F":  { I:"F",   ii:"Gm",  iii:"Am",  IV:"Bb", V:"C",  vi:"Dm",  vii:"Edim" },
  "F#": { I:"F#",  ii:"G#m", iii:"A#m", IV:"B",  V:"C#", vi:"D#m", vii:"E#dim" },
  "Gb": { I:"Gb",  ii:"Abm", iii:"Bbm", IV:"Cb", V:"Db", vi:"Ebm", vii:"Fdim" },
  "G":  { I:"G",   ii:"Am",  iii:"Bm",  IV:"C",  V:"D",  vi:"Em",  vii:"F#dim" },
  "Ab": { I:"Ab",  ii:"Bbm", iii:"Cm",  IV:"Db", V:"Eb", vi:"Fm",  vii:"Gdim" },
  "A":  { I:"A",   ii:"Bm",  iii:"C#m", IV:"D",  V:"E",  vi:"F#m", vii:"G#dim" },
  "Bb": { I:"Bb",  ii:"Cm",  iii:"Dm",  IV:"Eb", V:"F",  vi:"Gm",  vii:"Adim" },
  "B":  { I:"B",   ii:"C#m", iii:"D#m", IV:"E",  V:"F#", vi:"G#m", vii:"A#dim" }
};

// Campo Harmônico Menor Natural (tríades)
export const MINOR_NATURAL_FIELD = {
  "Am": { i:"Am", ii:"Bdim", III:"C", iv:"Dm", v:"Em", VI:"F", VII:"G" },
  "A#m": { i:"A#m", ii:"B#dim", III:"C#", iv:"D#m", v:"E#m", VI:"F#", VII:"G#" },
  "Bbm": { i:"Bbm", ii:"Cdim", III:"Db", iv:"Ebm", v:"Fm", VI:"Gb", VII:"Ab" },
  "Bm": { i:"Bm", ii:"C#dim", III:"D", iv:"Em", v:"F#m", VI:"G", VII:"A" },
  "Cm": { i:"Cm", ii:"Ddim", III:"Eb", iv:"Fm", v:"Gm", VI:"Ab", VII:"Bb" },
  "C#m": { i:"C#m", ii:"D#dim", III:"E", iv:"F#m", v:"G#m", VI:"A", VII:"B" },
  "Dm": { i:"Dm", ii:"Edim", III:"F", iv:"Gm", v:"Am", VI:"Bb", VII:"C" },
  "D#m": { i:"D#m", ii:"E#dim", III:"F#", iv:"G#m", v:"A#m", VI:"B", VII:"C#" },
  "Ebm": { i:"Ebm", ii:"Fdim", III:"Gb", iv:"Abm", v:"Bbm", VI:"Cb", VII:"Db" },
  "Em": { i:"Em", ii:"F#dim", III:"G", iv:"Am", v:"Bm", VI:"C", VII:"D" },
  "Fm": { i:"Fm", ii:"Gdim", III:"Ab", iv:"Bbm", v:"Cm", VI:"Db", VII:"Eb" },
  "F#m": { i:"F#m", ii:"G#dim", III:"A", iv:"Bm", v:"C#m", VI:"D", VII:"E" },
  "Gm": { i:"Gm", ii:"Adim", III:"Bb", iv:"Cm", v:"Dm", VI:"Eb", VII:"F" },
  "G#m": { i:"G#m", ii:"A#dim", III:"B", iv:"C#m", v:"D#m", VI:"E", VII:"F#" },
};

// Graus maiores (para identificação IV-V)
const MAJOR_DEGREES = ["I", "IV", "V"];
const MINOR_DEGREES = ["ii", "iii", "vi"];
const DIM_DEGREES = ["vii°", "ii°"];

// Qualidade do acorde baseada no grau
export function getChordQuality(degree) {
  if (MAJOR_DEGREES.includes(degree)) return "major";
  if (MINOR_DEGREES.includes(degree)) return "minor";
  if (DIM_DEGREES.includes(degree)) return "diminished";
  if (degree === "vii") return "diminished";
  return "unknown";
}

// Converte acorde para notação de grau relativo ao tom
export function chordToDegree(chord, key) {
  const field = MAJOR_FIELD[key];
  if (!field) return null;
  
  const baseChord = extractBaseChord(chord);
  
  for (const [deg, ch] of Object.entries(field)) {
    if (chordsEqual(baseChord, ch)) return deg;
  }
  // Tenta campo menor relativo
  const relMinor = getRelativeMinor(key);
  const minorField = MINOR_NATURAL_FIELD[relMinor];
  if (minorField) {
    for (const [deg, ch] of Object.entries(minorField)) {
      if (chordsEqual(baseChord, ch)) return deg.toLowerCase();
    }
  }
  return null;
}

// Transpõe um acorde de um tom para outro mantendo qualidade e extensões
export function transposeChord(chord, fromKey, toKey) {
  if (!chord || !fromKey || !toKey) return chord;
  
  const degree = chordToDegree(chord, fromKey);
  if (!degree) {
    // Fallback: transposição cromática simples
    return chromaticTranspose(chord, semitoneDistance(fromKey, toKey));
  }
  
  const targetField = MAJOR_FIELD[toKey] || MINOR_NATURAL_FIELD[toKey];
  if (!targetField) return chord;
  
  const targetBase = targetField[degree.toUpperCase()] || targetField[degree.toLowerCase()];
  if (!targetBase) return chord;
  
  // Preserva extensões (7, 9, sus, add, /baixo)
  return applyExtensions(targetBase, getExtensions(chord));
}

// Transposição cromática pura (para acordes fora do campo)
function chromaticTranspose(chord, semitones) {
  if (semitones === 0) return chord;
  
  const base = extractBaseChord(chord);
  const ext = getExtensions(chord);
  const newBase = transposeNoteName(base, semitones);
  return applyExtensions(newBase, ext);
}

// Extrai a fundamental do acorde (ex: "C#m7(b5)/E" -> "C#m")
function extractBaseChord(chord) {
  // Remove baixo (/X)
  const noBass = chord.split("/")[0];
  // Pega a raiz + qualidade básica (m, dim, °, +, aug)
  const match = noBass.match(/^([A-G](#|b)?)(m|dim|°|\+|aug|maj|sus\d?)?/i);
  if (match) return match[1] + (match[3] || "");
  return noBass;
}

// Extrai extensões do acorde (7, 9, 11, 13, sus, add, alterações)
function getExtensions(chord) {
  const noBass = chord.split("/")[0];
  const base = extractBaseChord(chord);
  return noBass.slice(base.length); // tudo depois da base
}

// Aplica extensões a uma nova fundamental
function applyExtensions(base, extensions) {
  return base + extensions;
}

// Transpõe apenas o nome da nota (C -> D, etc)
function transposeNoteName(note, semitones) {
  const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const ENHARMONIC = { "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#" };
  
  const n = ENHARMONIC[note] || note;
  const idx = NOTE_ORDER.indexOf(n);
  if (idx === -1) return note;
  return NOTE_ORDER[(idx + semitones + 12) % 12];
}

// Distância em semitons entre duas notas
function semitoneDistance(note1, note2) {
  const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const ENHARMONIC = { "Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#" };
  const n1 = ENHARMONIC[note1] || note1;
  const n2 = ENHARMONIC[note2] || note2;
  return (NOTE_ORDER.indexOf(n2) - NOTE_ORDER.indexOf(n1) + 12) % 12;
}

// Compara dois acordes ignorando extensões
function chordsEqual(a, b) {
  return extractBaseChord(a).toLowerCase() === extractBaseChord(b).toLowerCase();
}

// Menor relativo (vi do maior)
export function getRelativeMinor(majorKey) {
  const field = MAJOR_FIELD[majorKey];
  return field ? field.vi : null;
}

// Maior relativo (III do menor)
export function getRelativeMajor(minorKey) {
  const field = MINOR_NATURAL_FIELD[minorKey];
  return field ? field.III : null;
}

// Obtém campo harmônico completo para um tom
export function getHarmonicField(key, mode = "major") {
  if (mode === "major") return MAJOR_FIELD[key] || null;
  if (mode === "minor") return MINOR_NATURAL_FIELD[key] || null;
  return null;
}

// Analisa progressão e retorna graus
export function analyzeProgression(chords, key) {
  return chords.map(c => chordToDegree(c, key) || "?");
}

// Detecta tom provável a partir de lista de acordes
export function detectKey(chords) {
  // Conta ocorrências de cada acorde
  const counts = {};
  chords.forEach(c => {
    const base = extractBaseChord(c);
    counts[base] = (counts[base] || 0) + 1;
  });
  
  // Testa cada tom maior
  let bestKey = null;
  let bestScore = 0;
  
  for (const [key, field] of Object.entries(MAJOR_FIELD)) {
    let score = 0;
    for (const [deg, chord] of Object.entries(field)) {
      if (counts[chord]) score += counts[chord] * (deg === "I" ? 3 : 1);
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  
  // Testa menores naturais
  for (const [key, field] of Object.entries(MINOR_NATURAL_FIELD)) {
    let score = 0;
    for (const [deg, chord] of Object.entries(field)) {
      if (counts[chord]) score += counts[chord] * (deg === "i" ? 3 : 1);
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  
  return bestKey;
}

// Transpõe todas as linhas de uma música
export function transposeSong(lines, fromKey, toKey) {
  const map = {};
  const allChords = new Set();
  lines.forEach(l => l.chords.forEach(c => allChords.add(c.name)));
  
  allChords.forEach(chord => {
    map[chord] = transposeChord(chord, fromKey, toKey);
  });
  
  return { map, transposedLines: lines.map(l => ({
    ...l,
    chords: l.chords.map(c => ({ ...c, name: map[c.name] }))
  })) };
}

// Formata acorde para exibição (HTML com sup/sub para alterações)
export function formatChord(chord) {
  return chord
    .replace(/#/g, "<sup>#</sup>")
    .replace(/b/g, "<sup>b</sup>")
    .replace(/\(b5\)/g, "<sup>(b5)</sup>")
    .replace(/\(#5\)/g, "<sup>(#5)</sup>")
    .replace(/\(b9\)/g, "<sup>(b9)</sup>")
    .replace(/\(#9\)/g, "<sup>(#9)</sup>")
    .replace(/\(b13\)/g, "<sup>(b13)</sup>")
    .replace(/maj7/g, "<sup>maj7</sup>")
    .replace(/m7/g, "<sup>m7</sup>")
    .replace(/7(?![0-9])/g, "<sup>7</sup>")
    .replace(/9/g, "<sup>9</sup>")
    .replace(/11/g, "<sup>11</sup>")
    .replace(/13/g, "<sup>13</sup>")
    .replace(/sus4/g, "<sup>sus4</sup>")
    .replace(/sus2/g, "<sup>sus2</sup>")
    .replace(/add9/g, "<sup>add9</sup>")
    .replace(/°/g, "<sup>°</sup>")
    .replace(/dim/g, "<sup>dim</sup>")
    .replace(/\//g, "/");
}

// Gera botões de transposição (-6 a +6 semitons)
export function generateTransposeButtons(currentKey, onTranspose) {
  const semitones = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
  return semitones.map(st => {
    const newKey = transposeKeyBySemitones(currentKey, st);
    return {
      semitones: st,
      key: newKey,
      label: st === 0 ? "Original" : (st > 0 ? `+${st}` : `${st}`),
      active: st === 0,
      onClick: () => onTranspose(st)
    };
  });
}

// Transpõe um tom por semitons (mantém modo maior/menor)
function transposeKeyBySemitones(key, semitones) {
  const isMinor = key.endsWith("m");
  const base = key.replace("m", "");
  const newBase = transposeNoteName(base, semitones);
  return newBase + (isMinor ? "m" : "");
}

// Escala cromática para referência
export const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const CHROMATIC_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];