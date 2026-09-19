# Singfy

**Setlist e cifra para shows com auto-roll, transposição e campo harmônico.**

> App web para músicos — hospedado no Firebase, funciona offline (PWA).

---

## Funcionalidades

| Feature | Descrição |
|---------|-----------|
| 🔍 **Busca de cifra** | Digita artista/música → busca no Cifra Club via Cloud Function |
| 📋 **Setlist** | Adiciona, reordena (drag & drop), remove, persiste no localStorage |
| 🎵 **Transposição** | Muda tom (±½ tom) mantendo qualidade dos acordes (campo harmônico) |
| 📖 **Visualização** | Cifra com acordes sobre a letra (formato clássico 2 linhas) |
| ▶️ **Auto-roll** | Rolagem automática por tempo (velocidade ajustável 0.25x–5x, passos de 0.25x) |
| 🎤 **Microfone** | Detecta som/silêncio via Web Audio API para sincronizar troca de música |
| 🌙 **Modo Show** | Fullscreen, wake lock, controles grandes touch-friendly |
| 📱 **PWA** | Instalável, funciona offline, service worker |

---

## Stack

- **Frontend**: Vanilla JS (ES Modules), CSS Custom Properties, Service Worker
- **Backend**: Firebase Cloud Functions (Node 20) — proxy Cifra Club
- **Hosting**: Firebase Hosting (SPA com rewrites)
- **Deploy**: `firebase deploy`

---

## Início Rápido

```bash
# 1. Clone / entre no diretório
cd "/home/lab2/Documentos/Default Project"

# 2. Instale dependências
cd functions && npm install && cd ..

# 3. Login Firebase (uma vez)
firebase login

# 4. Deploy
firebase deploy
```

Acesse: `https://singfy-app.web.app`

---

## Uso no Show (Sexta-feira)

1. **Abra o app** no celular/tablet
2. **Busque** cada música do setlist (Artista + Música)
3. **Adicione ao setlist** — ajuste o tom se precisar (± botões)
4. **Reordene** arrastando (⋮⋮)
5. **Toque "Iniciar"** → entra no **Modo Show** (fullscreen automático)
6. **Espaço** = Play/Pause | **Setas** = Próxima/Anterior | **↑/↓** = Velocidade
7. **Mic** = Ativa detecção de silêncio para pular automático entre músicas

---

## Arquitetura

```
public/
├── index.html          # SPA com 3 telas (busca, setlist, show)
├── css/style.css       # Design system (tema escuro, responsivo)
├── js/
│   ├── app.js          # Estado, roteamento, UI, atalhos
│   ├── parser.js       # Extrai tom, linhas, acordes do HTML
│   ├── transpose.js    # Campo harmônico maior/menor + transposição
│   ├── setlist.js      # CRUD setlist + localStorage
│   ├── player.js       # Auto-roll + Web Audio API (mic)
│   └── api.js          # Cliente fetchSong (proxy Functions)
├── sw.js               # Service Worker (cache estático + API)
└── manifest.json       # PWA manifest

functions/
├── index.js            # fetchSong: GET /api/song?artist=&song=
└── package.json        # firebase-functions, cheerio
```

---

## Campo Harmônico (Teoria)

O módulo `transpose.js` implementa:

- **Maior**: I – ii – iii – IV – V – vi – vii° (tabela 12 tons)
- **Menor natural**: i – ii° – III – iv – v – VI – VII
- **Transposição por grau**: preserva qualidade (m, 7, maj7, dim, sus, /baixo)
- **Detecção de tom**: último acorde + par IV-V a 1 tom

---

## Desenvolvimento Local

```bash
# Terminal 1: Functions emulator
firebase emulators:start --only functions

# Terminal 2: Hosting local
firebase serve --only hosting
# http://localhost:5000
```

---

## Deploy

```bash
firebase deploy
```

Detalhes em [DEPLOY.md](DEPLOY.md)

---

## Licença

MIT — Use livremente para seus shows! 🎸