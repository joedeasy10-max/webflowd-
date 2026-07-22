CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TABLE "lead_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"channel" "channel_type" NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"currency" text DEFAULT 'gbp' NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"channel" "channel_type",
	"valid_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_followups_send_at_idx" ON "lead_followups" USING btree ("send_at");--> statement-breakpoint
CREATE INDEX "quotes_tenant_idx" ON "quotes" USING btree ("tenant_id");--> statement-breakpoint
-- quotes are tenant-scoped and owner-managed: enforce tenant RLS (defence-in-depth)
-- exactly like the other business tables (see migration 0001).
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "quotes";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "quotes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- lead_followups is a system-scanned operational queue (like reminders /
-- review_requests): the follow-up cron finds due items ACROSS all tenants before
-- any tenant context exists, which FORCE RLS would block. No tenant RLS; every row
-- still carries tenant_id and per-tenant processing runs tenant-scoped.