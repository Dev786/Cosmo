import * as fs from 'fs';
import * as path from 'path';
import { chunkMarkdown } from './chunker';
import { embed, embedOne, embedDim, warmEmbedder } from './embedder';
import {
  loadStore, saveStore, emptyStore, replaceSource, removeSource, cosineSearch,
  type VectorStore,
} from './vectorStore';
import { EMBED_MODEL } from './embedder';
import { WORKSPACE_PATHS } from '../ai/workspace';
import { log } from '../core/log';

// Semantic recall over the editable workspace. Indexes MEMORY.md + USER.md + every
// daily note into a JSON vector store; at turn time, embeds the user's message and
// returns the most relevant chunks. This is what lets Cosmo surface a fact from a
// note three weeks ago without dumping the whole history into every prompt.
//
// Re-indexing is mtime-incremental and self-healing: each recall re-stats the
// source files and only re-embeds the ones that changed (cheap when nothing did),
// so writes from "remember X", compaction, and daily notes are picked up without
// any explicit invalidation wiring. Everything is best-effort — if the embedder is
// unavailable, recall returns nothing and the prompt layer falls back to full-file
// injection.

const TOP_K = 5;
const MIN_SCORE = 0.25; // MiniLM cosine: relevant ≳0.3, unrelated ≲0.15

let store: VectorStore | null = null;
let indexing: Promise<void> | null = null;

/** Absolute paths of the files we index: curated long-term memory + every daily
 *  note. USER.md is deliberately excluded — it holds durable identity facts that
 *  the prompt always injects verbatim, so semantic search over it is redundant. */
function listSources(): string[] {
  const sources = [WORKSPACE_PATHS.memory];
  try {
    for (const f of fs.readdirSync(WORKSPACE_PATHS.memoryDir)) {
      if (f.endsWith('.md')) sources.push(path.join(WORKSPACE_PATHS.memoryDir, f));
    }
  } catch { /* no memory dir yet */ }
  return sources;
}

function mtimeOf(p: string): number | null {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

/** Bring the index up to date with the workspace files. Single-flight + best-effort. */
export async function reindex(): Promise<void> {
  if (indexing) return indexing;
  indexing = (async () => {
    const ok = await warmEmbedder();
    if (!ok) return; // embedder unavailable → leave index as-is; recall falls back
    const dim = embedDim();
    if (!store) store = loadStore(EMBED_MODEL, dim);
    if (dim && store.dim !== dim) store = emptyStore(EMBED_MODEL, dim);

    const present = new Set(listSources());
    let changed = false;

    // Drop sources whose files were deleted.
    for (const src of Object.keys(store.sources)) {
      if (!present.has(src)) { removeSource(store, src); changed = true; }
    }

    // (Re)embed new or modified files only.
    for (const src of present) {
      const mtime = mtimeOf(src);
      if (mtime == null) continue;
      if (store.sources[src] === mtime) continue; // unchanged since last index
      const chunks = chunkMarkdown(fs.readFileSync(src, 'utf8'));
      if (!chunks.length) { replaceSource(store, src, mtime, []); changed = true; continue; }
      const vecs = await embed(chunks);
      if (!vecs) return; // embedder died mid-pass — bail, retry next recall
      replaceSource(store, src, mtime, chunks.map((text, i) => ({ text, vec: vecs[i] ?? [] })));
      changed = true;
    }

    if (changed) { saveStore(store); log.info(`Memory index: ${store.chunks.length} chunk(s) across ${Object.keys(store.sources).length} source(s).`); }
  })().finally(() => { indexing = null; });
  return indexing;
}

/** Embed the query and return the most relevant memory chunks (text only).
 *  Empty array when the embedder is unavailable or nothing clears the threshold. */
export async function recall(query: string, k = TOP_K): Promise<string[]> {
  if (!query.trim()) return [];
  try {
    await reindex();
    if (!store || !store.chunks.length) return [];
    const qv = await embedOne(query);
    if (!qv) return [];
    return cosineSearch(store, qv, k, MIN_SCORE).map((h) => h.text);
  } catch (e) {
    log.debug('Recall failed:', (e as Error).message);
    return [];
  }
}

/** Warm the embedder + build the index in the background at boot. Best-effort. */
export async function warmRecall(): Promise<void> {
  try {
    const ok = await warmEmbedder();
    if (ok) await reindex();
  } catch (e) {
    log.debug('warmRecall skipped:', (e as Error).message);
  }
}
