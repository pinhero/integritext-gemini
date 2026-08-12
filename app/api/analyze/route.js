import { NextResponse } from 'next/server';

// Modèle Gemini utilisé : gemini-3.1-flash-lite (gratuit, 1000 req/jour, 15 req/min)
// gemini-2.0-flash a été retiré en mars 2026
const GEMINI_MODEL = 'gemini-3.6-flash';
//const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Mistral (nouveau — fallback)
const MISTRAL_MODEL = 'mistral-small-latest';
const MISTRAL_URL   = 'https://api.mistral.ai/v1/chat/completions';
const SYSTEM_PROMPT = `Tu es un expert en analyse textuelle. Analyse le texte soumis avec rigueur.

ÉTAPE 0 — IDENTIFIE LE TYPE DE DOCUMENT :
- FAQ / documentation → structure régulière normale, ne pénalise pas
- Email / message personnel → style informel attendu
- Article de blog → voix personnelle attendue
- Rapport académique → formalisme attendu
- TEXTE ENCYCLOPÉDIQUE ou MÉDICAL → attention particulière au plagiat :
  les définitions, statistiques et recommandations officielles sont
  fréquemment copiées de Wikipédia, Vidal, Inserm, OMS.

ÉTAPE 1 — LIS le texte entier avant de scorer.

ÉTAPE 2 — DÉTECTION IA. Principe : le score part de 0.
Tu ne l'augmentes QUE si tu trouves ces marqueurs :

Marqueurs qui font monter le score (+15 à +25 chacun) :
- Formules introductives typiques IA : "Il est important de noter que",
  "Il convient de souligner", "Dans le cadre de", "Force est de constater"
- Paragraphes de longueur STRICTEMENT identique (±10%)
- Répétition du même mot de liaison 3+ fois ("De plus", "En outre", "Cependant")
- Listes à puces où chaque item a exactement la même construction grammaticale
- Conclusion qui résume mécaniquement ce qui vient d'être dit

Marqueurs qui font BAISSER le score (-15 à -25 chacun) :
- Anecdotes personnelles ou exemples tirés de l'expérience directe
- Tournures idiomatiques propres à la langue cible
- Légères imperfections stylistiques ou répétitions involontaires
- Réponses courtes mêlées à des réponses longues (variation naturelle)

ÉTAPE 3 — DÉTECTION PLAGIAT par analyse des phrases.
Pour chaque phrase du texte, évalue si elle ressemble à du contenu copié
depuis une source externe (Wikipédia, Vidal, Inserm, OMS, manuels scolaires,
sites institutionnels). Signale les phrases suspectes dans suspicious_passages.

Marqueurs de plagiat :
- Définitions encyclopédiques mot pour mot ("La vitamine D est une vitamine liposoluble...")
- Statistiques officielles reprises telles quelles ("environ un milliard de personnes")
- Recommandations chiffrées d'organismes officiels ("600 UI pour les adultes jusqu'à 70 ans")
- Ruptures de style entre sections
- Passages au ton de fiche médicale ou de manuel

CALIBRATION DES SCORES :
- 0-20 : aucun signal
- 21-40 : quelques éléments suspects
- 41-60 : signaux modérés
- 61-80 : plusieurs signaux forts
- 81-100 : quasi-certitude

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après :
{
  "ai_score": <0-100>,
  "plagiat_score": <0-100>,
  "ai_verdict": "<Faible|Modéré|Élevé|Très élevé>",
  "plagiat_verdict": "<Faible|Modéré|Élevé|Très élevé>",
  "ai_indicators": ["<indicateur>", "<indicateur>", "<indicateur>"],
  "plagiat_indicators": ["<indicateur>", "<indicateur>", "<indicateur>"],
  "suspicious_passages": [
    {
      "text": "<phrase exacte du texte, max 120 caractères>",
      "type": "ia|plagiat",
      "reason": "<raison courte>",
      "likely_source": "<Wikipedia|Vidal|Inserm|OMS|Manuel scolaire|Inconnu>"
    }
  ],
  "summary": "<2 phrases de synthèse honnêtes>"
}`;

