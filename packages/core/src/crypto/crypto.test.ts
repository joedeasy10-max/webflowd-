import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Cryptor, CryptoError, cryptorFromEnv, safeEqual } from "./index.js";

function key(): Buffer {
  return randomBytes(32);
}

describe("Cryptor", () => {
  it("round-trips plaintext", () => {
    const c = new Cryptor({ currentVersion: 1, keys: { 1: key() } });
    const secret = "ya29.super-secret-refresh-token";
    const enc = c.encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(c.decrypt(enc)).toBe(secret);
  });

  it("produces a fresh IV each time (distinct ciphertexts)", () => {
    const c = new Cryptor({ currentVersion: 1, keys: { 1: key() } });
    expect(c.encrypt("same")).not.toBe(c.encrypt("same"));
  });

  it("fails to decrypt tampered ciphertext", () => {
    const c = new Cryptor({ currentVersion: 1, keys: { 1: key() } });
    const enc = c.encrypt("hello");
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => c.decrypt(parts.join("."))).toThrow(CryptoError);
  });

  it("enforces AAD binding", () => {
    const c = new Cryptor({ currentVersion: 1, keys: { 1: key() } });
    const enc = c.encrypt("token", "tenant-A:google");
    expect(c.decrypt(enc, "tenant-A:google")).toBe("token");
    expect(() => c.decrypt(enc, "tenant-B:google")).toThrow(CryptoError);
    expect(() => c.decrypt(enc)).toThrow(CryptoError);
  });

  it("decrypts across key rotation and flags rotation need", () => {
    const k1 = key();
    const k2 = key();
    const v1 = new Cryptor({ currentVersion: 1, keys: { 1: k1 } });
    const enc = v1.encrypt("legacy");

    // New cryptor: current v2, but still holds v1 for decryption.
    const v2 = new Cryptor({ currentVersion: 2, keys: { 1: k1, 2: k2 } });
    expect(v2.decrypt(enc)).toBe("legacy");
    expect(v2.needsRotation(enc)).toBe(true);
    expect(v2.needsRotation(v2.encrypt("new"))).toBe(false);
  });

  it("rejects an unknown key version", () => {
    const c = new Cryptor({ currentVersion: 1, keys: { 1: key() } });
    const enc = c.encrypt("x");
    const other = new Cryptor({ currentVersion: 9, keys: { 9: key() } });
    expect(() => other.decrypt(enc)).toThrow(CryptoError);
  });

  it("rejects malformed payloads", () => {
    const c = new Cryptor({ currentVersion: 1, keys: { 1: key() } });
    expect(() => c.decrypt("not-a-payload")).toThrow(CryptoError);
  });

  it("requires a key for the current version", () => {
    expect(() => new Cryptor({ currentVersion: 2, keys: { 1: key() } })).toThrow(CryptoError);
  });
});

describe("cryptorFromEnv", () => {
  it("builds from env and supports retired keys", () => {
    const k1 = key().toString("base64");
    const k2 = key().toString("base64");
    const c = cryptorFromEnv({
      TOKEN_ENCRYPTION_KEY: k2,
      TOKEN_ENCRYPTION_KEY_VERSION: "2",
      TOKEN_ENCRYPTION_KEYS: JSON.stringify({ 1: k1 }),
    } as NodeJS.ProcessEnv);
    const enc = c.encrypt("hi");
    expect(c.decrypt(enc)).toBe("hi");
  });

  it("throws when the key is missing or wrong size", () => {
    expect(() => cryptorFromEnv({} as NodeJS.ProcessEnv)).toThrow(CryptoError);
    expect(() =>
      cryptorFromEnv({
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
      } as NodeJS.ProcessEnv),
    ).toThrow(CryptoError);
  });
});

describe("safeEqual", () => {
  it("compares in constant time by value", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
