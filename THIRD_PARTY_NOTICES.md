# Third-Party Notices

Cosmo is licensed under the Apache License, Version 2.0 (see `LICENSE`).
It builds on third-party software and machine-learning models, each governed
by its own license. This file documents them so Cosmo can be redistributed and
shared in compliance with those licenses.

There are three groups:

1. **Bundled npm packages** — shipped inside the application.
2. **libvips** — a bundled native library under the LGPL-3.0 (special notice below).
3. **Machine-learning models** — *not* bundled; downloaded on first launch.

---

## 1. Bundled npm packages

The application bundle includes the project's production npm dependencies and
their transitive dependencies. The complete, verbatim license text of every one
is in **`THIRD_PARTY_LICENSES.txt`** (generated from the installed tree). They
are overwhelmingly permissive — MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
ISC, and a handful of dual licenses.

The most significant, by role in Cosmo:

| Package | License | Used for |
|---|---|---|
| `@huggingface/transformers` | Apache-2.0 | On-device STT + text embeddings (transformers.js v3) |
| `@xenova/transformers` | Apache-2.0 | Bundled ONNX runtime for STT |
| `kokoro-js` | MIT | On-device text-to-speech |
| `onnxruntime-web` / `onnxruntime-node` | MIT | Neural-network inference |
| `@ricky0123/vad-web` | ISC | Voice-activity detection (bundles the Silero VAD model, MIT) |
| `sharp` | Apache-2.0 | Image utilities pulled in transitively by transformers.js (see §2 for its native backend) |
| `electron` | MIT | Application runtime |
| `zod`, `electron-store`, `dotenv` | MIT | Validation, settings, env loading |

---

## 2. libvips — LGPL-3.0-or-later (important)

**Cosmo includes libvips, which is licensed under the GNU Lesser General Public
License, version 3 or later (LGPL-3.0-or-later).**

- **Component:** libvips (`libvips-cpp.8.17.3.dylib`), delivered through the npm
  package `@img/sharp-libvips-darwin-arm64`.
- **How it is used:** It is pulled in transitively by `sharp`, which the
  transformers.js Node build (`transformers.node.mjs`) imports at load time.
  Cosmo itself does not call any image features — it uses transformers.js only
  for text embeddings and speech — but because that import is eager, the library
  ships with the app.
- **How it is linked:** **Dynamically.** `sharp`'s native Node addon loads the
  libvips shared library (`.dylib`) at runtime via the operating system's
  dynamic-link mechanism. libvips is *not* statically linked into, or modified
  by, Cosmo's own code.

To satisfy the LGPL-3.0:

- **License texts** are included in this distribution as
  **`LICENSE.LGPL-3.0.txt`** and the **`LICENSE.GPL-3.0.txt`** it incorporates
  by reference.
- **Source code** for libvips (the "Minimal Corresponding Source") is available
  from the upstream project:
  - libvips — https://github.com/libvips/libvips (this build: version 8.17.3)
  - sharp packaging of libvips — https://github.com/lovell/sharp-libvips
- **Replacement.** Because libvips is a separate, dynamically-loaded shared
  library, a recipient may modify libvips and relink it with Cosmo by replacing
  the bundled `libvips-cpp.*.dylib` (under
  `…/Cosmo.app/Contents/Resources/app/node_modules/@img/sharp-libvips-darwin-arm64/lib/`,
  or the equivalent unpacked location) with a compatible build of their own.

No other LGPL-, GPL-, or other copyleft-licensed component ships with Cosmo. A
CI license check (`npm run licenses:check`) guards against new copyleft
dependencies being introduced silently.

---

## 3. Machine-learning models (downloaded at runtime)

Cosmo's on-device voice, speech, turn-detection, and memory features use the
models below. **These weights are not bundled in the distribution** — they are
downloaded from Hugging Face on first launch (or via the optional setup
prefetch) and cached on the user's machine. Each is used under its upstream
license:

| Model | Hugging Face ID | License | Role |
|---|---|---|---|
| Kokoro-82M (ONNX) | `onnx-community/Kokoro-82M-ONNX` | Apache-2.0 | Text-to-speech |
| Moonshine base (ONNX) | `onnx-community/moonshine-base-ONNX` | MIT | Speech-to-text |
| Smart Turn v3 | `pipecat-ai/smart-turn-v3` | BSD-2-Clause | End-of-turn detection |
| all-MiniLM-L6-v2 | `Xenova/all-MiniLM-L6-v2` | Apache-2.0 | Sentence embeddings (memory) |
| Silero VAD | bundled in `@ricky0123/vad-web` | MIT | Voice-activity detection |

Refer to each model's card on Hugging Face for its authoritative license terms.

---

## Notes

- Fonts (Space Grotesk, Inter, JetBrains Mono — all SIL OFL-1.1) are used only
  on the Cosmo marketing website and are **not** part of the application
  distribution.
- `THIRD_PARTY_LICENSES.txt` is regenerated with `npm run licenses:generate`
  and should be refreshed whenever production dependencies change.
