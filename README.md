# IntégriText — Détection IA & Plagiat

Application web Next.js d'analyse textuelle qui détecte les contenus générés par IA et le plagiat, avec identification des sources en ligne.

---

## Fonctionnalités

- **Détection IA** — analyse les patterns linguistiques (uniformité, formules typiques, burstiness) avec calibration par genre de document (FAQ, rapport, email, etc.)
- **Détection plagiat** — recherche chaque passage suspect sur le web via Serper.dev et retourne les URLs des sources originales
- **Texte annoté** — surlignage inline des passages suspects (bleu = IA, rouge = plagiat)
- **Sources cliquables** — liens directs vers les pages web où le passage a été retrouvé
- **Import de fichiers** — analyse de fichiers PDF, DOCX et TXT par extraction de texte côté serveur
- **Double modèle** — Gemini en priorité, bascule automatique sur Mistral si quota dépassé
- **Fallback Serper** — si le quota de recherche web est atteint, génère des liens Google Search automatiquement

---

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | Next.js 14 (App Router) |
| LLM principal | Google Gemini 3.6 Flash |
| LLM fallback | Mistral Small |
| Recherche web | Serper.dev (Google Search API) |
| Extraction PDF | pdf-parse |
| Extraction DOCX | mammoth |
| Déploiement | Vercel |

---

## Prérequis — Clés API

### 1. Google Gemini (principal)
1. Va sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Connecte-toi avec un compte Google
3. Clique **Create API key** → copie la clé (`AIza...`)

> Free tier : ~1 500 requêtes/jour. Pour un usage intensif, active la facturation (~0,15 € / 1 000 analyses).

### 2. Mistral AI (fallback automatique)
1. Va sur [console.mistral.ai](https://console.mistral.ai)
2. Crée un compte → **API Keys** → génère une clé
3. Copie la clé

> Free tier généreux, sans limite journalière stricte.

### 3. Serper.dev (recherche web pour la détection plagiat)
1. Va sur [serper.dev](https://serper.dev)
2. Sign up → copie la clé depuis le dashboard

> 2 500 recherches gratuites sans carte bancaire.

---

## Installation locale

```bash
# 1. Cloner ou décompresser le projet
cd integritext

# 2. Installer les dépendances
npm install

# 3. Configurer les variables d'environnement
cp .env.local.example .env.local
```

Édite `.env.local` :

```env
GEMINI_API_KEY=AIza...
MISTRAL_API_KEY=...
SERPER_API_KEY=...
```

```bash
# 4. Lancer en développement
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

---

## Déploiement sur Vercel

```bash
# Pousser sur GitHub
git init
git add .
git commit -m "Initial commit"
# Crée un repo sur github.com et pousse
```

1. Va sur [vercel.com](https://vercel.com) → **Add New Project** → importe le repo
2. Dans **Environment Variables**, ajoute les 3 clés :
   - `GEMINI_API_KEY`
   - `MISTRAL_API_KEY`
   - `SERPER_API_KEY`
3. **Deploy** → l'app est en ligne en 2 minutes

---

## Architecture

```
integritext/
├── app/
│   ├── api/
│   │   ├── analyze/
│   │   │   └── route.js    ← Analyse LLM + recherche sources
│   │   └── upload/
│   │       └── route.js    ← Extraction texte PDF/DOCX/TXT
│   ├── icon.svg            ← Favicon
│   ├── globals.css
│   ├── layout.jsx
│   ├── page.jsx            ← Interface React
│   └── page.module.css
├── public/
├── .env.local              ← Clés API (jamais committé)
├── .env.local.example
├── .gitignore
└── package.json
```

---

## Fonctionnement interne

### Analyse (`/api/analyze`)

1. **Appel LLM** — Gemini en priorité, Mistral si quota 429
2. **Détection IA** — le modèle évalue les patterns linguistiques avec calibration par type de document
3. **Détection plagiat linguistique** — le modèle identifie les passages encyclopédiques, institutionnels ou copiés
4. **Recherche sources** — pour chaque passage plagié, appel Serper.dev → URLs réelles retournées
5. **Fallback** — si Serper est épuisé, génération automatique de liens Google Search

### Extraction fichiers (`/api/upload`)

| Format | Bibliothèque |
|---|---|
| `.pdf` | pdf-parse |
| `.docx` | mammoth |
| `.txt` / `.md` | Buffer UTF-8 natif |

---

## Logique de fallback

```
Requête d'analyse
       │
       ▼
  Gemini disponible ?
  ├── Oui → Analyse Gemini
  └── Non (429) → Analyse Mistral
                        │
                        ▼
               Serper disponible ?
               ├── Oui → URLs directes
               └── Non (429/403) → Liens Google Search
```

---

## Interprétation des scores

| Score | Verdict | Signification |
|---|---|---|
| 0–20 | Faible | Aucun signal détecté |
| 21–40 | Modéré | Quelques éléments suspects |
| 41–70 | Élevé | Signaux forts et cohérents |
| 71–100 | Très élevé | Quasi-certitude |

> **Note importante** — Les scores de détection IA varient selon le modèle utilisé. Gemini tend à scorer plus haut que Mistral sur les mêmes textes. Le modèle utilisé est affiché dans les résultats. Aucun outil de détection IA n'atteint 100 % de précision — une relecture humaine reste indispensable pour toute décision finale.

---

## Limites connues

- **Plagiat entre étudiants** — non détectable sans accès à une base de données privée (Turnitin, etc.). Seul le contenu publié sur le web est vérifiable.
- **Textes très courts** — minimum 80 caractères requis pour une analyse fiable.
- **PDFs scannés** — l'extraction de texte échoue sur les images scannées sans OCR.
- **Quota Gemini free tier** — 1 500 requêtes/jour environ. Au-delà, bascule automatique sur Mistral.
- **Quota Serper** — 2 500 requêtes gratuites au total (non par jour).

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ (ou Mistral) | Clé Google AI Studio |
| `MISTRAL_API_KEY` | ✅ (ou Gemini) | Clé Mistral AI |
| `SERPER_API_KEY` | ⬜ Recommandée | Recherche web (URLs directes). Sans elle, des liens Google Search sont générés. |

L'app fonctionne sans `SERPER_API_KEY` mais la détection de plagiat sera moins précise (pas d'URLs directes vers les sources).
