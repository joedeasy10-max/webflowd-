import { Inngest, EventSchemas } from "inngest";

/**
 * Typed Inngest client for all durable/queued/cron work. Slow work never runs
 * inline in a webhook — webhooks emit one of these events and return 2xx fast;
 * the corresponding Inngest function (in ./functions.ts) does the real work with
 * retries + idempotency.
 */
export type Events = {
  "webform/received": {
    data: { publicKey: string; message: string; visitor?: { name?: string; email?: string } };
  };
};

export const inngest = new Inngest({
  id: "webflowd",
  schemas: new EventSchemas().fromRecord<Events>(),
  eventKey: process.env.INNGEST_EVENT_KEY,
});
