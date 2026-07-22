/** Shared enums used across DB, API, and UI. Keep in sync with the Drizzle schema. */

export const USER_ROLES = ["owner", "staff", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CHANNEL_TYPES = [
  "email",
  "chat",
  "sms",
  "whatsapp",
  "voice",
  "web_form",
  "google_business",
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CONNECTION_PROVIDERS = [
  "google",
  "microsoft",
  "gmail",
  "sendgrid",
  "twilio",
  "google_business",
  "stripe",
] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export const CONVERSATION_STATUSES = [
  "ai_handling",
  "needs_human",
  "resolved",
  "spam",
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const BOOKING_STATUSES = [
  "proposed",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_ROLES = ["customer", "ai", "owner", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Actions recorded in the audit log. Append new values; never repurpose. */
export const AUDIT_ACTIONS = [
  "tenant.provisioned",
  "profile.updated",
  "service.created",
  "service.updated",
  "service.deleted",
  "hours.updated",
  "booking_rules.updated",
  "knowledge.created",
  "knowledge.updated",
  "knowledge.deleted",
  "connection.created",
  "connection.revoked",
  "message.received",
  "reply.sent",
  "booking.created",
  "booking.rescheduled",
  "booking.cancelled",
  "booking.no_show",
  "escalation.opened",
  "escalation.resolved",
  "ai.tool_invoked",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const DEFAULT_TIMEZONE = "Europe/London";
