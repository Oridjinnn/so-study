// Server-safe lexical retriever (Stage 3, whitepaper §4/§5): ranks module
// chunks against a question so the Q&A prompt only carries the top-k most
// relevant context instead of the whole module. Pure TS — no React, no Prisma,
// no external dependency — so it can be unit-tested in isolation.
//
// This is a BM25-lite ranker: term-frequency * inverse-document-frequency over
// the in-memory chunk set, with the BM25 saturation/length-normalization term.
// It is deliberately lexical (not semantic) for Phase 0; swapping in an
// embedding index later only changes how scores are produced, not this shape.

export interface RankedChunk {
  id: string;
  text: string;
  score: number;
}

export interface RetrievableChunk {
  id: string;
  text: string;
}

const K1 = 1.5;
const B = 0.75;

// Small inline stopword list (Indonesian + English). These terms carry little
// topical signal and would otherwise dominate IDF in a study-module corpus.
const STOPWORDS = new Set<string>([
  "dan", "atau", "yang", "di", "ke", "dari", "pada", "untuk", "dengan", "dalam",
  "ini", "itu", "adalah", "akan", "bisa", "juga", "sudah", "saya", "kamu",
  "mereka", "kita", "apa", "bagaimana", "mengapa", "karena", "jika", "maka",
  "sebagai", "oleh", "saat", "setelah", "sebelum", "antara", "terhadap", "tentang",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "being", "that", "this", "it", "as", "at",
  "by", "from", "we", "you", "they", "how", "why", "what", "because", "if", "then",
  "but", "not", "no", "yes",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Term frequency map for one tokenized document. */
function termFreqs(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

export function rankChunks(
  chunks: RetrievableChunk[],
  query: string,
  k: number,
): RankedChunk[] {
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  const docs = chunks.map((c) => termFreqs(tokenize(c.text)));

  const n = docs.length;
  const lengths = docs.map((tf) =>
    Array.from(tf.values()).reduce((sum, v) => sum + v, 0),
  );
  const avgdl = lengths.reduce((sum, l) => sum + l, 0) / n;

  // Document frequency per query term across the chunk set.
  const df = new Map<string, number>();
  for (const t of queryTokens) {
    if (df.has(t)) continue;
    let count = 0;
    for (const tf of docs) {
      if (tf.has(t)) count += 1;
    }
    df.set(t, count);
  }

  // BM25 inverse-document-frequency (always non-negative for n >= df).
  const idf = (term: string): number => {
    const f = df.get(term) ?? 0;
    return Math.log(1 + (n - f + 0.5) / (f + 0.5));
  };

  const scored: RankedChunk[] = chunks.map((c, i) => {
    const tf = docs[i];
    const dl = lengths[i];
    let score = 0;
    for (const t of queryTokens) {
      const f = tf.get(t);
      if (!f) continue;
      // When every chunk is composed solely of stopwords, avgdl === 0 and
      // `dl / avgdl` is 0/0 === NaN, which would poison the whole score.
      // Fall back to IDF-only scoring so ranking stays deterministic.
      if (avgdl === 0) {
        score += idf(t) * f;
        continue;
      }
      const denom = f + K1 * (1 - B + B * (dl / avgdl));
      score += idf(t) * ((f * (K1 + 1)) / denom);
    }
    return { id: c.id, text: c.text, score };
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));

  // Fallback: no lexical overlap anywhere, so return the first k chunks so the
  // Q&A route still has *some* context instead of an empty prompt.
  if (top.every((c) => c.score <= 0)) {
    return chunks
      .slice(0, Math.max(0, k))
      .map((c) => ({ id: c.id, text: c.text, score: 0 }));
  }
  return top;
}
