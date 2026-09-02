// api.js — Comunicação com Cloud Function (proxy Cifra Club)

const FUNCTION_URL = "/api/song"; // Serve via Firebase Hosting rewrite ou Functions URL

export async function fetchSong(artist, song) {
  const params = new URLSearchParams({ artist, song });
  const url = `${FUNCTION_URL}?${params}`;
  
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" }
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Erro ${res.status}`);
    }
    
    return await res.json();
  } catch (err) {
    // Fallback: tenta API pública conhecida (se CORS permitir)
    console.warn("Proxy falhou, tentando fallback...", err);
    return fetchSongFallback(artist, song);
  }
}

// Fallback para API comunitária (pode falhar por CORS)
async function fetchSongFallback(artist, song) {
  const url = `https://cifraclub-api.vercel.app/api/cifra?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(song)}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
    const data = await res.json();
    
    if (data.error) throw new Error(data.error);
    
    // Normaliza formato
    return normalizeFallbackData(data);
  } catch (err) {
    throw new Error("Não foi possível buscar a cifra. Verifique a conexão e tente novamente.");
  }
}

function normalizeFallbackData(data) {
  // Converte array de strings para linhas estruturadas
  const lines = (data.cifra || []).map((line, i) => {
    // Tenta extrair acordes da linha (formato: "C   Am   F   G")
    const chords = extractChordsFromLine(line);
    return {
      entries: chords.map(c => ({ name: c, text: c })),
      letra: line.replace(/[A-G](#|b)?(m|maj|dim|sus|add|°|[0-9]+)?(\/[A-G](#|b)?)?/g, "").trim()
    };
  });
  
  return {
    name: data.name,
    artist: data.artist,
    tom: data.tom || null,
    url: data.cifraclub_url,
    lines,
    artistSlug: data.artist,
    songSlug: data.name
  };
}

function extractChordsFromLine(line) {
  // Regex para acordes padrão
  const chordRegex = /[A-G](#|b)?(m|maj|dim|sus|add|°|[0-9]+)?(\/[A-G](#|b)?)?/g;
  const matches = line.match(chordRegex);
  return matches ? [...new Set(matches)] : [];
}

// Busca sugestões (autocomplete) - usa busca do Cifra Club
export async function searchSongs(query) {
  // Como não há API pública de busca, retorna vazio
  // O usuário digita slugs manualmente (artista/musica)
  // Poderíamos implementar scraping da página de busca se necessário
  return [];
}

// Gera slug amigável
export function toSlug(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Valida se slug parece válido
export function isValidSlug(slug) {
  return /^[a-z0-9-]+$/.test(slug) && slug.length > 1;
}