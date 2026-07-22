import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Cryptor } from "../../crypto/index.js";
import { createOAuthState, generatePkce, OAuthStateError, parseOAuthState } from "./state.js";

function cryptor() {
  return new Cryptor({ currentVersion: 1, keys: { 1: randomBytes(32) } });
}

describe("generatePkce", () => {
  it("produces a verifier and a distinct S256 challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
  });
});

describe("OAuth state", () => {
  it("round-trips tenant + provider + verifier", () => {
    const c = cryptor();
    const { state, codeChallenge } = createOAuthState({ tenantId: "t1", provider: "google" }, c);
    expect(codeChallenge).toBeTruthy();
    const parsed = parseOAuthState(state, "google", c);
    expect(parsed.tenantId).toBe("t1");
    expect(parsed.provider).toBe("google");
    expect(parsed.codeVerifier).toBeTruthy();
  });

  it("rejects a provider mismatch", () => {
    const c = cryptor();
    const { state } = createOAuthState({ tenantId: "t1", provider: "google" }, c);
    expect(() => parseOAuthState(state, "microsoft", c)).toThrow(OAuthStateError);
  });

  it("rejects a tampered or foreign-key state", () => {
    const { state } = createOAuthState({ tenantId: "t1", provider: "google" }, cryptor());
    expect(() => parseOAuthState(state, "google", cryptor())).toThrow(OAuthStateError);
  });

  it("rejects expired state", () => {
    const c = cryptor();
    const { state } = createOAuthState({ tenantId: "t1", provider: "google" }, c);
    // Re-parse with a state whose issuedAt is old: forge by decrypting is hard,
    // so assert the TTL path via a hand-built payload.
    const old = JSON.stringify({
      tenantId: "t1",
      provider: "google",
      codeVerifier: "v",
      nonce: "n",
      issuedAt: Date.now() - 20 * 60 * 1000,
    });
    const oldState = c.encrypt(old, "oauth-state:v1");
    expect(() => parseOAuthState(oldState, "google", c)).toThrow(/expired/);
    // sanity: fresh one still parses
    expect(parseOAuthState(state, "google", c).tenantId).toBe("t1");
  });
});