// Recherche la source originale de chaque passage plagié via Google Search
async function enrichPlagiatSources(passages, apiKey) {
  const plagiatPassages = passages.filter(p => p.type === 'plagiat');
  if (plagiatPassages.length === 0) return passages;

  const SEARCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`;

  for (const passage of plagiatPassages) {
    try {
      const res = await fetch(`${SEARCH_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: `Trouve la source originale de ce texte : "${passage.text}". Donne uniquement l'URL si tu la trouves.` }]
          }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 200, temperature: 0 }
        })
      });

      if (!res.ok) continue;
      const data = await res.json();

      // Extraire l'URL depuis les métadonnées de grounding (plus fiable)
      const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks?.length > 0) {
        passage.source_url   = chunks[0]?.web?.uri;
        passage.source_title = chunks[0]?.web?.title;
      } else {
        // Fallback : extraire une URL depuis le texte de réponse
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const match = text.match(/https?:\/\/[^\s)>"]+/);
        if (match) passage.source_url = match[0];
      }
    } catch (_) { /* passage sans source, on continue */ }
  }

  return passages;
}

// Extrait les phrases candidates au plagiat (≥ 8 mots)
function extractSentencesToCheck(text, maxSentences = 6) {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?»])\s+/)
    .map(s => s.trim())
    .filter(s => s.split(/\s+/).length >= 6 && s.length > 40);

  if (sentences.length <= maxSentences) return sentences;
  const step = Math.floor(sentences.length / maxSentences);
  return Array.from({ length: maxSentences }, (_, i) => sentences[i * step]);
}

// Vérifie chaque phrase via Google Search (grounding Gemini)
// async function searchPlagiatOnWeb(text, apiKey) {
//   const toCheck = extractSentencesToCheck(text, 6);
//   if (toCheck.length === 0) return [];

//   // Pas de clé Serper → fallback lien Google Search direct
//   if (!process.env.SERPER_API_KEY) {
//     console.log('Pas de clé Serper configurée — fallback liens Google');
//     return toCheck.map(sentence => ({
//       text: sentence.slice(0, 120),
//       type: 'plagiat',
//       reason: 'Passage potentiellement copié',
//       source_url: `https://www.google.com/search?q=${encodeURIComponent(`"${sentence.slice(0, 80)}"`)}`,
//       source_title: '🔍 Rechercher sur Google',
//       all_sources: []
//     }));
//   }

//   // Identifier les phrases suspectes via Gemini (1 seul appel)
//   const geminiRes = await fetch(
//     `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
//     {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         contents: [{
//           role: 'user',
//           parts: [{
//             text: `Analyse chacune de ces phrases. Identifie celles qui ressemblent à du contenu copié depuis Wikipedia, Vidal, Inserm, OMS ou tout site institutionnel.

// ${toCheck.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

// Réponds uniquement en JSON :
// {"results": [{"index": 1, "is_plagiat": true/false, "confidence": 0-100}]}`
//           }]
//         }],
//         generationConfig: { maxOutputTokens: 300, temperature: 0, responseMimeType: 'application/json' }
//       })
//     }
//   );

//   if (!geminiRes.ok) return [];

//   const geminiData = await geminiRes.json();
//   const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
//   let geminiParsed;
//   try { geminiParsed = JSON.parse(raw); } catch (_) { return []; }

//   // Garder uniquement les phrases suspectes (confidence >= 50)
//   const suspectSentences = (geminiParsed.results || [])
//     .filter(r => r.is_plagiat && r.confidence >= 50)
//     .map(r => ({ index: r.index - 1, sentence: toCheck[r.index - 1] }))
//     .filter(r => r.sentence);

//   if (suspectSentences.length === 0) return [];

//   const found = [];

