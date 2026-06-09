// Catalog of LLM vendors offered in the setup screen. Shared so the renderer can
// populate the dropdowns and main can validate against it. `id` matches both the
// provider registry name and config.llm.provider.
//
// Model IDs drift — the setup screen always offers a free-text "custom…" entry,
// so these lists are a CURATED set of the best tool-capable, value-for-money chat
// models per vendor, not a hard constraint. Cloud vendors show exactly this list:
// their live `/v1/models` is a flood of image/TTS/embedding/legacy models that
// don't suit Cosmo, so we don't surface it. ONLY local Ollama replaces this with a
// live list — your actually-installed models. Free-tier notes reflect mid-2026
// research (see the Cerebras/Groq/Gemini comparison).

export interface ProviderInfo {
  id: string;
  label: string;
  /** Short free-tier hint shown under the vendor in the UI. */
  freeTier: string;
  /** "Get a key →" link. Empty for providers that need no key (local). */
  keyUrl: string;
  /** False for local providers (Ollama) that need no API key. */
  needsKey: boolean;
  /** Suggested model ids (a "custom…" option is always added by the UI). */
  models: string[];
}

export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: 'cerebras',
    label: 'Cerebras',
    freeTier: '1M tokens/day free · fastest',
    keyUrl: 'https://cloud.cerebras.ai/',
    needsKey: true,
    models: ['llama-3.3-70b', 'qwen-3-32b', 'gpt-oss-120b', 'zai-glm-4.7', 'llama3.1-8b'],
  },
  {
    id: 'groq',
    label: 'Groq',
    freeTier: '100K tokens/day free · fast',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    freeTier: '~1,000–1,500 requests/day free',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
    models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    freeTier: 'Unlimited · runs on your Mac',
    keyUrl: '',
    needsKey: false,
    // Fallback only — when Ollama is running, the dropdown is filled live from your
    // actually-installed models (`/v1/models`). These are popular default tags shown
    // if Ollama can't be reached yet.
    models: ['llama3.2', 'qwen2.5', 'gemma3', 'phi4-mini'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    freeTier: 'Paid — no free tier',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
    models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4.1', 'gpt-4o', 'gpt-5.4-nano'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    freeTier: 'Paid — no free tier',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsKey: true,
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    freeTier: 'Paid — very cheap',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    needsKey: true,
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    freeTier: 'Paid',
    keyUrl: 'https://console.x.ai/',
    needsKey: true,
    models: ['grok-4.3'],
  },
];

export function getProviderInfo(id: string): ProviderInfo | undefined {
  return PROVIDER_CATALOG.find(p => p.id === id);
}

// ─── Text-to-speech (voice) ──────────────────────────────────────────────────
// Same idea as the LLM catalog, for the setup screen's "Voice" tab. `id` matches
// both the TTS registry name and config.tts.provider. Cloud providers need a key;
// Groq/OpenAI TTS reuse the matching LLM key (keyId), so a user who already set
// that vendor as their brain needs no extra key. The voice dropdown always offers
// a "custom voice…" entry, so these voice lists are convenient defaults — voice
// ids drift (and Cartesia's are account-specific UUIDs).

export interface VoiceInfo { id: string; label: string; }

export interface TTSInfo {
  id: string;
  label: string;
  /** Runs on-device, no key, no network. */
  offline: boolean;
  needsKey: boolean;
  /** Secret id the key is stored under. Defaults to `id`; set when reusing an LLM
   *  vendor's key (Groq/OpenAI TTS → 'groq'/'openai'). */
  keyId?: string;
  freeTier: string;
  keyUrl: string;
  voices: VoiceInfo[];
  defaultVoice: string;
}

