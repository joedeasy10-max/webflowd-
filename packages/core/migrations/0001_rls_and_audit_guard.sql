-- Row-Level Security (defence-in-depth) + append-only audit log.
--
-- The PRIMARY tenant isolation is the application-level tenancy guard (every
-- tenant-scoped query filters by tenant_id). These policies are a second layer:
-- when the app opens a tenant transaction it sets `app.tenant_id` (see
-- withTenantContext / runInTenant), and Postgres then refuses any row whose
-- tenant_id doesn't match — even if an application query forgot its filter.
--
-- Identity/provisioning tables (tenants, users) and global tables
-- (webhook_events, rate_limits) are intentionally NOT under tenant RLS: they
-- are accessed in a system context before any tenant is resolved.

-- Helper: current tenant from the session GUC, NULL if unset.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'business_profiles','services','business_hours','hours_exceptions',
    'booking_rules','knowledge_items','connections','channels','contacts',
    'conversations','messages','bookings','payments','reminders',
    'review_requests','escalations','ai_actions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so the table owner (the app's Neon role) is also subject to RLS.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

-- Append-only audit log: block UPDATE and DELETE at the database level so the
-- trail cannot be rewritten from application code (belt-and-braces with grants).
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% denied)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
