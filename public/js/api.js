// api.js — Busca de cifras

// Backend gratuito: Jina Reader (r.jina.ai) serve a página do Cifra Club
// com CORS liberado. Pedimos o HTML BRUTO (e não markdown) porque só o HTML
// preserva a posição real de cada acorde sobre a letra (o tempo em que é tocado).
// O markdown colapsa esses espaços e as cifras ficam desalinhadas.

const READER_BASE = "https://r.jina.ai/";

export async function fetchSong(artist, song) {
  const cifraUrl = `https://www.cifraclub.com.br/${slug(artist)}/${slug(song)}/`;
  const readerUrl = `${READER_BASE}${cifraUrl}`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(readerUrl, {
        headers: {
          "Accept": "text/html, */*",
          "X-Return-Format": "html"
        }
      });
      if (!res.ok) {
        throw new Error(`Erro ${res.status} ao acessar a cifra.`);
      }
      const text = await res.text();
      if (!text || /error code: 522|title: 522/i.test(text)) {
        throw new Error("A cifra não pôde ser carregada (serviço temporariamente indisponível).");
      }
      const parsed = parseCifraHtml(text, cifraUrl);
      // Se não houver linhas úteis (Jina devolveu o shell da página sem o conteúdo),
      // tenta novamente antes de desistir.
      if (parsed && parsed.lines && parsed.lines.length > 0) {
        return parsed;
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 600 * attempt));
        continue;
      }
      throw new Error("A cifra não pôde ser extraída da página.");
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 600 * attempt));
        continue;
      }
      console.warn("Falha ao buscar cifra:", err);
      throw new Error(`Não foi possível buscar "${artist} - ${song}".\n${err.message}`);
    }
  }
  throw new Error(`Não foi possível buscar "${artist} - ${song}".`);
}

// Busca as faixas (título + artista, em ordem) de uma playlist pública do Spotify.
// Usa o "embed" da playlist porque ele serve o HTML estaticamente, sem logar.
export async function fetchSpotifyPlaylistTracks(playlistId) {
  const embedUrl = `https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`;
  const readerUrl = `${READER_BASE}${embedUrl}`;

  const res = await fetch(readerUrl, {
    headers: {
      "Accept": "text/html, */*",
      "X-Return-Format": "html"
    }
  });
  if (!res.ok) throw new Error(`Não foi possível ler a playlist (erro ${res.status}).`);
  const text = await res.text();
  if (!text || /error code: 522|title: 522/i.test(text)) {
    throw new Error("Não foi possível ler a playlist (serviço temporariamente indisponível).");
  }

  const pat = /TracklistRow_title__[^>]*>(.*?)<\/h3>.*?TracklistRow_subtitle___[^>]*>(.*?)<\/h4>/gs;
  const tracks = [];
  let m;
  while ((m = pat.exec(text)) !== null) {
    const title = decodeEntities(stripTags(m[1])).trim();
    // Remove o selo "E" (Explicit) que fica dentro do subtítulo — senão o
    // artista vira "E Tame Impala" e a busca no Cifra Club falha.
    const subtitle = m[2].replace(/<span[^>]*data-testid="tag"[^>]*>.*?<\/span>/gs, "");
    const rawArtist = decodeEntities(stripTags(subtitle)).trim();
    if (!title) continue;
    const artists = rawArtist.split(/\s*[,·]\s*/).filter(Boolean);
    tracks.push({
      title,
      artist: artists.join(", ") || rawArtist,
      mainArtist: artists[0] || rawArtist // Cifra Club usa só o artista principal na URL
    });
  }
  return tracks;
}

// Extrai o ID de uma URL de playlist do Spotify (open.spotify.com/playlist/<id>)
// Aceita também intl-pt-BR/ e URIs spotify:playlist:<id>
export function extractSpotifyPlaylistId(url) {
  const m = String(url || "").match(/(?:open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?playlist\/|spotify:playlist:)([A-Za-z0-9]{15,})/);
  return m ? m[1] : null;
}

// Títulos do Spotify trazem sufixos que não existem na URL do Cifra Club
// ("Música - Ao Vivo", "Música (feat. X)", "Música - Remastered 2011").
// Retorna os títulos a tentar, do mais limpo ao original.
export function spotifyTitleCandidates(title) {
  const original = String(title || "").trim();
  const cleaned = original
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "") // (feat. X), [Ao Vivo]
    .replace(/\s+-\s+.*$/, "")                // - Ao Vivo, - Remastered 2011
    .trim();
  return [...new Set([cleaned, original].filter(Boolean))];
}

