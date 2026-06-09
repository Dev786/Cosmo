// Minimal Google OAuth2 helpers — thin fetch over the token/auth endpoints, no
// SDK (keeps deps lean, mirrors the openaiCompat/httpTTS "thin REST" philosophy).
// Shared by the Gmail tool (token refresh on each call) and the Accounts
// onboarding flow (authorize → code exchange). Read-only Gmail scope only.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms; already padded 60s before true expiry
}

/** Consent URL for the loopback (desktop) flow. access_type=offline + prompt=consent
 *  guarantees a refresh_token comes back on first authorization. */
export function authUrl(clientId: string, redirectUri: string, scope = GMAIL_READONLY_SCOPE): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google code exchange ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in - 60) * 1000,
  };
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google token refresh ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
}
