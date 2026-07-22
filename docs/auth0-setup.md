# Auth0 setup

The signed-in area is gated by Auth0. The backend verifies the Auth0 **access
token** (RS256, via JWKS) on every `/api/*` call and resolves the tenant from the
verified `sub`. This guide sets up everything the code in this repo expects.

You need three things in your Auth0 tenant: an **API**, a **Single Page
Application**, and a **Login Action** that adds an email claim to the access
token.

---

## 1. Create the API (the audience)

Auth0 Dashboard → **Applications → APIs → Create API**.

- **Name:** `Webflow'd API`
- **Identifier (audience):** `https://api.webflowd.com` (any stable URI; it is
  not called, just an identifier). This becomes `AUTH0_AUDIENCE`.
- **Signing algorithm:** **RS256** (default — required).

That's all the API needs. Leave RBAC off for now.

---

## 2. Create the Single Page Application

Auth0 Dashboard → **Applications → Applications → Create Application** →
**Single Page Web Applications**.

Under the app's **Settings**, set (replace the host with your real domain; keep
the `/app/` path — that is where the signed-in app is served):

| Field | Value |
|---|---|
| **Allowed Callback URLs** | `https://webflowd.com/app/`, `http://localhost:8888/app/` |
| **Allowed Logout URLs** | `https://webflowd.com/app/`, `http://localhost:8888/app/` |
| **Allowed Web Origins** | `https://webflowd.com`, `http://localhost:8888` |

Note the **Domain** and **Client ID** from this page. The refresh-token rotation
the frontend uses (`useRefreshTokens: true`) works out of the box for SPAs.

---

## 3. Add a Login Action for the email claim

Access tokens do **not** include the user's email by default, but the backend
requires it (to create/lookup the tenant owner). Add it via an Action.

Auth0 Dashboard → **Actions → Library → Create Action** → **Build from scratch**
(trigger: **Login / Post Login**). Paste:

```js
exports.onExecutePostLogin = async (event, api) => {
  const ns = "https://webflowd.com/"; // must match the namespace in the code
  api.accessToken.setCustomClaim(ns + "email", event.user.email);
  api.accessToken.setCustomClaim(
    ns + "name",
    event.user.name || event.user.nickname || "",
  );
};
```

Deploy it, then **Actions → Triggers → post-login** and drag the Action into the
flow.

> The namespace `https://webflowd.com/` must match `ns` in
> `packages/core/src/security/auth0.ts`. If you change one, change both.

---

## 4. Wire the environment variables

**Backend** (Netlify function env / `.env`):

```
AUTH0_DOMAIN=your-tenant.eu.auth0.com
AUTH0_AUDIENCE=https://api.webflowd.com
AUTH0_CLIENT_ID=<SPA client id>   # informational; verification uses domain+audience
```

**Frontend** (`packages/web`, build-time, public — safe to expose):

```
VITE_AUTH0_DOMAIN=your-tenant.eu.auth0.com
VITE_AUTH0_CLIENT_ID=<SPA client id>
VITE_AUTH0_AUDIENCE=https://api.webflowd.com
```

The frontend requests this audience, so the token it sends is a JWT the backend
can verify. (Without the audience, Auth0 issues an opaque token that fails
verification — a common first-time gotcha.)

---

## 5. Verify it works

1. `pnpm --filter @webflowd/web dev`, open the app, sign in.
2. In DevTools, confirm the app calls `GET /api/me` with an
   `Authorization: Bearer <jwt>` header and gets a 200 with your tenant.
3. Paste the token into <https://jwt.io> and confirm it contains
   `https://webflowd.com/email` and an `aud` of `https://api.webflowd.com`.

If `/api/me` returns **401**, the token isn't a valid RS256 JWT for this
audience (check step 4's audience). If it returns **403 "missing an email
claim"**, the Action in step 3 isn't in the post-login flow.
