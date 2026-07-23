# Sample skills

Ready-to-use example skill manifests for the **Admin → Skills & Features** tab.
Each is a declarative manifest — it adds prompt instructions the assistant
follows and/or toggles a pre-approved feature flag. No skill contains executable
code; that is enforced by the upload validator.

## How to use

1. Sign in and open the **Admin** tab.
2. Copy the contents of one of these `.json` files into the **Upload a skill** box.
3. Click **Install skill**.
4. Use the **Enable / Disable** toggle to turn it on or off at any time — changes
   apply on the next customer message or call, with no redeploy.

## What's here

| File | What it does |
| --- | --- |
| `after-hours-reassurance.json` | Softer, reassuring tone for out-of-hours enquiries (instructions only). |
| `deposit-collection.json` | Enables the `deposits` feature flag and explains the deposit policy. |
| `emergency-triage.json` | Detects urgent jobs and escalates them instead of offering a routine slot. |

## Manifest fields

- `key` — stable, lowercase id, unique per client (`a-z 0-9 - _`).
- `name` — display name.
- `description` — optional, shown in the admin list.
- `category` — `knowledge` | `feature` | `workflow` (grouping only).
- `instructions` — guidance appended to the assistant's system prompt when enabled.
- `featureFlags` — any of: `deposits`, `reminders`, `review_requests`,
  `lead_followup`, `voice`, `missed_call_text_back` (allowlist-checked).
- `enabled` — install on or off (default on).

A manifest must provide `instructions` and/or at least one `featureFlag`.
