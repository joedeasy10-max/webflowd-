# Microsoft (Outlook) Calendar OAuth setup

Lets an owner connect their Microsoft 365 / Outlook calendar so the assistant can
read real availability and, later, create bookings. You'll register an app in
Entra ID (Azure AD), add a secret, and grant Graph calendar permissions. ~10 min.

## 1. Register the application

1. Go to **https://entra.microsoft.com/** (or Azure Portal → **App
   registrations**) → **New registration**.
2. Name: `Webflow'd Assistant`.
3. **Supported account types:** *Accounts in any organizational directory and
   personal Microsoft accounts* (this matches the `common` endpoint the code
   uses, covering business and personal Outlook accounts).
4. **Redirect URI:** platform **Web** →
   `https://webflowd.com/api/oauth/microsoft/callback`
   Register.
5. After registering, add a second Web redirect URI under **Authentication** for
   local dev: `http://localhost:8888/api/oauth/microsoft/callback`.

   > The path must be exactly `/api/oauth/microsoft/callback` (derived from
   > `APP_BASE_URL`).

Copy the **Application (client) ID** from the Overview page.

## 2. Create a client secret

1. **Certificates & secrets → Client secrets → New client secret**.
2. Copy the secret **Value** immediately (it's shown only once).

## 3. Add Microsoft Graph permissions

1. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**, add:
   - `Calendars.ReadWrite`
   - `offline_access`
   - `openid`
   - `email`
2. For personal/most business accounts these are user-consentable, so no admin
   consent is required. If a tenant restricts consent, an org admin may need to
   click **Grant admin consent**.

## 4. Set environment variables

```
MS_CLIENT_ID=<application (client) id>
MS_CLIENT_SECRET=<client secret value>
MS_TENANT=common
APP_BASE_URL=https://webflowd.com   # or http://localhost:8888 for local dev
```

## 5. Verify

1. In the signed-in app, open **Connections → Microsoft Outlook → Connect**.
2. Approve consent; you're redirected back with `?connected=microsoft`.
3. `GET /api/connections` shows the Microsoft connection as `active`.
4. `GET /api/freebusy?connectionId=<id>` returns busy blocks (read via Graph
   `calendarView`, normalised to UTC).

**Notes**
- `offline_access` yields a refresh token so the connection keeps working; the
  token manager refreshes automatically and flags `needs_reauth` if refresh ever
  fails. Tokens are stored encrypted and never returned to the browser.
