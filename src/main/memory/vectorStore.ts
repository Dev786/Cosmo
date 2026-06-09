import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from '../core/log';

// Plain-JSON vector store for semantic recall. No native vector DB: a personal
// assistant's memory is small (hundreds–low-thousands of chunks), and a
// brute-force cosine over normalized 384-dim vectors is sub-millisecond at that
// scale. JSON keeps it inspectable, portable, and dependency-free — it lives
// beside the editable workspace files it indexes.
//
// Vectors are L2-normalized at embed time, so cosine similarity == dot product.

const STORE_PATH = path.join(os.homedir(), '.pixel', 'workspace', 'index.json');

export interface StoredChunk { id: string; source: string; text: string; vec: number[] }
export interface VectorStore {
  model: string;
  dim: number;
  sources: Record<string, number>; // source file path → mtimeMs last indexed
  chunks: StoredChunk[];
}

export interface SearchHit { text: string; source: string; score: number }

export function emptyStore(model: string, dim: number): VectorStore {
  return { model, dim, sources: {}, chunks: [] };
}

/** Load the store. A model/dim mismatch (user switched embedding models) means the
 *  old vectors live in a different space, so we discard and rebuild from scratch. */
export function loadStore(model: string, dim: number): VectorStore {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as VectorStore;
    if (raw.model !== model || (dim && raw.dim !== dim)) {
      log.info('Vector store model/dim changed — rebuilding index.');
      return emptyStore(model, dim);
    }
    if (!Array.isArray(raw.chunks)) return emptyStore(model, dim);
    return { model: raw.model, dim: raw.dim, sources: raw.sources ?? {}, chunks: raw.chunks };
  } catch {
    return emptyStore(model, dim);
  }
}

export function saveStore(store: VectorStore): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store), 'utf8');
  } catch (e) {
    log.debug('Vector store save failed:', (e as Error).message);
  }
}

/** Replace every chunk for `source` with a fresh set, and record its mtime. */
export function replaceSource(
  store: VectorStore,
  source: string,
  mtimeMs: number,
  items: Array<{ text: string; vec: number[] }>,
): void {
  store.chunks = store.chunks.filter((c) => c.source !== source);
  items.forEach((it, i) => store.chunks.push({ id: `${source}#${i}`, source, text: it.text, vec: it.vec }));
  store.sources[source] = mtimeMs;
}

/** Forget a source entirely (its file was deleted). */
export function removeSource(store: VectorStore, source: string): void {
  store.chunks = store.chunks.filter((c) => c.source !== source);
  delete store.sources[source];
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Top-k chunks by cosine similarity (== dot product for normalized vectors),
 *  filtered to those at or above `minScore`. */
export function cosineSearch(store: VectorStore, queryVec: number[], k: number, minScore = 0): SearchHit[] {
  return store.chunks
    .map((c) => ({ text: c.text, source: c.source, score: dot(queryVec, c.vec) }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export const STORE_FILE = STORE_PATH;
