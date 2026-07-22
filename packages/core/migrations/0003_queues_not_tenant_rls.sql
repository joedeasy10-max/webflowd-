-- reminders and review_requests are system-scanned operational queues: the
-- lifecycle cron finds due items ACROSS all tenants before any tenant context
-- exists, which FORCE RLS would block. Treat them like channels/webhook_events —
-- no tenant RLS. Per-tenant processing still runs tenant-scoped (app-level
-- filter), and every row carries tenant_id.
ALTER TABLE reminders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE reminders DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reminders;

ALTER TABLE review_requests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE review_requests DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON review_requests;
