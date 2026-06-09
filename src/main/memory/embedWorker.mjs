// Embedding worker — runs as a child_process.fork under the SYSTEM node binary
// (NOT Electron: onnxruntime-node inference crashes under Electron's bundled
// runtime — verified for STT — but runs cleanly under real node). Same reason the
// voice worker is forked; see core/systemNode.ts.
//
// One capability: turn text into sentence-embedding vectors via transformers.js
// feature-extraction (Xenova/all-MiniLM-L6-v2, 384-dim, ~23MB q8). Used by the
// semantic-recall memory index — everything stays local, models cache to
// ~/.pixel/models like the ASR models.
//
// Hand-authored ESM (.mjs) so `import` is native — no tsc CommonJS rewrite (same
// as whisperWorker.mjs).
//
// Protocol (child_process IPC, 'advanced'/v8 serialization):
//   in:  { type:'init', model, cacheDir }
//   in:  { type:'embed', id, texts:string[] }
//   out: { type:'ready', dim }
//        { type:'embedded', id, vectors:number[][] }
//        { type:'error', id?, message }

import { pipeline, env } from '@huggingface/transformers';

let extractor = null;
let load = null;
let dim = 0;

async function ensureModel(model, cacheDir) {
  if (extractor) return;
  if (load) return load;
  load = (async () => {
    env.cacheDir = cacheDir;
    env.allowLocalModels = true; // reuse the on-disk cache; still downloads once if missing
    extractor = await pipeline('feature-extraction', model);
    // Probe the output width once so the main side can sanity-check the store.
    const probe = await extractor(['dimension probe'], { pooling: 'mean', normalize: true });
    dim = probe.dims?.[probe.dims.length - 1] ?? (probe.tolist()[0]?.length ?? 0);
    process.send({ type: 'ready', dim });
  })();
  return load;
}

process.on('message', async (msg) => {
  try {
    if (msg.type === 'init') {
      await ensureModel(msg.model, msg.cacheDir);
      return;
    }
    if (msg.type === 'embed') {
      if (!extractor) throw new Error('embedder not initialized');
      const texts = Array.isArray(msg.texts) ? msg.texts : [msg.texts];
      // mean-pool + L2-normalize → cosine similarity is a plain dot product.
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      process.send({ type: 'embedded', id: msg.id, vectors: out.tolist() });
      return;
    }
  } catch (e) {
    process.send({ type: 'error', id: msg?.id, message: String(e?.message ?? e) });
  }
});
