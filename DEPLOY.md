# Singfy — Deploy no Firebase Hosting

## Visão Geral

O Singfy é um app web para músicos montarem setlist, buscar cifras, transpor tons e usar auto-roll durante shows. Hospedado no Firebase (Hosting + Cloud Functions).

**Projeto Firebase**: `singfy-app` (já configurado em `.firebaserc`)

---

## Pré-requisitos

```bash
# Instalar Firebase CLI
npm install -g firebase-tools

# Login no Firebase
firebase login

# Verificar projeto
firebase projects:list
```

---

## Estrutura do Projeto

```
/home/lab2/Documentos/Default Project/
├── firebase.json              # Config Hosting + Functions
├── .firebaserc                # Projeto: singfy-app
├── .gitignore
├── functions/                 # Cloud Functions (Node 20)
│   ├── index.js              # Proxy Cifra Club
│   └── package.json
└── public/                   # Site estático (Hosting)
    ├── index.html
    ├── sw.js                 # Service Worker (PWA)
    ├── manifest.json         # PWA Manifest
    ├── css/style.css
    └── js/
        ├── app.js            # App principal
        ├── parser.js         # Parsing cifra
        ├── transpose.js      # Campo harmônico + transposição
        ├── setlist.js        # Gerenciamento setlist
        ├── player.js         # Auto-roll + microfone
        └── api.js            # Cliente API
```

---

## Deploy Completo

```bash
cd "/home/lab2/Documentos/Default Project"

# 1. Instalar dependências das Functions
cd functions && npm install && cd ..

# 2. Deploy tudo (Hosting + Functions)
firebase deploy

# Ou separadamente:
firebase deploy --only hosting
firebase deploy --only functions
```

---

## URLs Após Deploy

- **App**: `https://singfy-app.web.app` ou `https://singfy-app.firebaseapp.com`
- **API (Cloud Function)**: `https://<region>-singfy-app.cloudfunctions.net/fetchSong`
  - Via Hosting rewrite: `https://singfy-app.web.app/api/song?artist=...&song=...`

---

## Configuração da Cloud Function

A function `fetchSong` roda em Node 20 com:
- **Memória**: 256 MiB
- **Timeout**: 60s (padrão)
- **CORS**: Habilitado para todas as origens
- **Runtime**: `nodejs20` (Gen 2)

### Endpoint

```
GET /api/song?artist=legiao-urbana&song=tempo-perdido
```

### Resposta

```json
{
  "name": "Tempo Perdido",
  "artist": "Legião Urbana",
  "tom": "Em",
  "url": "https://www.cifraclub.com.br/legiao-urbana/tempo-perdido/",
  "lines": [
    { "entries": [{ "name": "C7M", "text": "C7M" }], "letra": "[Intro] C7M Am7 Bm7 Em" },
    { "entries": [{ "name": "C", "text": "C" }, { "name": "Am7", "text": "Am7" }], "letra": "Todos os dias quando acordo" }
  ],
  "artistSlug": "legiao-urbana",
  "songSlug": "tempo-perdido"
}
```

---

## Desenvolvimento Local

```bash
# Terminal 1: Emulador Functions
cd functions && npm install
firebase emulators:start --only functions

# Terminal 2: Servidor local Hosting
firebase serve --only hosting
# ou
npx serve public -p 5000
```

Acesse `http://localhost:5000` — a API será proxied via emulador.

---

## Variáveis de Ambiente (se necessário)

```bash
# No functions/.env (não commitar)
# Ex: API_KEY_CIFRACLUB=xxx

# Deploy com variáveis
firebase functions:config:set cifraclub.key="xxx"
```

---

## PWA / Offline

- `sw.js` faz cache de assets estáticos e API
- `manifest.json` permite "Instalar app" no mobile
- Funciona offline para setlist salvo no localStorage

---

## Testes Rápidos

```bash
# Testar parser com HTML real
node test-parser.mjs

# Testar Cloud Function local
curl "http://localhost:5001/singfy-app/us-central1/fetchSong?artist=legiao-urbana&song=tempo-perdido"
```

---

## Problemas Conhecidos

1. **Cifra Club bloqueia scrapers** — A Cloud Function usa User-Agent de navegador, mas pode falhar se o site mudar layout ou bloquear IP do Google Cloud. Fallback para API comunitária incluído.

2. **Detecção de tom** — Heurística baseada no último acorde e par IV-V. Pode falhar em músicas modais/fora do campo harmônico. Usuário pode sobrescrever tom manualmente.

3. **Transposição menor→maior** — Atualmente usa campo maior como base. Para músicas em tom menor, o app detecta o menor relativo e transpõe corretamente se o tom original for detectado como menor.

4. **Microfone no iOS Safari** — Requer gesto do usuário (click) antes de `getUserMedia`. O botão "Mic" já trata isso.

---

## Comandos Úteis

```bash
# Ver logs da Function
firebase functions:log

# Rollback hosting
firebase hosting:clone singfy-app:release-name singfy-app:live

# Deletar projeto (cuidado!)
# firebase projects:delete singfy-app
```

---

## Próximos Passos (Roadmap)

- [ ] Melhorar detecção de tom (usar JSON-LD + últimos acordes)
- [ ] Suporte a cifra simplificada / versões alternativas
- [ ] Sincronização de setlist via Firebase Auth + Firestore
- [ ] Metrônomo visual integrado
- [ ] Exportar setlist para PDF/impressão
- [ ] Modo "ensaio" com contagem regressiva