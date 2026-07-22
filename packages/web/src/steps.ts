import { api, ApiError } from "./api.js";
import { field, h, toast } from "./dom.js";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function errText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.issues?.length) return err.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    return err.message;
  }
  return (err as Error).message ?? "Something went wrong";
}

function input(name: string, value = "", type = "text"): HTMLInputElement {
  return h("input", { name, value, type, class: "input" });
}
function textarea(name: string, value = ""): HTMLTextAreaElement {
  const t = h("textarea", { name, class: "input", rows: 3 });
  t.value = value;
  return t;
}

async function renderInto(container: HTMLElement, build: () => Promise<Node>): Promise<void> {
  container.replaceChildren(h("p", { class: "loading" }, ["Loading…"]));
  try {
    container.replaceChildren(await build());
  } catch (err) {
    container.replaceChildren(h("p", { class: "error" }, [errText(err)]));
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export function profileStep(): HTMLElement {
  const container = h("section", { class: "step" });
  void renderInto(container, async () => {
    const { profile } = await api.get<{ profile: Record<string, string> | null }>("/api/profile");
    const p = profile ?? {};
    const displayName = input("displayName", p.displayName ?? "");
    const trade = input("trade", p.trade ?? "");
    const phone = input("phone", p.phone ?? "", "tel");
    const replyEmail = input("replyEmail", p.replyEmail ?? "", "email");
    const address = textarea("address", p.address ?? "");
    const about = textarea("about", p.about ?? "");
    const tone = textarea("tone", p.tone ?? "");
    const pricingNotes = textarea("pricingNotes", p.pricingNotes ?? "");
    const bookingPolicyText = textarea("bookingPolicyText", p.bookingPolicyText ?? "");

    const form = h(
      "form",
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const payload = {
            displayName: displayName.value.trim(),
            trade: trade.value.trim() || undefined,
            phone: phone.value.trim() || undefined,
            replyEmail: replyEmail.value.trim() || undefined,
            address: address.value.trim() || undefined,
            about: about.value.trim() || undefined,
            tone: tone.value.trim() || undefined,
            pricingNotes: pricingNotes.value.trim() || undefined,
            bookingPolicyText: bookingPolicyText.value.trim() || undefined,
          };
          try {
            await api.put("/api/profile", payload);
            toast("Profile saved");
          } catch (err) {
            toast(errText(err), "error");
          }
        },
      },
      [
        field("Business name *", displayName),
        field("Trade", trade, "e.g. Plumbing, Electrical, Roofing"),
        field("Public phone", phone),
        field("Reply-to email", replyEmail),
        field("Address", address),
        field("About the business", about, "Used by the assistant to answer questions."),
        field("Brand voice / tone", tone, "e.g. Friendly, plain-spoken, no jargon."),
        field("Pricing notes", pricingNotes, "The assistant will never quote beyond this."),
        field("Booking / cancellation policy", bookingPolicyText),
        h("button", { class: "primary", type: "submit" }, ["Save profile"]),
      ],
    );
    return h("div", {}, [h("h2", {}, ["Business profile"]), form]);
  });
  return container;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
interface Service {
  id: string;
  name: string;
  defaultDurationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  priceNote?: string;
  depositRequired: boolean;
  active: boolean;
}

export function servicesStep(): HTMLElement {
  const container = h("section", { class: "step" });
  const reload = () =>
    renderInto(container, async () => {
      const { services } = await api.get<{ services: Service[] }>("/api/services");

      const rows = services.map((s) =>
        h("li", { class: "row" }, [
          h("span", {}, [
            `${s.name} — ${s.defaultDurationMin} min`,
            s.depositRequired ? " · deposit" : "",
            s.active ? "" : " · inactive",
          ]),
          h(
            "button",
            {
              class: "link danger",
              onclick: async () => {
                try {
                  await api.del(`/api/services/${s.id}`);
                  toast("Service removed");
                  void reload();
                } catch (err) {
                  toast(errText(err), "error");
                }
              },
            },
            ["Delete"],
          ),
        ]),
      );

      const name = input("name");
      const duration = input("defaultDurationMin", "60", "number");
      const bufBefore = input("bufferBeforeMin", "0", "number");
      const bufAfter = input("bufferAfterMin", "0", "number");
      const priceNote = input("priceNote");
      const deposit = h("input", { type: "checkbox", name: "depositRequired" });

      const form = h(
        "form",
        {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              await api.post("/api/services", {
                name: name.value.trim(),
                defaultDurationMin: Number(duration.value),
                bufferBeforeMin: Number(bufBefore.value),
                bufferAfterMin: Number(bufAfter.value),
                priceNote: priceNote.value.trim() || undefined,
                depositRequired: deposit.checked,
                depositAmountPence: deposit.checked ? 5000 : undefined,
              });
              toast("Service added");
              void reload();
            } catch (err) {
              toast(errText(err), "error");
            }
          },
        },
        [
          field("Service name *", name),
          field("Default duration (min) *", duration),
          field("Buffer before (min)", bufBefore),
          field("Buffer after (min)", bufAfter),
          field("Price note", priceNote),
          h("label", { class: "field inline" }, [deposit, h("span", {}, ["Requires a deposit"])]),
          h("button", { class: "primary", type: "submit" }, ["Add service"]),
        ],
      );

      return h("div", {}, [
        h("h2", {}, ["Services"]),
        rows.length
          ? h("ul", { class: "list" }, rows)
          : h("p", { class: "muted" }, ["No services yet."]),
        form,
      ]);
    });
  void reload();
  return container;
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------
interface Hour {
  weekday: number;
  closed: boolean;
  open: string | null;
  close: string | null;
}

