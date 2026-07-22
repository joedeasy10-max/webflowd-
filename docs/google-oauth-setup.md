# Google Calendar OAuth setup

Lets an owner connect their Google Calendar so the assistant can read real
availability (free/busy) and, later, create bookings. You'll create a Google
Cloud project, enable the Calendar API, configure the consent screen, and create
an OAuth client. It takes ~10 minutes.

## 1. Create a project and enable the API

1. Go to **https://console.cloud.google.com/** → create a project (e.g.
   `webflowd-assistant`).
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** → Create.
3. Fill app name (`Webflow'd`), support email, and developer contact.
4. **Scopes** → Add these (the assistant requests exactly these):
   - `openid`
   - `.../auth/userinfo.email`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`
5. While the app is in **Testing**, add each owner's Google address under **Test
   users** (Google only issues refresh tokens to allowed users until the app is
   verified/Published).

## 3. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add both:
   - `https://webflowd.com/api/oauth/google/callback`
   - `http://localhost:8888/api/oauth/google/callback` (local dev)

   > The path must be exactly `/api/oauth/google/callback` — it's derived from
   > `APP_BASE_URL` in the code.
4. Create, then copy the **Client ID** and **Client secret**.

## 4. Set environment variables

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
APP_BASE_URL=https://webflowd.com   # or http://localhost:8888 for local dev
```

## 5. Verify

1. In the signed-in app, open **Connections → Google Calendar → Connect**.
2. Approve the consent screen; you're redirected back with `?connected=google`.
3. `GET /api/connections` shows the Google connection as `active`.
4. `GET /api/freebusy?connectionId=<id>` returns busy blocks from your calendar.

**Notes**
- The code sends `access_type=offline` + `prompt=consent`, so Google returns a
  refresh token (needed to keep working without re-consent). Tokens are stored
  encrypted (AES-256-GCM) and never returned to the browser.
- Going to production for all users (not just test users) requires Google's
  verification for the sensitive Calendar scopes. Plan for that before launch.
