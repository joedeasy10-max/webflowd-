import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, json, methodRouter, readJson, withErrorHandling } from "./http.js";

describe("json", () => {
  it("sets no-store and nosniff headers", async () => {
    const res = json({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ a: 1 });
  });
});

describe("methodRouter", () => {
  it("routes to the matching method", async () => {
    const req = new Request("http://x/api", { method: "GET" });
    const res = await methodRouter(req, { GET: () => json({ ok: true }) });
    expect(res.status).toBe(200);
  });

  it("returns 405 with an Allow list for unhandled methods", async () => {
    const req = new Request("http://x/api", { method: "DELETE" });
    const res = await methodRouter(req, { GET: () => json({}), POST: () => json({}) });
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ allow: "GET, POST" });
  });
});

describe("readJson", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("parses a valid body", async () => {
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ name: "Joe" }) });
    expect(await readJson(req, schema)).toEqual({ name: "Joe" });
  });

  it("throws 400 on invalid JSON", async () => {
    const req = new Request("http://x", { method: "POST", body: "{not json" });
    await expect(readJson(req, schema)).rejects.toMatchObject({ status: 400 });
  });

  it("throws 422 with issues on validation failure", async () => {
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ name: "" }) });
    await expect(readJson(req, schema)).rejects.toMatchObject({ status: 422 });
  });
});

describe("withErrorHandling", () => {
  it("maps HttpError to a JSON response", async () => {
    const res = await withErrorHandling(async () => {
      throw new HttpError(404, "Nope");
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Nope" });
  });

  it("maps a tagged status error (e.g. TenantError) to its status", async () => {
    const res = await withErrorHandling(async () => {
      throw Object.assign(new Error("blocked"), { status: 403 });
    });
    expect(res.status).toBe(403);
  });

  it("hides unexpected errors behind a 500", async () => {
    const res = await withErrorHandling(async () => {
      throw new Error("secret internal detail");
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
  });
});