export function hoursStep(): HTMLElement {
  const container = h("section", { class: "step" });
  void renderInto(container, async () => {
    const { hours } = await api.get<{ hours: Hour[] }>("/api/hours");
    const byDay = new Map(hours.map((hh) => [hh.weekday, hh]));

    const rowControls = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
      const existing = byDay.get(wd);
      const closed = h("input", { type: "checkbox", name: `closed-${wd}` }) as HTMLInputElement;
      closed.checked = existing?.closed ?? (wd === 0 || wd === 6);
      const open = input(`open-${wd}`, existing?.open ?? "08:00", "time");
      const close = input(`close-${wd}`, existing?.close ?? "17:00", "time");
      return h("div", { class: "hours-row" }, [
        h("span", { class: "day" }, [WEEKDAY_NAMES[wd]!]),
        h("label", { class: "inline" }, [closed, h("span", {}, ["Closed"])]),
        open,
        close,
      ]);
    });

    const form = h(
      "form",
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const rows = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
            const isClosed = (container.querySelector(`[name="closed-${wd}"]`) as HTMLInputElement)
              .checked;
            const open = (container.querySelector(`[name="open-${wd}"]`) as HTMLInputElement).value;
            const close = (container.querySelector(`[name="close-${wd}"]`) as HTMLInputElement)
              .value;
            return isClosed
              ? { weekday: wd, closed: true }
              : { weekday: wd, closed: false, open, close };
          });
          try {
            await api.put("/api/hours", rows);
            toast("Hours saved");
          } catch (err) {
            toast(errText(err), "error");
          }
        },
      },
      [...rowControls, h("button", { class: "primary", type: "submit" }, ["Save hours"])],
    );

    return h("div", {}, [h("h2", {}, ["Opening hours"]), form]);
  });
  return container;
}

// ---------------------------------------------------------------------------
// Booking rules
// ---------------------------------------------------------------------------
interface BookingRules {
  minNoticeMin: number;
  maxAdvanceDays: number;
  defaultBufferMin: number;
  slotGranularityMin: number;
  maxJobsPerDay: number;
  autoConfirm: boolean;
}

