// Split a markdown memory file into embedding-sized chunks. We pack whole
// paragraphs/bullet-blocks (split on blank lines) up to a char budget, with a
// small overlap so a fact that straddles a boundary is still retrievable from
// either side. ~1200 chars ≈ ~300 tokens, in the sweet spot for MiniLM.
//
// Scaffold (the H1 title + the `>` editor-note blockquotes we seed files with) is
// dropped so we index substance, not boilerplate.

const MAX_CHARS = 1200;
const OVERLAP_CHARS = 200;

function stripScaffold(text: string): string {
  return text
    .split('\n')
    .filter((l) => { const t = l.trim(); return !(t.startsWith('# ') || t.startsWith('>')); })
    .join('\n');
}

/** Hard-split an over-long block on sentence boundaries (fallback: raw slices). */
function splitLong(block: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const sentence of block.split(/(?<=[.!?])\s+/)) {
    if (buf && buf.length + sentence.length + 1 > MAX_CHARS) { out.push(buf.trim()); buf = ''; }
    buf += (buf ? ' ' : '') + sentence;
    while (buf.length > MAX_CHARS) { out.push(buf.slice(0, MAX_CHARS)); buf = buf.slice(MAX_CHARS); }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Chunk markdown text. Returns non-empty trimmed chunks, scaffold removed. */
export function chunkMarkdown(text: string): string[] {
  const blocks = stripScaffold(text)
    .split(/\n\s*\n/)            // paragraph / bullet-group boundaries
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = '';
  const flush = (): void => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };

  for (const block of blocks) {
    if (block.length > MAX_CHARS) {
      flush();
      for (const piece of splitLong(block)) chunks.push(piece);
      continue;
    }
    if (cur && cur.length + block.length + 2 > MAX_CHARS) {
      flush();
      // carry a small tail of the previous chunk for cross-boundary recall
      const prev = chunks[chunks.length - 1] ?? '';
      cur = prev.length > OVERLAP_CHARS ? prev.slice(-OVERLAP_CHARS) + '\n' : '';
    }
    cur += (cur ? '\n\n' : '') + block;
  }
  flush();
  return chunks;
}
