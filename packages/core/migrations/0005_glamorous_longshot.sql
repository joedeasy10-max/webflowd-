CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'knowledge' NOT NULL,
	"instructions" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skills_tenant_idx" ON "skills" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_tenant_key_uq" ON "skills" USING btree ("tenant_id","key");--> statement-breakpoint
-- skills are tenant-scoped and admin-managed: enforce tenant RLS (defence-in-depth)
-- exactly like the other business tables (see migration 0001).
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "skills";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "skills" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());