//   // Pour chaque phrase suspecte, chercher la vraie source via Serper
//   for (const { sentence } of suspectSentences) {
//     try {
//       const searchRes = await fetch('https://google.serper.dev/search', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'X-API-KEY': process.env.SERPER_API_KEY
//         },
//         body: JSON.stringify({
//           q: `"${sentence.slice(0, 80)}"`,
//           gl: 'fr',
//           hl: 'fr',
//           num: 3
//         })
//       });

//       // Quota dépassé → fallback pour ce passage et tous les suivants
//       if (searchRes.status === 429 || searchRes.status === 403) {
//         console.log('Quota Serper atteint — bascule sur fallback Google Search');
//         const remaining = suspectSentences.slice(
//           suspectSentences.findIndex(s => s.sentence === sentence)
//         );
//         for (const { sentence: s } of remaining) {
//           found.push({
//             text: s.slice(0, 120),
//             type: 'plagiat',
//             reason: 'Passage potentiellement copié (quota atteint)',
//             source_url: `https://www.google.com/search?q=${encodeURIComponent(`"${s.slice(0, 80)}"`)}`,
//             source_title: '🔍 Rechercher sur Google',
//             all_sources: [{
//               url: `https://www.google.com/search?q=${encodeURIComponent(`"${s.slice(0, 80)}"`)}`,
//               title: '🔍 Rechercher sur Google'
//             }]
//           });
//         }
//         break; // Sortir de la boucle, fallback appliqué à tout le reste
//       }

//       if (!searchRes.ok) continue;

//       const searchData = await searchRes.json();
//       const items = searchData.organic || [];

//       if (items.length === 0) {
//         // Aucun résultat → fallback lien Google pour ce passage uniquement
//         found.push({
//           text: sentence.slice(0, 120),
//           type: 'plagiat',
//           reason: 'Passage potentiellement copié',
//           source_url: `https://www.google.com/search?q=${encodeURIComponent(`"${sentence.slice(0, 80)}"`)}`,
//           source_title: '🔍 Rechercher sur Google',
//           all_sources: []
//         });
//         continue;
//       }

//       const sources = items
//         .map(item => ({ url: item.link, title: item.title }))
//         .filter(s => s.url);

//       if (sources.length === 0) continue;

//       found.push({
//         text: sentence.slice(0, 120),
//         type: 'plagiat',
//         reason: 'Passage retrouvé sur le web',
//         source_url: sources[0].url,
//         source_title: sources[0].title,
//         all_sources: sources.slice(0, 3)
//       });

//     } catch (_) { continue; }
//   }

//   return found;
// }

async function enrichWithRealSources(passages, plagiatTexts) {
  const serperKey = process.env.SERPER_API_KEY;

  return Promise.all(passages.map(async (passage) => {
    if (passage.type !== 'plagiat') return passage;

    // Fallback immédiat si pas de clé Serper
    if (!serperKey) {
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${passage.text.slice(0, 80)}"`)}`;
      return { ...passage, source_url: googleUrl, source_title: '🔍 Rechercher sur Google', all_sources: [] };
    }

    try {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': serperKey
        },
        body: JSON.stringify({
          q: `"${passage.text.slice(0, 80)}"`,
          gl: 'fr',
          hl: 'fr',
          num: 3
        })
      });

      // Quota Serper dépassé → fallback Google Search
      if (searchRes.status === 429 || searchRes.status === 403) {
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${passage.text.slice(0, 80)}"`)}`;
        return {
          ...passage,
          reason: 'Passage potentiellement copié (quota atteint)',
          source_url: googleUrl,
          source_title: '🔍 Rechercher sur Google',
          all_sources: [{ url: googleUrl, title: '🔍 Rechercher sur Google' }]
        };
      }

      if (!searchRes.ok) return passage;

      const searchData = await searchRes.json();
      const items = (searchData.organic || [])
        .map(item => ({ url: item.link, title: item.title }))
        .filter(s => s.url);

      if (items.length === 0) {
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${passage.text.slice(0, 80)}"`)}`;
        return { ...passage, source_url: googleUrl, source_title: '🔍 Rechercher sur Google', all_sources: [] };
      }

      return {
        ...passage,
        reason: 'Passage retrouvé sur le web',
        source_url: items[0].url,
        source_title: items[0].title,
        all_sources: items.slice(0, 3)
      };

    } catch (_) {
      return passage;
    }
  }));
}


