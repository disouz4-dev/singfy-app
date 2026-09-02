// test-parser.mjs — Teste local do parser com HTML real do Cifra Club
import { parseSongResponse, linesToHtml, linesToClassic, extractUniqueChords, detectKeyFromLines } from './public/js/parser.js';
import { transposeSong, transposeChord, getHarmonicField, detectKey, formatChord } from './public/js/transpose.js';
import fs from 'fs';

// Lê o HTML salvo anteriormente
const html = fs.readFileSync('/tmp/opencode/cifra.html', 'utf-8');

// Simula resposta da Cloud Function (extraindo dados do HTML real)
function mockExtractData(html) {
  // Usa a mesma lógica da Cloud Function
  // Para teste, vamos criar um mock baseado no que sabemos da estrutura
  return {
    name: "Tempo Perdido",
    artist: "Legião Urbana",
    tom: "Em",
    url: "https://www.cifraclub.com.br/legiao-urbana/tempo-perdido/",
    lines: parseHtmlLines(html),
    artistSlug: "legiao-urbana",
    songSlug: "tempo-perdido"
  };
}

function parseHtmlLines(html) {
  // Parser simplificado para teste - extrai div.kvMV
  const lines = [];
  const kvmvRegex = /<div class="kvMV">([\s\S]*?)<\/div>/g;
  let match;
  
  while ((match = kvmvRegex.exec(html)) !== null) {
    const inner = match[1];
    // Extrai acordes <b data-chord-name="...">...</b>
    const chords = [];
    const chordRegex = /<b data-chord-name="([^"]+)"[^>]*>([^<]+)<\/b>/g;
    let chordMatch;
    while ((chordMatch = chordRegex.exec(inner)) !== null) {
      chords.push({ name: chordMatch[1], text: chordMatch[2] });
    }
    // Texto da linha (remove tags)
    const text = inner.replace(/<[^>]+>/g, '').trim();
    lines.push({ entries: chords, letra: text });
  }
  return lines;
}

// Executa teste
const mockData = mockExtractData(html);
console.log('=== DADOS EXTRAÍDOS ===');
console.log('Nome:', mockData.name);
console.log('Artista:', mockData.artist);
console.log('Tom:', mockData.tom);
console.log('Linhas:', mockData.lines.length);

const parsed = parseSongResponse(mockData);
console.log('\n=== PARSEADO ===');
console.log('Metadata:', parsed.metadata);
console.log('Linhas parseadas:', parsed.lines.length);

const uniqueChords = extractUniqueChords(parsed.lines);
console.log('\n=== ACORDES ÚNICOS (', uniqueChords.length, ') ===');
console.log(uniqueChords.join(', '));

// Testa detecção de tom
const detected = detectKeyFromLines(parsed.lines);
console.log('\n=== TOM DETECTADO ===');
console.log(detected);

// Testa transposição
console.log('\n=== TESTE TRANSPOSIÇÃO ===');
const testChords = ['C', 'Am', 'F', 'G', 'Dm', 'Em', 'C7M', 'D/F#'];
testChords.forEach(c => {
  const t = transposeChord(c, 'C', 'G');
  console.log(`${c} (C→G) = ${t}`);
});

// Testa campo harmônico
console.log('\n=== CAMPO HARMÔNICO G ===');
console.log(getHarmonicField('G'));

// Testa transposição da música completa
console.log('\n=== TRANSPOSIÇÃO MÚSICA (Em → G) ===');
const { map, transposedLines } = transposeSong(parsed.lines, 'Em', 'G');
console.log('Mapa:', map);
console.log('Primeiras 3 linhas transpostas:');
transposedLines.slice(0, 3).forEach(l => {
  console.log(l.chords.map(c => c.name).join(' | '), '→', l.text.substring(0, 50));
});

// Testa renderização HTML
console.log('\n=== HTML RENDERIZADO (primeiras 2 linhas) ===');
const htmlOut = linesToClassic(parsed.lines.slice(0, 2));
console.log(htmlOut);

console.log('\n✅ Testes concluídos!');