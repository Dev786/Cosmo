import { safeStorage } from 'electron';
import { log } from './log';

// User-entered API keys. On disk they live in config.json as SEALED strings
// (OS-keychain-encrypted via Electron safeStorage, tagged "enc:"); we never write
// the raw key. At runtime we hold a decrypted copy in memory so providers can read
// it synchronously at call time. If the OS keychain is unavailable we fall back to
// a tagged base64 ("raw:") so the feature still works, just without encryption.

const cache: Record<string, string> = {};   // provider id -> plaintext key (memory only)

function canEncrypt(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

/** Encrypt a plaintext key into a tagged, storable string. '' for an empty key. */
export function sealKey(plaintext: string): string {
  if (!plaintext) return '';
  if (canEncrypt()) {
    try { return 'enc:' + safeStorage.encryptString(plaintext).toString('base64'); }
    catch (e) { log.warn('safeStorage encrypt failed, storing unencrypted:', (e as Error).message); }
  }
  return 'raw:' + Buffer.from(plaintext, 'utf8').toString('base64');
}

/** Open a sealed key. Returns the plaintext, or `null` for an `enc:` blob that
 *  fails to decrypt — a dead blob (sealed under a keychain key that's no longer
 *  valid for this binary, e.g. after switching between the packaged app and a dev
 *  build). Dead blobs never recover, so the caller treats null specially. */
function openKey(sealed: string): string | null {
  if (!sealed) return '';
  if (sealed.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64')); }
    catch { return null; }
  }
  if (sealed.startsWith('raw:')) return Buffer.from(sealed.slice(4), 'base64').toString('utf8');
  return '';
}

/** Decrypt persisted (sealed) keys into the in-memory cache. Call once at boot,
 *  AFTER app is ready (safeStorage needs the keychain). Returns the provider ids
 *  whose sealed blob could NOT be decrypted *while the keychain was available* —
 *  these are permanently dead and the caller should purge them from config so the
 *  warning stops recurring and setup re-prompts. When the keychain is unavailable
 *  the blobs may still be fine next session, so we return none (never purge). */
export function initSecrets(sealedMap: Record<string, string> | undefined): string[] {
  const encOk = canEncrypt();
  const dead: string[] = [];
  for (const [provider, sealed] of Object.entries(sealedMap ?? {})) {
    const k = openKey(sealed);
    if (k === null) { dead.push(provider); continue; } // enc: blob failed to decrypt
    if (k) cache[provider] = k;
  }
  const n = Object.keys(cache).length;
  if (n) log.info(`Loaded ${n} stored API key(s) (${encOk ? 'encrypted' : 'UNENCRYPTED — keychain unavailable'})`);
  if (dead.length) {
    if (encOk) log.warn(`Clearing ${dead.length} stored key(s) that can no longer be decrypted [${dead.join(', ')}] — the keychain key changed since they were saved (e.g. packaged app vs dev build). Re-enter them in setup (⚙) to re-save.`);
    else log.warn(`${dead.length} encrypted key(s) unreadable this session (keychain unavailable); keeping them and falling back to env keys.`);
  }
  return encOk ? dead : [];
}

/** Resolve a provider's key at call time: a user-entered key wins, else the env
 *  var (legacy .env path). Returns '' when neither is set. */
export function getApiKey(provider: string, envVar?: string): string {
  return cache[provider] || (envVar ? (process.env[envVar] ?? '') : '') || '';
}

/** True if a key is resolvable for this provider (user-entered or env). */
export function hasApiKey(provider: string, envVar?: string): boolean {
  return !!getApiKey(provider, envVar);
}

/** Update the in-memory key and return the sealed blob to persist in config. */
export function setApiKey(provider: string, plaintext: string): string {
  cache[provider] = plaintext;
  return sealKey(plaintext);
}
