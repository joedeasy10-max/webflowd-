/**
 * Redaction for logs and audit metadata. We never write raw secrets or full PII
 * into logs, `ai_actions`, or `audit_log`. Pass any object through `redact()`
 * before it leaves the process or lands in a durable record.
 */

const SENSITIVE_KEY = /(token|secret|password|authorization|api[_-]?key|refresh|access[_-]?token|client[_-]?secret|signature|cookie|set-cookie|bearer)/i;
const EMAIL_RE = /([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const PHONE_RE = /(\+?\d[\d\s()-]{7,}\d)/g;

const MAX_DEPTH = 6;

/** Mask an email as `j****@example.com`. */
export function maskEmail(value: string): string {
  return value.replace(EMAIL_RE, (_m, first: string, domain: string) => `${first}****${domain}`);
}

/** Mask a phone number, keeping only the last 3 digits. */
export function maskPhone(value: string): string {
  return value.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 6) return m;
    return `***${digits.slice(-3)}`;
  });
}

function redactString(value: string): string {
  return maskPhone(maskEmail(value));
}

/**
 * Deep-redact a value: sensitive-named keys become `[REDACTED]`, and string
 * values have emails/phones masked. Cycles and over-deep structures are cut.
 */
export function redact<T>(input: T, depth = 0, seen = new WeakSet<object>()): unknown {
  if (input == null) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (typeof input === "bigint") return input.toString();
  if (input instanceof Date) return input.toISOString();

  if (depth >= MAX_DEPTH) return "[TRUNCATED]";

  if (Array.isArray(input)) {
    return input.map((v) => redact(v, depth + 1, seen));
  }

  if (typeof input === "object") {
    if (seen.has(input as object)) return "[CIRCULAR]";
    seen.add(input as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v, depth + 1, seen);
      }
    }
    return out;
  }

  return "[UNSERIALIZABLE]";
}
