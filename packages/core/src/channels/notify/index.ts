/** Low-level outbound senders. Higher layers compose messages and inject these. */

export async function sendEmailViaSendGrid(
  input: { apiKey: string; from: string; to: string; subject: string; text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: input.from },
      subject: input.subject,
      content: [{ type: "text/plain", value: input.text }],
    }),
  });
  if (!res.ok) throw new Error(`SendGrid send failed (${res.status})`);
}

export async function sendSmsViaTwilio(
  input: { accountSid: string; authToken: string; from: string; to: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const form = new URLSearchParams({ From: input.from, To: input.to, Body: input.body });
  const auth = Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64");
  const res = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );
  if (!res.ok) throw new Error(`Twilio send failed (${res.status})`);
}