// Appelle Gemini, bascule sur Mistral si quota dépassé
async function callLLM(text, geminiKey, mistralKey) {
  // ── Tentative Gemini ──────────────────────────────────────
  if (geminiKey) {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Analyse ce texte:\n\n${text}` }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0, responseMimeType: 'application/json' },
      }),
    });

    // Quota Gemini OK → on utilise la réponse
    if (geminiRes.ok) {
      const data = await geminiRes.json();
      const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('✅ Modèle utilisé : Gemini');
      return { raw, model: 'gemini' };
    }

    // Quota dépassé → bascule sur Mistral
    if (geminiRes.status === 429) {
      console.log('⚠️ Quota Gemini atteint — bascule sur Mistral');
    } else {
      const err = await geminiRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erreur Gemini (${geminiRes.status})`);
    }
  }

  // ── Fallback Mistral ──────────────────────────────────────
  if (!mistralKey) {
    throw new Error('Quota Gemini dépassé et aucune clé Mistral configurée (MISTRAL_API_KEY).');
  }

  const mistralRes = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${mistralKey}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      temperature: 0,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Analyse ce texte:\n\n${text}` },
      ],
    }),
  });

  if (!mistralRes.ok) {
    const err = await mistralRes.json().catch(() => ({}));
    throw new Error(err.message || `Erreur Mistral (${mistralRes.status})`);
  }

  const data = await mistralRes.json();
  const raw  = data.choices?.[0]?.message?.content || '';
  console.log('✅ Modèle utilisé : Mistral (fallback)');
  return { raw, model: 'mistral' };
}

export async function POST(request) {
  try {
    const { text } = await request.json();

    if (!text || text.trim().length < 80) {
      return NextResponse.json(
        { error: 'Le texte doit contenir au moins 80 caractères.' },
        { status: 400 }
      );
    }

    const geminiKey  = process.env.GEMINI_API_KEY;
    const mistralKey = process.env.MISTRAL_API_KEY;

    if (!geminiKey && !mistralKey) {
      return NextResponse.json(
        { error: 'Aucune clé API configurée (GEMINI_API_KEY ou MISTRAL_API_KEY).' },
        { status: 500 }
      );
    }

    // Appel LLM avec fallback automatique Gemini → Mistral
    const { raw } = await callLLM(text, geminiKey, mistralKey);
    const clean = raw.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      return NextResponse.json(
        { error: 'Réponse du modèle tronquée. Réessayez avec un texte plus court.' },
        { status: 500 }
      );
    }

    // Récupérer uniquement les passages déjà identifiés comme plagiat par le modèle
    // → pas de second appel Gemini, on réutilise ce qu'on a déjà
    const plagiatPassages = (result.suspicious_passages || [])
      .filter(p => p.type === 'plagiat')
      .map(p => p.text);

    if (plagiatPassages.length > 0) {
      result.suspicious_passages = await enrichWithRealSources(
        result.suspicious_passages,
        plagiatPassages
      );
    } else {
      // Aucun passage plagiat détecté → générer quand même des liens Google
      result.suspicious_passages = (result.suspicious_passages || []).map(p => {
        if (p.type !== 'plagiat') return p;
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${p.text.slice(0, 80)}"`)}`;
        return { ...p, source_url: googleUrl, source_title: '🔍 Rechercher sur Google', all_sources: [] };
      });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Analyze error:', error);
    return NextResponse.json(
      { error: error.message || "Erreur lors de l'analyse." },
      { status: 500 }
    );
  }
}