// Decodifica entidades HTML comuns
function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;|&#60;/g, "<")
    .replace(/&gt;|&#62;/g, ">")
    .replace(/&quot;|&#34;/g, "\"")
    .replace(/&#39;|&#0*39;/g, "'")
    .replace(/&amp;|&#38;/g, "&");
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s{2,}/g, " ").trim();
}

// Extrai acordes (linha com <b data-chord-name>) em { chords, text } com a
// posição (coluna) de cada acorde preservando o espaçamento original.
function tokenizeChordLine(htmlLine) {
  const chords = [];
  let text = "";
  let col = 0;
  let i = 0;
  const n = htmlLine.length;
  while (i < n) {
    const bStart = htmlLine.indexOf('<b', i);
    if (bStart === -1) {
      const rest = htmlLine.slice(i);
      text += rest;
      col += rest.length;
      break;
    }
    if (bStart > i) {
      const seg = htmlLine.slice(i, bStart);
      text += seg;
      col += seg.length;
    }
    const nameM = /data-chord-name="([^"]+)"/.exec(htmlLine.slice(bStart, bStart + 300));
    const close = htmlLine.indexOf('</b>', bStart);
    if (close === -1) break;
    const gt = htmlLine.indexOf('>', bStart);
    const inner = gt !== -1 && gt < close ? htmlLine.slice(gt + 1, close) : "";
    const name = nameM ? nameM[1] : inner.trim() || "?";
    const display = decodeEntities(inner);
    chords.push({ name, text: display, pos: col });
    text += display;
    col += display.length;
    i = close + 4;
  }
  return { chords, text };
}

