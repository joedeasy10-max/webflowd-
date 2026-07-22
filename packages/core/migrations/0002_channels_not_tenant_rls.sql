-- `channels` is a routing/identity table: the public chat-widget endpoint must
-- resolve a tenant from a widget public_key BEFORE any tenant context exists,
-- and tenant provisioning seeds a default chat channel as a system operation.
-- Both run without `app.tenant_id` set, so FORCE RLS (added in 0001) would block
-- them. Treat `channels` like `tenants`/`users`: no tenant RLS here — isolation
-- for owner-facing access is still enforced by the application-level tenant
-- filter on every channels query.

ALTER TABLE channels NO FORCE ROW LEVEL SECURITY;
ALTER TABLE channels DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON channels;
