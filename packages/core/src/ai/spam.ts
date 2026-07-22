/**
 * Lightweight inbound spam / auto-reply heuristic. Returns a score 0–100 and a
 * boolean. This is a cheap first filter to avoid spending model calls on obvious
 * junk — not a security control.
 */
const AUTO_REPLY_MARKERS = [
  "out of office",
  "auto-reply",
  "automatic reply",
  "do not reply",
  "delivery status notification",
  "undeliverable",
  "unsubscribe",
];

const SPAMMY_MARKERS = ["viagra", "crypto investment", "seo services", "loan offer", "casino"];

export interface SpamVerdict {
  score: number;
  isSpam: boolean;
  reason?: string;
}

export function classifySpam(text: string): SpamVerdict {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return { score: 100, isSpam: true, reason: "empty" };
  if (t.length > 8000) return { score: 80, isSpam: true, reason: "too_long" };

  let score = 0;
  let reason: string | undefined;
  for (const m of AUTO_REPLY_MARKERS) {
    if (t.includes(m)) {
      score = Math.max(score, 90);
      reason = "auto_reply";
    }
  }
  for (const m of SPAMMY_MARKERS) {
    if (t.includes(m)) {
      score = Math.max(score, 85);
      reason = reason ?? "spam_keyword";
    }
  }
  // A high ratio of links is a spam signal.
  const links = (t.match(/https?:\/\//g) ?? []).length;
  if (links >= 5) {
    score = Math.max(score, 70);
    reason = reason ?? "many_links";
  }

  return { score, isSpam: score >= 70, ...(reason ? { reason } : {}) };
}
