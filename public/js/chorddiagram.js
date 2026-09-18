// chorddiagram.js — Diagramas de formação de acordes (tooltip ao passar o mouse)
// Usa a biblioteca SVGuitar (carregada via /js/svguitar.umd.js) para desenhar
// o diagrama de cada acorde em SVG.

// Base de voicings (afinação EADGBE). Formato: 6 caracteres, da corda grave (6)
// para a aguda (1). 'x' = corda muda, '0' = corda solta, número = casa.
// Inclui os acordes mais comuns (abertos + pestana).
export const CHORD_SHAPES = {
  // Maiores (abertos)
  "C": "x32010", "D": "xx0232", "E": "022100", "G": "320003", "A": "x02220",
  // Maiores com pestana / outras posições
  "B": "x24442", "F": "133211", "F#": "244322", "Gb": "244322",
  "C#": "x46664", "Db": "x46664", "D#": "xx1343", "Eb": "x68886",
  "G#": "466544", "Ab": "466544", "A#": "x13331", "Bb": "x13331",
  // Menores (abertos)
  "Am": "x02210", "Em": "022000", "Dm": "xx0231",
  // Menores (pestana)
  "Bm": "x24432", "Fm": "133111", "F#m": "244222", "Gbm": "244222",
  "C#m": "x46654", "Dbm": "x46654", "D#m": "xx1342", "Ebm": "x68876",
  "G#m": "466444", "Abm": "466444", "A#m": "x13321", "Bbm": "x13321",
  "C": "x32010",
  // Sétimas dominantes
  "C7": "x32310", "D7": "xx0212", "E7": "020100", "G7": "320001", "A7": "x02020", "B7": "x21202", "F7": "131211",
  // Sétimas menores
  "Cm7": "x35343", "Dm7": "xx0211", "Em7": "020000", "Fm7": "131111", "Gm7": "353333", "Am7": "x02010", "Bm7": "x20202",
  // Sétimas maiores
  "Cmaj7": "x32000", "Dmaj7": "xx0222", "Emaj7": "021100", "Fmaj7": "132211", "Gmaj7": "320002", "Amaj7": "x02120", "Bmaj7": "x24342",
  // Suspensos
  "Csus2": "x30010", "Dsus2": "xx0230", "Esus2": "024000", "Gsus2": "300033", "Asus2": "x02200",
  "Csus4": "x33010", "Dsus4": "xx0233", "Esus4": "022200", "Gsus4": "320013", "Asus4": "x02230",
  // Diminutos
  "Cdim": "x3454x", "Edim": "xx2323", "Gdim": "3453x5",
  // Aumentados
  "Caug": "x32110", "Eaug": "032110", "Gaug": "32110x"
};

// Converte uma shape-string para o formato de fingers do SVGuitar.
// Retorna { fingers: [[string, fret|'x'|0, text?], ...], barres: [] }
export function shapeToFingers(shape) {
  if (!shape || shape.length < 6) return [];
  const fingers = [];
  for (let s = 0; s < 6; s++) {
    const ch = shape[s];
    const str = s + 1; // string 1 = aguda(E), 6 = grave; shape é do grave ao agudo
    const displayString = 6 - s; // SVGuitar usa string 1..6
    if (ch === "x") {
      fingers.push([displayString, "x"]);
    } else if (ch === "0") {
      // corda solta — não adiciona dedo em casa, mas marca como aberta
      fingers.push([displayString, 0]);
    } else {
      const fret = parseInt(ch, 16);
      fingers.push([displayString, fret, String(fret)]);
    }
  }
  return fingers;
}

// Encontra a shape correspondente a um acorde (busca exata, senão por prefixo).
export function lookupChordShape(chordName) {
  if (!chordName) return null;
  const key = chordName.trim();
  if (CHORD_SHAPES[key]) return CHORD_SHAPES[key];
  // Fallback: tenta sem sufixos comuns não suportados, ex.: Cmaj -> C
  const base = key.replace(/^([A-G][#b]?).*$/, "$1");
  return CHORD_SHAPES[base] || null;
}

// Gera a string SVG do diagrama de um acorde usando SVGuitar (sem container).
export function renderChordDiagramSvg(chordName, opts = {}) {
  const shape = lookupChordShape(chordName);
  if (!shape) return null;
  const svguitar = window.svguitar;
  if (!svguitar || typeof svguitar.SVGuitarChord !== "function") return null;

  try {
    const chart = new svguitar.SVGuitarChord(null);
    chart.configure({
      size: opts.size || 160,
      color: opts.color || "#00d4aa",
      fontFamily: "'JetBrains Mono', monospace",
    });
    chart.chord({
      fingers: shapeToFingers(shape),
      barres: [],
      title: chordName,
    });
    chart.draw();
    return chart.toSvg();
  } catch (err) {
    console.warn("Erro ao gerar diagrama de acorde:", chordName, err);
    return null;
  }
}
