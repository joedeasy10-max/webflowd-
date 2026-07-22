import { ZodError, type z, type ZodTypeAny } from "zod";

/** JSON response helper with sane security headers. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

export class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown> | undefined;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Parse and validate a JSON request body against a Zod schema. Returns the
 * schema's OUTPUT type (defaults applied), so downstream repos receive fully
 * populated values.
 */
export async function readJson<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(422, "Validation failed", { issues: flattenZod(result.error) });
  }
  return result.data;
}

function flattenZod(err: ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Dispatch by HTTP method; returns 405 for anything unhandled. */
export async function methodRouter(
  req: Request,
  handlers: Partial<Record<string, () => Promise<Response> | Response>>,
): Promise<Response> {
  const handler = handlers[req.method.toUpperCase()];
  if (!handler) {
    const allow = Object.keys(handlers).join(", ");
    return error(405, "Method not allowed", { allow });
  }
  return handler();
}

/**
 * Wrap a handler so thrown HttpError / tagged errors become clean JSON responses
 * and unexpected errors return 500 without leaking internals.
 */
export async function withErrorHandling(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return error(err.status, err.message, err.extra);
    // Errors that carry a numeric `status` (AuthError, TenantError).
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") {
      return error(status, (err as Error).message);
    }
    console.error("Unhandled function error:", (err as Error).message);
    return error(500, "Internal error");
  }
}