export function bookingRulesStep(): HTMLElement {
  const container = h("section", { class: "step" });
  void renderInto(container, async () => {
    const { bookingRules } = await api.get<{ bookingRules: BookingRules | null }>(
      "/api/booking-rules",
    );
    const r = bookingRules ?? {
      minNoticeMin: 120,
      maxAdvanceDays: 60,
      defaultBufferMin: 0,
      slotGranularityMin: 30,
      maxJobsPerDay: 0,
      autoConfirm: true,
    };
    const minNotice = input("minNoticeMin", String(r.minNoticeMin), "number");
    const maxAdvance = input("maxAdvanceDays", String(r.maxAdvanceDays), "number");
    const defBuffer = input("defaultBufferMin", String(r.defaultBufferMin), "number");
    const granularity = input("slotGranularityMin", String(r.slotGranularityMin), "number");
    const maxJobs = input("maxJobsPerDay", String(r.maxJobsPerDay), "number");
    const autoConfirm = h("input", { type: "checkbox", name: "autoConfirm" }) as HTMLInputElement;
    autoConfirm.checked = r.autoConfirm;

    const form = h(
      "form",
      {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            await api.put("/api/booking-rules", {
              minNoticeMin: Number(minNotice.value),
              maxAdvanceDays: Number(maxAdvance.value),
              defaultBufferMin: Number(defBuffer.value),
              slotGranularityMin: Number(granularity.value),
              maxJobsPerDay: Number(maxJobs.value),
              autoConfirm: autoConfirm.checked,
            });
            toast("Booking rules saved");
          } catch (err) {
            toast(errText(err), "error");
          }
        },
      },
      [
        field("Minimum notice (minutes)", minNotice),
        field("Book up to (days ahead)", maxAdvance),
        field("Default buffer (minutes)", defBuffer),
        field("Slot granularity (minutes)", granularity, "5, 10, 15, 20, 30 or 60"),
        field("Max jobs per day (0 = unlimited)", maxJobs),
        h("label", { class: "field inline" }, [
          autoConfirm,
          h("span", {}, ["Auto-confirm bookings within rules"]),
        ]),
        h("button", { class: "primary", type: "submit" }, ["Save booking rules"]),
      ],
    );
    return h("div", {}, [h("h2", {}, ["Booking rules"]), form]);
  });
  return container;
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------
interface KnowledgeItem {
  id: string;
  question: string;
  answer: string;
  tags: string[];
}

export function knowledgeStep(): HTMLElement {
  const container = h("section", { class: "step" });
  const reload = () =>
    renderInto(container, async () => {
      const { knowledge } = await api.get<{ knowledge: KnowledgeItem[] }>("/api/knowledge");
      const rows = knowledge.map((k) =>
        h("li", { class: "row" }, [
          h("div", {}, [h("strong", {}, [k.question]), h("p", { class: "muted" }, [k.answer])]),
          h(
            "button",
            {
              class: "link danger",
              onclick: async () => {
                try {
                  await api.del(`/api/knowledge/${k.id}`);
                  toast("Removed");
                  void reload();
                } catch (err) {
                  toast(errText(err), "error");
                }
              },
            },
            ["Delete"],
          ),
        ]),
      );

      const question = input("question");
      const answer = textarea("answer");
      const tags = input("tags", "", "text");

      const form = h(
        "form",
        {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              await api.post("/api/knowledge", {
                question: question.value.trim(),
                answer: answer.value.trim(),
                tags: tags.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              });
              toast("Added to knowledge base");
              void reload();
            } catch (err) {
              toast(errText(err), "error");
            }
          },
        },
        [
          field("Question *", question),
          field("Answer *", answer),
          field("Tags", tags, "Comma-separated, optional"),
          h("button", { class: "primary", type: "submit" }, ["Add entry"]),
        ],
      );

      return h("div", {}, [
        h("h2", {}, ["Knowledge base / FAQ"]),
        rows.length
          ? h("ul", { class: "list" }, rows)
          : h("p", { class: "muted" }, ["No entries yet."]),
        form,
      ]);
    });
  void reload();
  return container;
}

export const STEPS = [
  { id: "profile", label: "Profile", render: profileStep },
  { id: "services", label: "Services", render: servicesStep },
  { id: "hours", label: "Hours", render: hoursStep },
  { id: "rules", label: "Booking rules", render: bookingRulesStep },
  { id: "knowledge", label: "Knowledge", render: knowledgeStep },
] as const;
