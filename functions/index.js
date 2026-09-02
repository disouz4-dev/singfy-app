const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cheerio = require("cheerio");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Normaliza o slug (artista/musica) mantendo acentos, hífens e números
function slug(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Extrai os acordes de uma linha e constrói a representação textual interpolada
function parseLine($el) {
  const entries = []; // {name, text}
  let letra = "";

  $el.contents().each(function () {
    const node = this;
    if (node.type === "text") {
      letra += decodeEntities(node.data);
    } else if (node.type === "tag") {
      const tag = node.tagName.toLowerCase();
      const $node = $(node);
      if (tag === "b") {
        const name = $node.attr("data-chord-name") || $node.text().trim();
        const text = $node.text().trim();
        entries.push({ name, text });
        // O acorde também faz parte do fluxo visual da linha
        letra += text;
      } else if (tag === "span" || tag === "br" || tag === "div") {
        // pode conter nested content (ex: tab)
        const tmp = parseLine($node);
        entries.push(...tmp.entries);
        letra += tmp.letra;
      } else {
        letra += $node.text();
      }
    }
  });

  return { entries, letra };
}

async function fetchSong(artist, song) {
  const url = `https://www.cifraclub.com.br/${artist}/${song}/`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function extractData(html, artistSlug, songSlug) {
  const $ = cheerio.load(html);

  const songUrl = `https://www.cifraclub.com.br/${artistSlug}/${songSlug}/`;

  // Nome e artista
  const name =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text() ||
    songSlug;
  const artist =
    $('[itemprop="byArtist"]').first().text().trim() ||
    (() => {
      const b = $(".__SS__").text().trim();
      return b;
    })() ||
    artistSlug;

  // Tom de origem
  let tom = null;
  const tomBtn = $('[data-anchor="--chord-tone"]').first();
  const tomMatch = html.match(
    /data-anchor="--chord-tone"[^>]*>\s*([A-H][#b]?[m]?)\s*<\/button>/
  );
  if (tomBtn.length) {
    tom = tomBtn.text().trim() || null;
  } else if (tomMatch) {
    tom = tomMatch[1].trim();
  }
  if (!tom) {
    const m = html.match(/Tom<!--?:?\s*:?\s*<\/span>\s*(?:<button[^>]*>)?\s*([A-H][#b]?[m]?)/);
    if (m) tom = m[1];
  }

  // Bloco de cifra
  let pre = $('pre[data-chord-content="true"]').first();
  let lines = [];
  if (pre.length) {
    $("div", pre).each(function () {
      lines.push(parseLine($(this)));
    });
    // Se não houver divs (texto puro), trata o pre como uma linha
    if (lines.length === 0) {
      lines = [{ entries: [], letra: pre.text().trim() }];
    }
  } else {
    // fallback: procura o article container
    const article = $("article[data-chord-container='true']").first();
    if (article.length) {
      article.children().each(function () {
        lines.push(parseLine($(this)));
      });
    }
  }

  // Versões (principal, simplificada, etc.)
  const versions = [];
  $('a[href*="' + songSlug + '"]')
    .filter((i, el) => /versao/i.test($(el).text()))
    .each(function () {
      versions.push({
        name: $(this).text().trim(),
        url: "https://www.cifraclub.com.br" + ($(this).attr("href") || ""),
      });
    });

  return {
    name,
    artist,
    tom,
    url: songUrl,
    lines,
  };
}

exports.fetchSong = onRequest(
  { cors: true, memory: "256MiB" },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send("");
    }

    const artist = req.query.artist;
    const song = req.query.song;
    if (!artist || !song) {
      return res.status(400).json({
        error: "Parâmetros 'artist' e 'song' (slugs) são obrigatórios.",
      });
    }

    const a = slug(artist);
    const s = slug(song);

    try {
      const html = await fetchSong(a, s);
      const data = extractData(html, a, s);
      res.json({ ...data, artistSlug: a, songSlug: s });
    } catch (err) {
      res.status(502).json({ error: "Não foi possível buscar a cifra.", detail: String(err.message) });
    }
  }
);
