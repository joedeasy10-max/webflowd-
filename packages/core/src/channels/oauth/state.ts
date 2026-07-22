import { createHash, randomBytes } from "node:crypto";
import type { ConnectionProvider } from "@webflowd/shared";
import { Cryptor, getCryptor } from "../../crypto/index.js";

/**
 * OAuth "state" is encrypted (AES-256-GCM) rather than merely signed, because it
 * carries the PKCE code_verifier, which must stay confidential. Encryption also
 * gives integrity — only our server (holding the key) can mint a valid state, so
 * the callback can trust the tenant/provider it decodes without server-side
 * session storage.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const STATE_AAD = "oauth-state:v1";

export interface OAuthStatePayload {
  tenantId: string;
  provider: ConnectionProvider;
  /** PKCE code_verifier (kept confidential inside the encrypted state). */
  codeVerifier: string;
  nonce: string;
  issuedAt: number;
  /** Optional post-connect redirect target within our app. */
  returnTo?: string;
}

export interface CreatedState {
  /** Opaque encrypted `state` query param. */
  state: string;
  /** PKCE S256 challenge to include in the auth URL. */
  codeChallenge: string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Generate a PKCE verifier/challenge pair (S256). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48)); // 64 chars, within RFC 7636 43–128
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState(
  input: { tenantId: string; provider: ConnectionProvider; returnTo?: string },
  cryptor: Cryptor = getCryptor(),
): CreatedState {
  const { verifier, challenge } = generatePkce();
  const payload: OAuthStatePayload = {
    tenantId: input.tenantId,
    provider: input.provider,
    codeVerifier: verifier,
    nonce: base64url(randomBytes(16)),
    issuedAt: Date.now(),
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
  };
  const state = cryptor.encrypt(JSON.stringify(payload), STATE_AAD);
  return { state, codeChallenge: challenge };
}

export class OAuthStateError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

/**
 * Decrypt and validate a state param. Throws if tampered, expired, or the
 * provider doesn't match what the callback route expects.
 */
export function parseOAuthState(
  state: string,
  expectedProvider: ConnectionProvider,
  cryptor: Cryptor = getCryptor(),
): OAuthStatePayload {
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(cryptor.decrypt(state, STATE_AAD)) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError("Invalid OAuth state");
  }
  if (payload.provider !== expectedProvider) {
    throw new OAuthStateError("OAuth state provider mismatch");
  }
  if (!payload.tenantId || !payload.codeVerifier) {
    throw new OAuthStateError("Malformed OAuth state");
  }
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) {
    throw new OAuthStateError("OAuth state expired; please try connecting again");
  }
  return payload;
}
