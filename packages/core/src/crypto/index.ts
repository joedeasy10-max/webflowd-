import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for secrets at rest (OAuth tokens, provider API keys).
 *
 * Format (dot-separated, all base64url):  `<version>.<iv>.<tag>.<ciphertext>`
 * - AES-256-GCM, 96-bit random IV per record, 128-bit auth tag.
 * - Optional AAD binds a ciphertext to its context (e.g. `${tenantId}:${provider}`)
 *   so a stolen row cannot be replayed under a different tenant/provider.
 * - `version` selects the key, enabling rotation without re-encrypting everything.
 *
 * Ciphertext is the only form allowed in the database. Plaintext is never logged
 * and never returned to the client.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64url");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function decodeKey(raw: string, label: string): Buffer {
  let key: Buffer;
  try {
    // Accept base64 or base64url.
    key = Buffer.from(raw, "base64");
  } catch {
    throw new CryptoError(`${label} is not valid base64`);
  }
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`${label} must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export interface CryptorConfig {
  /** The key version used for new encryptions. */
  currentVersion: number;
  /** version -> 32-byte key. Must include `currentVersion` plus any retired keys. */
  keys: Record<number, Buffer>;
}

export class Cryptor {
  private readonly currentVersion: number;
  private readonly keys: Map<number, Buffer>;

  constructor(config: CryptorConfig) {
    this.currentVersion = config.currentVersion;
    this.keys = new Map(Object.entries(config.keys).map(([v, k]) => [Number(v), k]));
    if (!this.keys.has(this.currentVersion)) {
      throw new CryptoError(`No key provided for current version ${this.currentVersion}`);
    }
    for (const [v, k] of this.keys) {
      if (k.length !== KEY_BYTES) {
        throw new CryptoError(`Key for version ${v} must be ${KEY_BYTES} bytes`);
      }
    }
  }

  /** Encrypt plaintext, optionally bound to AAD context. */
  encrypt(plaintext: string, aad?: string): string {
    const key = this.keys.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      String(this.currentVersion),
      b64urlEncode(iv),
      b64urlEncode(tag),
      b64urlEncode(ct),
    ].join(".");
  }

  /** Decrypt a payload produced by `encrypt`. Throws on tamper or wrong AAD. */
  decrypt(payload: string, aad?: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4) {
      throw new CryptoError("Malformed ciphertext payload");
    }
    const [versionStr, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    const version = Number(versionStr);
    const key = this.keys.get(version);
    if (!key) {
      throw new CryptoError(`No key available for version ${versionStr}`);
    }
    const iv = b64urlDecode(ivB64);
    const tag = b64urlDecode(tagB64);
    const ct = b64urlDecode(ctB64);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new CryptoError("Invalid IV or auth tag length");
    }
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    try {
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch {
      // GCM auth failure — tampered ciphertext, wrong key, or wrong AAD.
      throw new CryptoError("Decryption failed (authentication)");
    }
  }

  /** True if a payload was encrypted with a version other than the current one. */
  needsRotation(payload: string): boolean {
    const v = Number(payload.split(".")[0]);
    return Number.isFinite(v) && v !== this.currentVersion;
  }
}

/**
 * Build a Cryptor from environment variables:
 * - TOKEN_ENCRYPTION_KEY          base64 32-byte current key
 * - TOKEN_ENCRYPTION_KEY_VERSION  integer version for the current key
 * - TOKEN_ENCRYPTION_KEYS         optional JSON map {"<version>": "<base64 key>"}
 *                                 of retired keys (for decrypt during rotation)
 */
export function cryptorFromEnv(env: NodeJS.ProcessEnv = process.env): Cryptor {
  const currentRaw = env.TOKEN_ENCRYPTION_KEY;
  if (!currentRaw) throw new CryptoError("TOKEN_ENCRYPTION_KEY is not set");
  const currentVersion = Number(env.TOKEN_ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(currentVersion)) {
    throw new CryptoError("TOKEN_ENCRYPTION_KEY_VERSION must be an integer");
  }

  const keys: Record<number, Buffer> = {
    [currentVersion]: decodeKey(currentRaw, "TOKEN_ENCRYPTION_KEY"),
  };

  if (env.TOKEN_ENCRYPTION_KEYS) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(env.TOKEN_ENCRYPTION_KEYS);
    } catch {
      throw new CryptoError("TOKEN_ENCRYPTION_KEYS must be valid JSON");
    }
    for (const [v, raw] of Object.entries(parsed)) {
      keys[Number(v)] = decodeKey(raw, `TOKEN_ENCRYPTION_KEYS[${v}]`);
    }
  }

  return new Cryptor({ currentVersion, keys });
}

/** Lazily-constructed process-wide cryptor. */
let singleton: Cryptor | null = null;
export function getCryptor(): Cryptor {
  if (!singleton) singleton = cryptorFromEnv();
  return singleton;
}

/** Constant-time string comparison, for signatures/secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