// Extrai título, artista e tom do HTML
function extractMeta(html) {
  let name = "", artist = "", tom = null;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) name = stripTags(h1[1]).trim();
  // Artista: primeiro <h2> que não seja apenas navegação (srOnly/header)
  const h2re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let hm;
  while ((hm = h2re.exec(html)) !== null) {
    if (/u-srOnly|sr-only/.test(hm[0]) === false && hm[1].trim().length > 0) {
      artist = stripTags(hm[1]).trim();
      break;
    }
  }
  const t = /data-anchor="--chord-tone"[^>]*>([A-Ga-g][^<]*?)<\/button>/i.exec(html) ||
            /Tom:\s*([A-Ga-g](#|b)?m?)/i.exec(html);
  if (t) tom = decodeEntities(t[1]).trim();
  return { name: name || "Sem nome", artist: artist || "Desconhecido", tom };
}

// Veio o bloco <pre data-chord-content="true"> que contém a cifra real
function findCifraBlock(html) {
  const m = /<pre[^>]*data-chord-content="true"[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  return m ? m[1] : null;
}

// Extrai bloco(s) delimitados por <openStr> ... </div>, preservando o
// aninhamento (contagem de <div> / </div>). Retorna os conteúdos internos.
function extractBalanced(html, openStr) {
  const results = [];
  let pos = 0;
  while (true) {
    const start = html.indexOf(openStr, pos);
    if (start === -1) break;
    const contentStart = start + openStr.length;
    let depth = 1;
    let j = contentStart;
    while (j < html.length && depth > 0) {
      const nOpen = html.indexOf('<div', j);
      const nClose = html.indexOf('</div>', j);
      if (nClose === -1) break;
      if (nOpen !== -1 && nOpen < nClose) { depth++; j = nOpen + 4; }
      else { depth--; j = nClose + 6; }
    }
    results.push(html.slice(contentStart, Math.max(contentStart, j - 6)));
    pos = j;
  }
  return results;
}

// Converte o HTML da cifra (divs .kvMV) em lines [{ entries, letra }]
function parseCifraLines(block) {
  const lines = [];
  const kvs = extractBalanced(block, '<div class="kvMV">');

  for (const origBlock of kvs) {
    // Grupo de tablaturas: extrai cada bloco <div class="tabs"> internamente,
    // sempre a partir do HTML original (com as tabs).
    if (/<div class="tabs"[^>]*>/i.test(origBlock)) {
      const tabs = origBlock.split(/<span class="tab">/i).slice(1);
      for (const tabInner of tabs) {
        const tabHtml = tabInner.split('</span>')[0];
        const tabRows = tabHtml.split('\n').filter(r => r.trim() !== "");
        let chords = [];
        const rowsOut = [];
        for (const row of tabRows) {
          if (/<b\s+data-chord-name/i.test(row)) {
            chords = tokenizeChordLine(row).chords;
            // acordes ficam no chord-row; não duplicar na linha de tab
          } else {
            rowsOut.push(decodeEntities(row).replace(/\s+$/, ""));
          }
        }
        lines.push({ entries: chords, letra: rowsOut.join('\n'), isTab: true });
      }
    }

    // Letra/acordes que ficam além das tabs (mesmo kvMV, ex.: início do refrão)
    parseVerseLines(stripTabChunks(origBlock), lines);
  }
  return lines;

  // Remove os blocos <div class="tabs">...</div> (e seus <span>), mantendo a
  // letra/acordes que vêm antes/depois das tabs dentro do mesmo kvMV.
  function stripTabChunks(html) {
    return html
      .replace(/<div class="tabs"[^>]*>[\s\S]*?<\/div>\s*(?:<\/span>\s*)?/gi, "")
      .replace(/<span class="tab">[\s\S]*?<\/span>/gi, "");
  }

  // Analisa linhas normais (acordes + letra) de um trecho HTML sem tabs.
  function parseVerseLines(html, out) {
    const rows = html.split('\n');
    let chords = [];
    const textPieces = [];
    for (const row of rows) {
      if (/<b\s+data-chord-name/i.test(row)) {
        chords = tokenizeChordLine(row).chords;
      } else if (/<b[^>]*>/i.test(row)) {
        // linha de acorde sem data-chord-name; mantém apenas os acordes
        chords = tokenizeChordLine(row).chords;
      } else if (row.trim() !== "") {
        textPieces.push(decodeEntities(row).replace(/\s+$/, ""));
      }
    }
    const letra = textPieces.join('\n');
    if (chords.length > 0 || letra.trim() !== "") {
      out.push({ entries: chords, letra });
    }
  }
}

export function parseCifraHtml(html, url) {
  const meta = extractMeta(html);
  const block = findCifraBlock(html);

  // Se o HTML parseável não veio, tenta o modo markdown (fallback) — mas só
  // se não for uma página HTML (ex.: página de erro do Cifra Club). Antes a
  // página inteira (~270 KB) virava uma "linha de letra" e estourava o
  // limite de 1 MB do documento na nuvem.
  if (!block && /<(html|head|body|script)[\s>]/i.test(html)) {
    return { name: meta.name, artist: meta.artist, tom: meta.tom, url, lines: [] };
  }
  if (!block) {
    const fallback = parseJinaText(html, url);
    fallback.name = meta.name;
    fallback.artist = meta.artist;
    fallback.tom = meta.tom;
    return fallback;
  }

  const lines = parseCifraLines(block);
  return {
    name: meta.name,
    artist: meta.artist,
    tom: meta.tom,
    url,
    lines
  };
}

// Fallback: parse do markdown retornado pelo Jina (em `**negrito**`)
function parseJinaText(text, url) {
  const lines = [];
  const rawLines = text.split("\n");

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (/^Title:/i.test(trimmed) || /^URL Source:/i.test(trimmed) || /^Markdown Content:/i.test(trimmed)) {
      continue;
    }

    if (/^\[.*\]$/.test(trimmed)) {
      lines.push({ entries: [], letra: trimmed });
      continue;
    }

    const entries = [];
    let letra = "";
    let prevEnd = 0;
    const re = /\*\*([^*]+)\*\*/g;
    let mm;
    while ((mm = re.exec(raw)) !== null) {
      const full = mm[0];
      const chord = mm[1].trim();
      const pos = mm.index;
      letra += raw.slice(prevEnd, pos);
      letra += " ".repeat(full.length);
      prevEnd = pos + full.length;
      entries.push({ name: chord, text: chord, pos });
    }
    letra += raw.slice(prevEnd);

    if (entries.length === 0) {
      lines.push({ entries: [], letra: trimmed });
      continue;
    }

    lines.push({ entries, letra });
  }

  return { name: "Sem nome", artist: "Desconhecido", tom: null, url, lines };
}

function slug(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function isCifraLink(url) {
  return /cifraclub\.com\.br\//i.test(url || "");
}

export function toSlug(str) {
  return slug(str);
}

export function isValidSlug(slugStr) {
  return /^[a-z0-9-]+$/.test(slugStr) && slugStr.length > 1;
}
