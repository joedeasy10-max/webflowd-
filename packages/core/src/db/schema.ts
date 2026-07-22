/**
 * Drizzle schema — multi-tenant from day one.
 *
 * Every business-scoped table carries `tenant_id` and is queried only through
 * the tenancy guard (see ../tenancy). Postgres RLS policies (see the generated
 * migration) enforce the same boundary as defence-in-depth.
 *
 * Times are stored as `timestamptz` (UTC). The business timezone (Europe/London)
 * is applied at compute/display time, never in storage.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRoleEnum = pgEnum("user_role", ["owner", "staff", "admin"]);
export const channelTypeEnum = pgEnum("channel_type", [
  "email",
  "chat",
  "sms",
  "whatsapp",
  "voice",
  "web_form",
  "google_business",
]);
export const connectionProviderEnum = pgEnum("connection_provider", [
  "google",
  "microsoft",
  "gmail",
  "sendgrid",
  "twilio",
  "google_business",
  "stripe",
]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "needs_reauth",
  "revoked",
]);
export const conversationStatusEnum = pgEnum("conversation_status", [
  "ai_handling",
  "needs_human",
  "resolved",
  "spam",
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "proposed",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageRoleEnum = pgEnum("message_role", ["customer", "ai", "owner", "system"]);
export const paymentTypeEnum = pgEnum("payment_type", ["deposit", "invoice"]);
export const escalationStatusEnum = pgEnum("escalation_status", ["open", "resolved"]);
export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
]);

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------
export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("active"),
    timezone: text("timezone").notNull().default("Europe/London"),
    plan: text("plan").notNull().default("trial"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tenants_slug_uq").on(t.slug)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    auth0Sub: text("auth0_sub").notNull(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull().default("owner"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_auth0_sub_uq").on(t.auth0Sub),
    index("users_tenant_idx").on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// Business profile & configuration
// ---------------------------------------------------------------------------
export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    legalName: text("legal_name"),
    displayName: text("display_name").notNull(),
    trade: text("trade"),
    phone: text("phone"),
    replyEmail: text("reply_email"),
    address: text("address"),
    serviceArea: jsonb("service_area"),
    about: text("about"),
    tone: text("tone"),
    pricingNotes: text("pricing_notes"),
    bookingPolicyText: text("booking_policy_text"),
    logoUrl: text("logo_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("business_profiles_tenant_uq").on(t.tenantId)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    defaultDurationMin: integer("default_duration_min").notNull(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    priceNote: text("price_note"),
    depositRequired: boolean("deposit_required").notNull().default(false),
    depositAmountPence: integer("deposit_amount_pence"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("services_tenant_idx").on(t.tenantId)],
);

export const businessHours = pgTable(
  "business_hours",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 0=Sun..6=Sat
    closed: boolean("closed").notNull().default(false),
    open: time("open"),
    close: time("close"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("business_hours_tenant_weekday_uq").on(t.tenantId, t.weekday)],
);

export const hoursExceptions = pgTable(
  "hours_exceptions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    closed: boolean("closed").notNull().default(true),
    open: time("open"),
    close: time("close"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("hours_exceptions_tenant_date_uq").on(t.tenantId, t.date)],
);

export const bookingRules = pgTable(
  "booking_rules",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    minNoticeMin: integer("min_notice_min").notNull().default(120),
    maxAdvanceDays: integer("max_advance_days").notNull().default(60),
    defaultBufferMin: integer("default_buffer_min").notNull().default(0),
    slotGranularityMin: integer("slot_granularity_min").notNull().default(30),
    maxJobsPerDay: integer("max_jobs_per_day").notNull().default(0),
    autoConfirm: boolean("auto_confirm").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("booking_rules_tenant_uq").on(t.tenantId)],
);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    tags: jsonb("tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("knowledge_items_tenant_idx").on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Connections & channels (Phase 2 populates these; schema defined now)
// ---------------------------------------------------------------------------
export const connections = pgTable(
  "connections",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: connectionProviderEnum("provider").notNull(),
    externalAccountId: text("external_account_id"),
    scopes: jsonb("scopes")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Ciphertext only (AES-256-GCM). Never plaintext, never returned to client.
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    keyVersion: integer("key_version"),
    status: connectionStatusEnum("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("connections_tenant_idx").on(t.tenantId),
    uniqueIndex("connections_tenant_provider_account_uq").on(
      t.tenantId,
      t.provider,
      t.externalAccountId,
    ),
  ],
);

export const channels = pgTable(
  "channels",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: channelTypeEnum("type").notNull(),
    identifier: text("identifier"),
    connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "set null" }),
    inboundConfig: jsonb("inbound_config"),
    publicKey: text("public_key"),
    consentRequired: boolean("consent_required").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("channels_tenant_idx").on(t.tenantId),
    uniqueIndex("channels_public_key_uq").on(t.publicKey),
  ],
);

// ---------------------------------------------------------------------------
// Contacts & conversations
// ---------------------------------------------------------------------------
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    notes: text("notes"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    messagingOptOut: boolean("messaging_opt_out").notNull().default(false),
    optOutAt: timestamp("opt_out_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_tenant_idx").on(t.tenantId),
    uniqueIndex("contacts_tenant_email_uq").on(t.tenantId, t.email),
    uniqueIndex("contacts_tenant_phone_uq").on(t.tenantId, t.phone),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    status: conversationStatusEnum("status").notNull().default("ai_handling"),
    subject: text("subject"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversations_tenant_idx").on(t.tenantId),
    index("conversations_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    role: messageRoleEnum("role").notNull(),
    body: text("body").notNull().default(""),
    providerMessageId: text("provider_message_id"),
    attachments: jsonb("attachments"),
    redacted: boolean("redacted").notNull().default(false),
    spamScore: integer("spam_score"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_tenant_idx").on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// Bookings & money (schema defined now; engine in Phase 4)
// ---------------------------------------------------------------------------
export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    status: bookingStatusEnum("status").notNull().default("proposed"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    tz: text("tz").notNull().default("Europe/London"),
    location: text("location"),
    calendarEventId: text("calendar_event_id"),
    calendarProvider: connectionProviderEnum("calendar_provider"),
    depositStatus: text("deposit_status"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_tenant_idx").on(t.tenantId),
    index("bookings_tenant_start_idx").on(t.tenantId, t.startAt),
    uniqueIndex("bookings_idempotency_uq").on(t.tenantId, t.idempotencyKey),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    amountPence: integer("amount_pence").notNull(),
    currency: text("currency").notNull().default("gbp"),
    type: paymentTypeEnum("type").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_tenant_idx").on(t.tenantId)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    channel: channelTypeEnum("channel").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    template: text("template"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reminders_send_at_idx").on(t.sendAt)],
);

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    channel: channelTypeEnum("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: text("status").notNull().default("scheduled"),
    reviewLink: text("review_link"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("review_requests_tenant_idx").on(t.tenantId)],
);

/**
 * Lead follow-up sequence: gentle nudges to an enquiry that hasn't booked yet.
 * System-scanned operational queue (like reminders) — the cron finds due items
 * across all tenants, so this table is intentionally not under tenant RLS
 * (see migration 0004). Every row still carries tenant_id.
 */
