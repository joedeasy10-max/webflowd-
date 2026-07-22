import {
  buildLifecycleSender,
  processDueReminders,
  processDueReviewRequests,
} from "@webflowd/core";
import { inngest } from "./client.js";

/**
 * Cron: send due appointment reminders. Runs every 15 minutes; the processor
 * scans across tenants, honours STOP/opt-out, and skips cancelled/no-show jobs.
 */
export const remindersCron = inngest.createFunction(
  { id: "process-due-reminders", name: "Process due reminders" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const sender = buildLifecycleSender(process.env);
    return step.run("send-due-reminders", () => processDueReminders({ sender }));
  },
);

/**
 * Cron: send review requests for finished jobs. Runs hourly; the processor only
 * sends once a job has ended (+ delay) and leaves not-yet-eligible rows scheduled.
 */
export const reviewRequestsCron = inngest.createFunction(
  { id: "process-due-review-requests", name: "Process due review requests" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const sender = buildLifecycleSender(process.env);
    const reviewLink = (tenantId: string): string | undefined => {
      void tenantId;
      return process.env.DEFAULT_REVIEW_LINK || undefined;
    };
    return step.run("send-due-review-requests", () =>
      processDueReviewRequests({ sender, reviewLink }),
    );
  },
);

export const functions = [remindersCron, reviewRequestsCron];
