import { NextResponse } from 'next/server';

// Taille max : 10 MB
export const config = { api: { bodyParser: false } };

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let text = '';

    // ── TXT / MD ──────────────────────────────────────────────
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      text = buffer.toString('utf-8');

    // ── PDF ───────────────────────────────────────────────────
    } else if (name.endsWith('.pdf')) {
      // Import direct de la lib sans déclencher le chargement des fichiers de test
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const data = await pdfParse(buffer);
      text = data.text;

    // ── DOCX ──────────────────────────────────────────────────
    } else if (name.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;

    } else {
      return NextResponse.json(
        { error: 'Format non supporté. Utilisez PDF, DOCX ou TXT.' },
        { status: 415 }
      );
    }

    // Nettoyage basique
    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!text || text.length < 20) {
      return NextResponse.json(
        { error: 'Impossible d\'extraire du texte de ce fichier. Le fichier est peut-être scanné ou protégé.' },
        { status: 422 }
      );
    }

    return NextResponse.json({ text, charCount: text.length, wordCount: text.split(/\s+/).length });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: 'Erreur lors de l\'extraction : ' + (err.message || 'inconnue') },
      { status: 500 }
    );
  }
}
