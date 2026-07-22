# Twilio voice receptionist setup

The turn-based voice receptionist answers inbound calls with a spoken AI agent
using Twilio Programmable Voice `<Gather input="speech">`. Each caller utterance
is transcribed by Twilio, answered by the same Claude engine that powers chat,
and read back with `<Say>`. It is request/response (no persistent socket), so it
runs on Netlify Functions as-is.

> This is the turn-based tier: robust and low-cost, with a short pause between
> turns and no interruption ("barge-in"). Full real-time conversational voice
> (Twilio Media Streams + streaming STT/TTS) is a separate, always-on service.

## Endpoints

| Purpose | Path |
| --- | --- |
| Inbound call greeting + first turn | `/webhooks/twilio/voice-inbound` |
| Each subsequent spoken turn | `/webhooks/twilio/voice-turn` (called automatically) |
| Missed-call text-back (no answer) | `/webhooks/twilio/voice` |
| Voicemail transcription → SMS | `/webhooks/twilio/recording` |

## Configure the number

In the Twilio Console for the tenant's phone number:

1. **Voice → A call comes in** → Webhook → `https://<your-host>/webhooks/twilio/voice-inbound` (HTTP POST).
2. (Optional) **Call status changes** → `https://<your-host>/webhooks/twilio/voice` to trigger missed-call text-back on `no-answer`/`busy`/`failed`.
3. Register the number as a `voice` channel for the tenant (the `identifier`
   must be the E.164 number Twilio sends as `To`), so the tenant is resolved from
   the called number.

## Environment

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — required; the auth token verifies
  every request's `X-Twilio-Signature`.
- `TWILIO_SMS_FROM` — used as the SMS sender for missed-call / voicemail follow-ups.
- `TWILIO_PUBLIC_BASE_URL` — set to your public origin (e.g.
  `https://webflowd.com`) if a proxy rewrites the request host, so the callback
  URLs are built and signature-verified against the URL Twilio actually calls.

## How a call flows

1. Call arrives → `voice-inbound` verifies the signature, resolves the tenant,
   opens a `voice` conversation, greets the caller, and gathers their first
   request. The conversation id rides in the `<Gather action>` URL.
2. Twilio transcribes the speech and POSTs it to `voice-turn`, which runs the
   Claude engine (with the conversation's history), speaks the reply, and gathers
   the next turn.
3. If the assistant escalates (it isn't sure, or the request is out of policy),
   the call ends with a callback promise and the thread appears in the owner's
   escalation queue. Repeated silence ends the call politely.

All turns are persisted as messages and audit-logged, exactly like chat.
