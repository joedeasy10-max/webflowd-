import {
  getBookingRules,
  getHours,
  getProfile,
  listKnowledge,
  listServices,
  type TenantContext,
  type TenantPromptData,
} from "@webflowd/core";

/** Load the tenant's profile/services/hours/rules/knowledge for the AI prompt. */
export async function loadTenantData(
  ctx: TenantContext,
  tx: Parameters<typeof getProfile>[1],
): Promise<TenantPromptData> {
  const [profile, services, hours, bookingRules, knowledge] = [
    await getProfile(ctx, tx),
    await listServices(ctx, tx),
    await getHours(ctx, tx),
    await getBookingRules(ctx, tx),
    await listKnowledge(ctx, tx),
  ];
  return {
    profile: profile
      ? {
          displayName: profile.displayName,
          trade: profile.trade,
          phone: profile.phone,
          address: profile.address,
          about: profile.about,
          tone: profile.tone,
          pricingNotes: profile.pricingNotes,
          bookingPolicyText: profile.bookingPolicyText,
        }
      : null,
    services: services.map((s) => ({
      name: s.name,
      description: s.description,
      defaultDurationMin: s.defaultDurationMin,
      priceNote: s.priceNote,
      depositRequired: s.depositRequired,
    })),
    hours: hours.map((h) => ({
      weekday: h.weekday,
      closed: h.closed,
      open: h.open,
      close: h.close,
    })),
    bookingRules: bookingRules
      ? { minNoticeMin: bookingRules.minNoticeMin, maxAdvanceDays: bookingRules.maxAdvanceDays }
      : null,
    knowledge: knowledge
      .filter((k) => k.active)
      .map((k) => ({ question: k.question, answer: k.answer })),
  };
}