export const leadFollowups = pgTable(
  "lead_followups",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    channel: channelTypeEnum("channel").notNull(),
    step: integer("step").notNull().default(1),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    template: text("template"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lead_followups_send_at_idx").on(t.sendAt)],
);

/** Price quotes sent to a lead; tenant-scoped, owner-managed. */
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    amountPence: integer("amount_pence").notNull(),
    currency: text("currency").notNull().default("gbp"),
    status: quoteStatusEnum("status").notNull().default("draft"),
    channel: channelTypeEnum("channel"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("quotes_tenant_idx").on(t.tenantId)],
);

export const escalations = pgTable(
  "escalations",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    summary: text("summary"),
    status: escalationStatusEnum("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("escalations_tenant_idx").on(t.tenantId),
    index("escalations_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Observability: AI actions, audit log, webhook idempotency, rate limits
// ---------------------------------------------------------------------------
export const aiActions = pgTable(
  "ai_actions",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    toolName: text("tool_name").notNull(),
    input: jsonb("input"), // redacted
    output: jsonb("output"), // redacted
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    outcome: text("outcome"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_actions_tenant_idx").on(t.tenantId)],
);

/**
 * Append-only. The migration revokes UPDATE/DELETE from the app role so the
 * audit trail cannot be edited from application code.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    actor: text("actor").notNull(), // 'ai' | 'system' | user id
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"), // redacted
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_log_tenant_idx").on(t.tenantId), index("audit_log_at_idx").on(t.at)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status").notNull().default("received"),
  },
  (t) => [uniqueIndex("webhook_events_provider_event_uq").on(t.provider, t.providerEventId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_limits_key_window_uq").on(t.key, t.windowStart)],
);