export const TTS_CATALOG: TTSInfo[] = [
  {
    id: 'kokoro',
    label: 'Kokoro (local)',
    offline: true,
    needsKey: false,
    freeTier: 'Unlimited · on-device · cute',
    keyUrl: '',
    defaultVoice: 'af_heart',
    voices: [
      { id: 'af_heart', label: 'Heart — warmest (default)' },
      { id: 'af_bella', label: 'Bella — expressive' },
      { id: 'af_nicole', label: 'Nicole — clear, friendly' },
      { id: 'af_sarah', label: 'Sarah — natural' },
      { id: 'af_sky', label: 'Sky — bright' },
      { id: 'af_nova', label: 'Nova' },
      { id: 'af_kore', label: 'Kore' },
      { id: 'af_alloy', label: 'Alloy' },
      { id: 'bf_emma', label: 'Emma — British' },
      { id: 'bf_isabella', label: 'Isabella — British' },
      { id: 'am_adam', label: 'Adam — male' },
      { id: 'am_michael', label: 'Michael — male' },
    ],
  },
  {
    id: 'macos',
    label: 'macOS (system)',
    offline: true,
    needsKey: false,
    freeTier: 'Unlimited · built into macOS',
    keyUrl: '',
    defaultVoice: 'Samantha',
    voices: [
      // Voices that ship broadly on macOS. Others (Alex, novelty voices) vary by
      // machine / need a download, so we don't list them — the custom field covers
      // any voice the user has installed (run `say -v '?'` to see them all).
      { id: 'Samantha', label: 'Samantha' },
      { id: 'Daniel', label: 'Daniel — British' },
      { id: 'Karen', label: 'Karen — Australian' },
      { id: 'Moira', label: 'Moira — Irish' },
    ],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    offline: false,
    needsKey: true,
    freeTier: '~10k credits/mo free · no card',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    // Current default-voice IDs. The old Rachel/Adam (legacy) defaults expire
    // 2026-12-31 and are unavailable to accounts created after March 2026, so we
    // lead with the present-day default set (stable global IDs).
    defaultVoice: '9BWtsMINqrJLrRacOk9x',
    voices: [
      { id: '9BWtsMINqrJLrRacOk9x', label: 'Aria — warm female (default)' },
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah — soft female' },
      { id: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura — bright female' },
      { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George — male' },
      { id: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum — male' },
    ],
  },
  {
    id: 'sarvam',
    label: 'Sarvam (Indian)',
    offline: false,
    needsKey: true,
    freeTier: 'Free trial credits · Indian voices',
    keyUrl: 'https://dashboard.sarvam.ai/',
    defaultVoice: 'anushka',
    voices: [
      { id: 'anushka', label: 'Anushka — female' },
      { id: 'manisha', label: 'Manisha — female' },
      { id: 'vidya', label: 'Vidya — female' },
      { id: 'arya', label: 'Arya — female' },
      { id: 'abhilash', label: 'Abhilash — male' },
      { id: 'karun', label: 'Karun — male' },
      { id: 'hitesh', label: 'Hitesh — male' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq (Orpheus)',
    offline: false,
    needsKey: true,
    keyId: 'groq',
    freeTier: 'Free · rate-limited only · no card',
    keyUrl: 'https://console.groq.com/keys',
    defaultVoice: 'hannah',
    voices: [
      { id: 'hannah', label: 'Hannah — female' },
      { id: 'autumn', label: 'Autumn — female' },
      { id: 'diana', label: 'Diana — female' },
      { id: 'austin', label: 'Austin — male' },
      { id: 'daniel', label: 'Daniel — male' },
      { id: 'troy', label: 'Troy — male' },
    ],
  },
  {
    id: 'deepgram',
    label: 'Deepgram Aura',
    offline: false,
    needsKey: true,
    freeTier: '$200 free credit · no card',
    keyUrl: 'https://console.deepgram.com/',
    defaultVoice: 'aura-2-thalia-en',
    voices: [
      { id: 'aura-2-thalia-en', label: 'Thalia — female (default)' },
      { id: 'aura-2-andromeda-en', label: 'Andromeda — female' },
      { id: 'aura-2-helena-en', label: 'Helena — female' },
      { id: 'aura-2-asteria-en', label: 'Asteria — female' },
      { id: 'aura-2-apollo-en', label: 'Apollo — male' },
    ],
  },
  {
    id: 'cartesia',
    label: 'Cartesia (Sonic)',
    offline: false,
    needsKey: true,
    freeTier: '~20k credits free · low latency',
    keyUrl: 'https://play.cartesia.ai/',
    defaultVoice: '694f9389-aac1-45b6-b726-9d9369183238',
    voices: [
      { id: '694f9389-aac1-45b6-b726-9d9369183238', label: 'Default (paste your own UUID)' },
    ],
  },
  {
    id: 'hume',
    label: 'Hume (Octave)',
    offline: false,
    needsKey: true,
    freeTier: '10k chars/mo + $20 credit · no card',
    keyUrl: 'https://platform.hume.ai/',
    defaultVoice: '',
    voices: [
      { id: '', label: 'Auto (from description)' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI TTS',
    offline: false,
    needsKey: true,
    keyId: 'openai',
    freeTier: 'Paid — no free tier',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultVoice: 'nova',
    voices: [
      { id: 'nova', label: 'Nova — warm female' },
      { id: 'shimmer', label: 'Shimmer — female' },
      { id: 'coral', label: 'Coral — female' },
      { id: 'sage', label: 'Sage — female' },
      { id: 'alloy', label: 'Alloy' },
      { id: 'echo', label: 'Echo — male' },
      { id: 'ash', label: 'Ash — male' },
      { id: 'onyx', label: 'Onyx — male' },
      { id: 'fable', label: 'Fable' },
    ],
  },
];

export function getTTSInfo(id: string): TTSInfo | undefined {
  return TTS_CATALOG.find(t => t.id === id);
}

// ─── Speech-to-text (ears) ───────────────────────────────────────────────────
// Local (transformers.js, on-device) plus cloud vendors. The local engine also
// powers Smart Turn end-of-turn detection, so it always runs; cloud providers just
// take over the transcription call at turn-end. Cloud STT keys are SHARED with the
// matching LLM/TTS vendor via `keyId` — set up Groq/ElevenLabs once, get all three.
// A local *model* change applies next launch (the worker loads it at boot); cloud
// providers apply immediately.

export interface STTModelInfo { id: string; label: string; dtype?: string; }
export interface STTInfo {
  id: string;
  label: string;
  offline: boolean;
  needsKey: boolean;
  keyId?: string;
  freeTier: string;
  keyUrl: string;
  models: STTModelInfo[];
  defaultModel: string;
}

export const STT_CATALOG: STTInfo[] = [
  {
    id: 'whisperLocal',
    label: 'Local (on-device)',
    offline: true,
    needsKey: false,
    freeTier: 'Unlimited · private · on-device',
    keyUrl: '',
    defaultModel: 'onnx-community/moonshine-base-ONNX',
    models: [
      { id: 'onnx-community/moonshine-base-ONNX', label: 'Moonshine Base — balanced (default)', dtype: 'q8' },
      { id: 'onnx-community/moonshine-tiny-ONNX', label: 'Moonshine Tiny — fastest', dtype: 'q8' },
      { id: 'onnx-community/whisper-base.en', label: 'Whisper Base (English) — accurate', dtype: 'q8' },
      { id: 'onnx-community/whisper-small.en', label: 'Whisper Small (English) — most accurate', dtype: 'q8' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq Whisper',
    offline: false,
    needsKey: true,
    keyId: 'groq',
    freeTier: 'Free · rate-limited only · no card',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'whisper-large-v3-turbo',
    models: [
      { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo — fast (default)' },
      { id: 'whisper-large-v3', label: 'Whisper Large v3 — most accurate' },
    ],
  },
  {
    id: 'deepgram',
    label: 'Deepgram',
    offline: false,
    needsKey: true,
    freeTier: '$200 free credit · no card',
    keyUrl: 'https://console.deepgram.com/',
    defaultModel: 'nova-3',
    models: [
      { id: 'nova-3', label: 'Nova-3 — latest (default)' },
      { id: 'nova-2', label: 'Nova-2' },
    ],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe',
    offline: false,
    needsKey: true,
    freeTier: '~10k credits/mo · no card to start',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    defaultModel: 'scribe_v2',
    models: [
      // scribe_v1 was deprecated; scribe_v2 is the current batch STT model.
      { id: 'scribe_v2', label: 'Scribe v2 (default)' },
    ],
  },
  {
    id: 'sarvam',
    label: 'Sarvam (Indian)',
    offline: false,
    needsKey: true,
    freeTier: 'Free trial credits · Indian languages',
    keyUrl: 'https://dashboard.sarvam.ai/',
    defaultModel: 'saarika:v2.5',
    models: [
      { id: 'saarika:v2.5', label: 'Saarika v2.5 (default)' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    offline: false,
    needsKey: true,
    keyId: 'openai',
    freeTier: 'Paid — no free tier',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini-transcribe',
    models: [
      { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini transcribe (default)' },
      { id: 'gpt-4o-transcribe', label: 'GPT-4o transcribe — best' },
      { id: 'whisper-1', label: 'Whisper-1 — classic' },
    ],
  },
];

export function getSTTInfo(id: string): STTInfo | undefined {
  return STT_CATALOG.find(s => s.id === id);
}
