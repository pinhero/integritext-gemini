'use client';

import { useState, useCallback, useRef } from 'react';
import styles from './page.module.css';

/* ── Score ring SVG ── */
function ScoreRing({ score, role }) {
  const r = 30, circ = 2 * Math.PI * r;
  const dash = circ - (score / 100) * circ;
  const color = role === 'ai' ? 'var(--accent)' : 'var(--danger)';
  const track = role === 'ai' ? 'var(--accent-bg)' : 'var(--danger-bg)';
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
      <circle cx="44" cy="44" r={r} fill="none" stroke={track} strokeWidth="7" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={circ.toFixed(1)} strokeDashoffset={dash.toFixed(1)}
        strokeLinecap="round" transform="rotate(-90 44 44)"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      <text x="44" y="50" textAnchor="middle" fill={color}
        fontSize="18" fontWeight="500" fontFamily="monospace">{score}</text>
    </svg>
  );
}

function VerdictBadge({ label }) {
  const cls = label === 'Faible' ? 'success' : label === 'Modéré' ? 'warning' : 'danger';
  return <span className={`${styles.badge} ${styles[cls]}`}>{label}</span>;
}

/* ── Dropzone ── */
function Dropzone({ onTextExtracted, onError, disabled }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file) return;
    const allowed = ['.pdf', '.docx', '.txt', '.md'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      onError('Format non supporté. Utilisez PDF, DOCX ou TXT.');
      return;
    }
    setUploading(true);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur extraction');
      onTextExtracted(data.text, file.name);
    } catch (e) {
      onError(e.message);
      setFileName('');
    }
    setUploading(false);
  }, [onTextExtracted, onError]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    processFile(file);
  }, [processFile, disabled]);

  const onDragOver = (e) => { e.preventDefault(); if (!disabled) setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onInputChange = (e) => processFile(e.target.files[0]);

  return (
    <div
      className={`${styles.dropzone} ${dragging ? styles.dropzoneDragging : ''} ${disabled ? styles.dropzoneDisabled : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Zone de dépôt de fichier"
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        style={{ display: 'none' }}
        onChange={onInputChange}
      />

      {uploading ? (
        <div className={styles.dropzoneContent}>
          <span className={styles.dropzoneIcon}>⏳</span>
          <span className={styles.dropzoneLabel}>Extraction en cours…</span>
          <span className={styles.dropzoneSub}>{fileName}</span>
        </div>
      ) : fileName ? (
        <div className={styles.dropzoneContent}>
          <span className={styles.dropzoneIcon}>✅</span>
          <span className={styles.dropzoneLabel}>{fileName}</span>
          <span className={styles.dropzoneSub}>Texte extrait — cliquer pour changer</span>
        </div>
      ) : (
        <div className={styles.dropzoneContent}>
          <span className={styles.dropzoneIcon}>📄</span>
          <span className={styles.dropzoneLabel}>Glisser un fichier ici ou cliquer pour choisir</span>
          <span className={styles.dropzoneSub}>PDF · DOCX · TXT — max 10 Mo</span>
        </div>
      )}
    </div>
  );
}

/* ── Texte avec passages surlignés ── */
function HighlightedText({ text, passages }) {
  if (!passages?.length) return <p className={styles.rawText}>{text}</p>;

  // Positionner chaque passage dans le texte original
  const positioned = passages
    .map(p => ({ ...p, index: text.indexOf(p.text) }))
    .filter(p => p.index !== -1)
    .sort((a, b) => a.index - b.index);

  const segments = [];
  let cursor = 0;
  for (const p of positioned) {
    if (p.index > cursor) {
      segments.push({ text: text.slice(cursor, p.index), type: null, key: `n-${cursor}` });
    }
    segments.push({ ...p, key: `h-${p.index}` });
    cursor = p.index + p.text.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: null, key: 'end' });
  }

  return (
    <p className={styles.rawText}>
      {segments.map(seg =>
        seg.type ? (
          <mark
            key={seg.key}
            className={seg.type === 'ia' ? styles.highlightAi : styles.highlightPlag}
            title={seg.reason}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={seg.key}>{seg.text}</span>
        )
      )}
    </p>
  );
}

/* ── Sources de plagiat détectées ── */
function SourcesList({ passages }) {
  const withSource = passages?.filter(p => p.type === 'plagiat' && p.source_url);
  console.log('passages avec source:', withSource);
  if (!withSource?.length) return null;

  return (
    <div className={styles.sourcesBox}>
      <div className={styles.boxLabel}>🔗 Sources détectées</div>
      {withSource.map((p, i) => (
        <div key={i} className={styles.sourceItem}>
          <div className={styles.sourcePassage}>« {p.text} »</div>
          {/* Source principale */}
          <a href={p.source_url} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>
            {p.source_title || p.source_url}
          </a>
          {/* Sources secondaires */}
          {p.all_sources?.slice(1).map((s, j) => (
            <a key={j} href={s.url} target="_blank" rel="noopener noreferrer"
              className={styles.sourceLink} style={{ opacity: 0.7 }}>
              {s.title || s.url}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}
/* ── Main page ── */
export default function Home() {
  const [activeTab, setActiveTab] = useState('text'); // 'text' | 'file'
  const [text, setText]     = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const canAnalyze = text.trim().length >= 80 && !loading;

  const handleTextExtracted = useCallback((extractedText, name) => {
    setText(extractedText);
    setFileName(name);
    setError('');
    setResult(null);
  }, []);

  const handleError = useCallback((msg) => {
    setError(msg);
  }, []);

  const analyze = useCallback(async () => {
    if (!canAnalyze) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      setResult(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [text, canAnalyze]);

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🔍</span>
          <div>
            <div className={styles.logoName}>Kelly</div>
            <div className={styles.logoSub}>Détection IA &amp; Plagiat</div>
          </div>
        </div>
        <div className={styles.pills}>
          <span className={`${styles.pill} ${styles.pillAi}`}>IA</span>
          <span className={`${styles.pill} ${styles.pillPlag}`}>Plagiat</span>
        </div>
      </header>

      {/* Body */}
      <main className={styles.main}>
        {/* Left — input */}
        <section className={styles.inputCol}>
          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'text' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('text')}
            >
              ✏️ Saisir du texte
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'file' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('file')}
            >
              📎 Importer un fichier
            </button>
          </div>

          {/* Tab: texte */}
          {activeTab === 'text' && (
            <div>
              <div className={styles.textareaWrapper}>
                <textarea
                  id="txt"
                  className={styles.textarea}
                  rows={16}
                  placeholder="Collez ou saisissez le texte à analyser (minimum 80 caractères)..."
                  value={text}
                  onChange={(e) => { setText(e.target.value); setFileName(''); setError(''); setResult(null); }}
                />
                {loading && <div className={styles.scanLine} />}
              </div>
            </div>
          )}

          {/* Tab: fichier */}
          {activeTab === 'file' && (
            <div>
              <Dropzone
                onTextExtracted={(t, n) => { handleTextExtracted(t, n); }}
                onError={handleError}
                disabled={loading}
              />
              {text && fileName && (
                <div className={styles.extractedPreview}>
                  <div className={styles.extractedHeader}>
                    <span className={styles.extractedBadge}>📄 {fileName}</span>
                    <span className={styles.extractedMeta}>{wordCount} mots · {text.length} car.</span>
                  </div>
                  <div className={styles.extractedText}>{text.slice(0, 300)}{text.length > 300 ? '…' : ''}</div>
                </div>
              )}
            </div>
          )}

          {/* Footer commun */}
          <div className={styles.inputFooter}>
            <span className={styles.counter}>
              {text ? `${wordCount} mots · ${text.length} car.` : 'Aucun texte'}
            </span>
            <button
              className={styles.btn}
              onClick={analyze}
              disabled={!canAnalyze}
              aria-busy={loading}
            >
              {loading ? 'Analyse en cours…' : 'Analyser →'}
            </button>
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}
        </section>

        {/* Right — results */}
        <section className={styles.resultCol} aria-live="polite">
          {!result && !loading && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>🔬</span>
              <p>
                {activeTab === 'file'
                  ? 'Importez un fichier puis lancez l\'analyse.'
                  : 'Collez un texte et lancez l\'analyse pour voir les résultats ici.'}
              </p>
            </div>
          )}

          {loading && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">⏳</span>
              <p>Analyse en cours…</p>
            </div>
          )}

          {result && (
            <div className={styles.results}>
              <div className={styles.sectionLabel}>Résultats d&apos;analyse</div>

              <div className={styles.scoreGrid}>
                <div className={styles.scoreCard}>
                  <ScoreRing score={result.ai_score} role="ai" />
                  <div className={styles.scoreLabel}>Probabilité IA</div>
                  <VerdictBadge label={result.ai_verdict} />
                </div>
                <div className={styles.scoreCard}>
                  <ScoreRing score={result.plagiat_score} role="plag" />
                  <div className={styles.scoreLabel}>Risque plagiat</div>
                  <VerdictBadge label={result.plagiat_verdict} />
                </div>
              </div>

              <div className={styles.summaryBox}>
                <div className={styles.boxLabel}>Synthèse</div>
                <p>{result.summary}</p>
              </div>
              
              {/* Texte annoté */}
              {text && result.suspicious_passages?.length > 0 && (
                <div className={styles.annotatedBox}>
                  <div className={styles.boxLabel}>
                    🖍️ Texte annoté &nbsp;
                    <span className={styles.annotatedLegend}>
                      <mark className={styles.highlightAi}>IA</mark>
                      <mark className={styles.highlightPlag}>Plagiat</mark>
                    </span>
                  </div>
                  <HighlightedText text={text} passages={result.suspicious_passages} />
                </div>
              )}

              {/* Sources */}
              <SourcesList passages={result.suspicious_passages} />

              <div className={styles.indicatorGrid}>
                <div className={`${styles.indicatorBox} ${styles.boxAi}`}>
                  <div className={`${styles.boxLabel} ${styles.labelAi}`}>Indices IA</div>
                  <ul className={styles.indicatorList}>
                    {result.ai_indicators.map((ind, i) => (
                      <li key={i}><span className={styles.dotAi} /> {ind}</li>
                    ))}
                  </ul>
                </div>
                <div className={`${styles.indicatorBox} ${styles.boxPlag}`}>
                  <div className={`${styles.boxLabel} ${styles.labelPlag}`}>Indices plagiat</div>
                  <ul className={styles.indicatorList}>
                    {result.plagiat_indicators.map((ind, i) => (
                      <li key={i}><span className={styles.dotPlag} /> {ind}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {result.suspicious_passages?.length > 0 && (
                <div>
                  <div className={styles.boxLabel} style={{ marginBottom: 8 }}>Passages signalés</div>
                  {result.suspicious_passages.map((p, i) => (
                    <div key={i} className={`${styles.passage} ${p.type === 'ia' ? styles.passageAi : styles.passagePlag}`}>
                      <div className={styles.passageHeader}>
                        <span className={`${styles.badge} ${p.type === 'ia' ? styles.accent : styles.danger}`}>
                          {p.type === 'ia' ? 'Généré par IA' : 'Plagiat potentiel'}
                        </span>
                        <span className={styles.passageReason}>{p.reason}</span>
                      </div>
                      <blockquote className={styles.passageQuote}>&ldquo;{p.text}&rdquo;</blockquote>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.disclaimer}>
                ⚠️ Analyse indicative — une relecture humaine est toujours nécessaire pour toute décision finale.
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
