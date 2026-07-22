import { TTS_VOICES } from "@webflowd/shared";
import { api, ApiError } from "./api.js";
import { field, h, toast } from "./dom.js";
import { env } from "./env.js";

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

// ---------------------------------------------------------------------------
// Calendar connections
// ---------------------------------------------------------------------------
interface Connection {
  id: string;
  provider: "google" | "microsoft" | string;
  externalAccountId: string | null;
  status: string;
}

function cleanQueryString(): void {
  window.history.replaceState({}, document.title, "/app/");
}

export function connectionsStep(): HTMLElement {
  const container = h("section", { class: "step" });

  // Surface the callback redirect result once, then clean the URL.
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected")) {
    toast(`Connected ${params.get("connected")}`);
    cleanQueryString();
  } else if (params.get("connect_error")) {
    toast(`Connection failed: ${params.get("connect_error")}`, "error");
    cleanQueryString();
  }

  const startConnect = async (provider: string) => {
    try {
      const { authorizationUrl } = await api.get<{ authorizationUrl: string }>(
        `/api/oauth/${provider}/start`,
      );
      window.location.href = authorizationUrl;
    } catch (err) {
      toast(errText(err), "error");
    }
  };

  const reload = () =>
    renderInto(container, async () => {
      const { connections } = await api.get<{ connections: Connection[] }>("/api/connections");
      const byProvider = new Map(
        connections.filter((c) => c.status !== "revoked").map((c) => [c.provider, c]),
      );

      const providerRow = (provider: string, label: string) => {
        const conn = byProvider.get(provider);
        if (conn && conn.status === "active") {
          return h("div", { class: "row" }, [
            h("span", {}, [
              `${label} — connected${conn.externalAccountId ? ` (${conn.externalAccountId})` : ""}`,
            ]),
            h(
              "button",
              {
                class: "link danger",
                onclick: async () => {
                  try {
                    await api.del(`/api/connections/${conn.id}`);
                    toast("Disconnected");
                    void reload();
                  } catch (err) {
                    toast(errText(err), "error");
                  }
                },
              },
              ["Disconnect"],
            ),
          ]);
        }
        const needsReauth = conn?.status === "needs_reauth";
        return h("div", { class: "row" }, [
          h("span", {}, [label, needsReauth ? " — reconnect needed" : ""]),
          h("button", { class: "primary", onclick: () => void startConnect(provider) }, [
            needsReauth ? "Reconnect" : "Connect",
          ]),
        ]);
      };

      return h("div", {}, [
        h("h2", {}, ["Calendar connections"]),
        h("p", { class: "muted" }, [
          "Connect a calendar so the assistant can check real availability and book jobs.",
        ]),
        providerRow("google", "Google Calendar"),
        providerRow("microsoft", "Microsoft Outlook"),
      ]);
    });

  void reload();
  return container;
}

// ---------------------------------------------------------------------------
// Test chat (talks to the public /api/chat widget endpoint)
// ---------------------------------------------------------------------------
interface ChatReply {
  reply: string;
  conversationId: string;
  escalated: boolean;
}

export function testChatStep(): HTMLElement {
  const container = h("section", { class: "step" });
  void renderInto(container, async () => {
    const { widgetPublicKey } = await api.get<{ widgetPublicKey: string }>("/api/me");
    let conversationId: string | undefined;

    const log = h("div", { class: "chat-log" });
    const input = h("input", {
      class: "input",
      placeholder: "Ask your assistant something…",
    }) as HTMLInputElement;

    const addBubble = (who: "you" | "ai", text: string) =>
      log.append(h("div", { class: `bubble ${who}` }, [text]));

    const send = async () => {
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      addBubble("you", message);
      log.scrollTop = log.scrollHeight;
      const thinking = h("div", { class: "bubble ai muted" }, ["…"]);
      log.append(thinking);
      try {
        const res = await fetch(`${env.apiBase}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicKey: widgetPublicKey, message, conversationId }),
        });
        const data = (await res.json()) as ChatReply & { error?: string };
        thinking.remove();
        if (!res.ok) {
          addBubble("ai", data.error ?? "Something went wrong.");
          return;
        }
        conversationId = data.conversationId;
        addBubble("ai", data.reply + (data.escalated ? "  (flagged for the team)" : ""));
      } catch (err) {
        thinking.remove();
        addBubble("ai", errText(err));
      }
      log.scrollTop = log.scrollHeight;
    };

    const form = h(
      "form",
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          void send();
        },
      },
      [
        h("div", { class: "chat-row" }, [
          input,
          h("button", { class: "primary", type: "submit" }, ["Send"]),
        ]),
      ],
    );

    return h("div", {}, [
      h("h2", {}, ["Test your assistant"]),
      h("p", { class: "muted" }, [
        "This is the same endpoint your website chat widget uses. Widget key: ",
        h("code", {}, [widgetPublicKey]),
      ]),
      log,
      form,
    ]);
  });
  return container;
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
interface Booking {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
  tz: string;
}

export function bookingsStep(): HTMLElement {
  const container = h("section", { class: "step" });
  const reload = () =>
    renderInto(container, async () => {
      const { bookings } = await api.get<{ bookings: Booking[] }>("/api/bookings");
      const rows = bookings.map((b) => {
        const when = new Date(b.startAt).toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/London",
        });
        const canCancel = ["proposed", "confirmed", "rescheduled"].includes(b.status);
        const canNoShow = ["confirmed", "rescheduled"].includes(b.status);
        const action = (label: string, body: unknown, done: string) =>
          h(
            "button",
            {
              class: "link danger",
              onclick: async () => {
                try {
                  await api.put(`/api/bookings/${b.id}`, body);
                  toast(done);
                  void reload();
                } catch (err) {
                  toast(errText(err), "error");
                }
              },
            },
            [label],
          );
        return h("li", { class: "row" }, [
          h("span", {}, [`${when} — `, h("strong", {}, [b.status])]),
          ...(canNoShow ? [action("No-show", { action: "no_show" }, "Marked as no-show")] : []),
          ...(canCancel ? [action("Cancel", { action: "cancel" }, "Booking cancelled")] : []),
        ]);
      });
      return h("div", {}, [
        h("h2", {}, ["Bookings"]),
        rows.length
          ? h("ul", { class: "list" }, rows)
          : h("p", { class: "muted" }, ["No bookings yet."]),
      ]);
    });
  void reload();
  return container;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
interface DashboardData {
  upcomingBookings: Array<{
    id: string;
    startAt: string;
    status: string;
    serviceName: string | null;
    contactName: string | null;
  }>;
  openEscalations: Array<{ id: string; reason: string; summary: string | null }>;
  connections: Array<{
    provider: string;
    status: string;
    lastSyncedAt: string | null;
    needsReauth: boolean;
  }>;
  recentActivity: Array<{ toolName: string; outcome: string | null; createdAt: string }>;
  counts: { upcoming: number; openEscalations: number; connectionsNeedingReauth: number };
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function dashboardStep(): HTMLElement {
  const container = h("section", { class: "step" });
  void renderInto(container, async () => {
    const d = await api.get<DashboardData>("/api/dashboard");

    const stat = (label: string, value: number, warn = false) =>
      h("div", { class: warn && value > 0 ? "stat warn" : "stat" }, [
        h("span", { class: "stat-value" }, [String(value)]),
        h("span", { class: "stat-label" }, [label]),
      ]);

    const upcoming = d.upcomingBookings.length
      ? h(
          "ul",
          { class: "list" },
          d.upcomingBookings.map((b) =>
            h("li", { class: "row" }, [
              h("span", {}, [
                `${whenLabel(b.startAt)} — `,
                h("strong", {}, [b.serviceName ?? "Appointment"]),
                ...(b.contactName ? [` · ${b.contactName}`] : []),
                ` (${b.status})`,
              ]),
            ]),
          ),
        )
      : h("p", { class: "muted" }, ["No upcoming jobs."]);

    const escalations = d.openEscalations.length
      ? h(
          "ul",
          { class: "list" },
          d.openEscalations.map((e) =>
            h("li", { class: "row" }, [
              h("span", {}, [
                h("strong", {}, [e.reason]),
                ...(e.summary ? [` — ${e.summary}`] : []),
              ]),
            ]),
          ),
        )
      : h("p", { class: "muted" }, ["Nothing needs your attention."]);

    const connections = d.connections.length
      ? h(
          "ul",
          { class: "list" },
          d.connections.map((c) =>
            h("li", { class: "row" }, [
              h("span", {}, [
                h("strong", {}, [c.provider]),
                ` — ${c.needsReauth ? "needs reconnect" : c.status}`,
                ...(c.lastSyncedAt ? [` · synced ${whenLabel(c.lastSyncedAt)}`] : []),
              ]),
            ]),
          ),
        )
      : h("p", { class: "muted" }, ["No connections yet."]);

    const activity = d.recentActivity.length
      ? h(
          "ul",
          { class: "list" },
          d.recentActivity.map((a) =>
            h("li", { class: "row" }, [
              h("span", {}, [
                h("strong", {}, [a.toolName]),
                ...(a.outcome ? [` — ${a.outcome}`] : []),
                ` · ${whenLabel(a.createdAt)}`,
              ]),
            ]),
          ),
        )
      : h("p", { class: "muted" }, ["No AI activity yet."]);

    return h("div", {}, [
      h("h2", {}, ["Dashboard"]),
      h("div", { class: "stats" }, [
        stat("Upcoming jobs", d.counts.upcoming),
        stat("Open escalations", d.counts.openEscalations, true),
        stat("Reconnect needed", d.counts.connectionsNeedingReauth, true),
      ]),
      h("h3", {}, ["Upcoming jobs"]),
      upcoming,
      h("h3", {}, ["Needs a human"]),
      escalations,
      h("h3", {}, ["Connection health"]),
      connections,
      h("h3", {}, ["Recent AI activity"]),
      activity,
    ]);
  });
  return container;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
interface Quote {
  id: string;
  description: string;
  amountPence: number;
  currency: string;
  status: string;
  sentAt: string | null;
}

export function quotesStep(): HTMLElement {
  const container = h("section", { class: "step" });
  const reload = () =>
    renderInto(container, async () => {
      const { quotes } = await api.get<{ quotes: Quote[] }>("/api/quotes");

      const rows = quotes.map((q) => {
        const amount = `£${(q.amountPence / 100).toFixed(2)}`;
        const canSend = q.status === "draft";
        const canClose = q.status === "sent";
        const act = (label: string, body: unknown, done: string) =>
          h(
            "button",
            {
              class: "link",
              onclick: async () => {
                try {
                  await api.patch(`/api/quotes/${q.id}`, body);
                  toast(done);
                  void reload();
                } catch (err) {
                  toast(errText(err), "error");
                }
              },
            },
            [label],
          );
        return h("li", { class: "row" }, [
          h("span", {}, [`${amount} — ${q.description} · `, h("strong", {}, [q.status])]),
          ...(canSend ? [act("Send", { action: "send" }, "Quote sent")] : []),
          ...(canClose
            ? [
                act("Accepted", { action: "status", status: "accepted" }, "Marked accepted"),
                act("Declined", { action: "status", status: "declined" }, "Marked declined"),
              ]
            : []),
        ]);
      });

      const contactId = input("contactId");
      const description = input("description");
      const amount = input("amount", "", "number");
      const send = h("input", { type: "checkbox", name: "send" });

      const form = h(
        "form",
        {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              await api.post("/api/quotes", {
                contactId: contactId.value.trim() || undefined,
                description: description.value.trim(),
                amountPence: Math.round(Number(amount.value) * 100),
                send: send.checked,
              });
              toast(send.checked ? "Quote created and sent" : "Quote created");
              void reload();
            } catch (err) {
              toast(errText(err), "error");
            }
          },
        },
        [
          field("Contact ID (optional)", contactId, "Attach the quote to an existing contact."),
          field("Description *", description, "e.g. Full bathroom re-plumb"),
          field("Amount (£) *", amount),
          h("label", { class: "field inline" }, [send, h("span", {}, ["Send immediately"])]),
          h("button", { class: "primary", type: "submit" }, ["Create quote"]),
        ],
      );

      return h("div", {}, [
        h("h2", {}, ["Quotes"]),
        rows.length
          ? h("ul", { class: "list" }, rows)
          : h("p", { class: "muted" }, ["No quotes yet."]),
        form,
      ]);
    });
  void reload();
  return container;
}

// ---------------------------------------------------------------------------
// Phone (voice receptionist)
// ---------------------------------------------------------------------------
interface PhoneSettings {
  configured: boolean;
  number?: string;
  enabled?: boolean;
  greeting?: string;
  voice?: string;
  language?: string;
  speechTimeoutSec?: number | null;
}

const VOICE_INBOUND_PATH = "/webhooks/twilio/voice-inbound";
const VOICE_STATUS_PATH = "/webhooks/twilio/voice";
const VOICE_RECORDING_PATH = "/webhooks/twilio/recording";

function copyRow(label: string, url: string): HTMLElement {
  const value = h("code", { class: "copy-url" }, [url]);
  const btn = h(
    "button",
    {
      type: "button",
      class: "link",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("Copied");
        } catch {
          toast("Copy failed — select and copy manually", "error");
        }
      },
    },
    ["Copy"],
  );
  return h("div", { class: "url-row" }, [h("span", { class: "muted" }, [label]), value, btn]);
}

function tutorial(origin: string): HTMLElement {
  const steps: Array<[string, Node[]]> = [
    [
      "Get a phone number",
      [
        document.createTextNode(
          "In the Twilio Console, buy a phone number with Voice capability (Phone Numbers → Buy a number), or use one you already own.",
        ),
      ],
    ],
    [
      "Save your number here",
      [
        document.createTextNode(
          "Enter that number below in E.164 format (e.g. +441234567890) and click Save. This links the number to your account.",
        ),
      ],
    ],
    [
      "Point Twilio at the receptionist",
      [
        document.createTextNode(
          "In Twilio: Phone Numbers → Manage → your number → Voice Configuration. Under “A call comes in”, choose Webhook, set HTTP POST, and paste:",
        ),
        copyRow("A call comes in (POST)", origin + VOICE_INBOUND_PATH),
      ],
    ],
    [
      "Optional — missed-call text-back",
      [
        document.createTextNode(
          "Under “Call status changes”, paste the status URL (POST). If a call goes unanswered we'll automatically text the caller back.",
        ),
        copyRow("Call status changes (POST)", origin + VOICE_STATUS_PATH),
        copyRow("Voicemail recording (POST)", origin + VOICE_RECORDING_PATH),
      ],
    ],
    [
      "Add your Twilio keys (one-time)",
      [
        document.createTextNode(
          "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM in your Netlify environment variables. The auth token is what verifies each call is really from Twilio.",
        ),
      ],
    ],
    [
      "Call it and tune",
      [
        document.createTextNode(
          "Ring your number to test. Then adjust the greeting, voice and pause length below and Save — changes apply on the next call, no redeploy needed.",
        ),
      ],
    ],
  ];
  return h(
    "ol",
    { class: "tutorial" },
    steps.map(([t, body]) =>
      h("li", {}, [h("strong", {}, [t]), h("div", { class: "tutorial-body" }, body)]),
    ),
  );
}

export function phoneStep(): HTMLElement {
  const container = h("section", { class: "step" });
  const origin = window.location.origin;
  const reload = () =>
    renderInto(container, async () => {
      const s = await api.get<PhoneSettings>("/api/phone");

      const number = input("number", s.number ?? "", "tel");
      const greeting = textarea("greeting", s.greeting ?? "");
      const enabled = h("input", { type: "checkbox", name: "enabled" }) as HTMLInputElement;
      enabled.checked = s.enabled ?? true;

      const voice = h("select", { name: "voice", class: "input" }, [
        ...TTS_VOICES.map((v) =>
          h("option", { value: v, ...(s.voice === v ? { selected: "selected" } : {}) }, [v]),
        ),
      ]) as HTMLSelectElement;
      const language = input("language", s.language ?? "en-GB");
      const speechTimeout = input(
        "speechTimeoutSec",
        s.speechTimeoutSec != null ? String(s.speechTimeoutSec) : "",
        "number",
      );

      const form = h(
        "form",
        {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const t = speechTimeout.value.trim();
            try {
              await api.put("/api/phone", {
                number: number.value.trim(),
                enabled: enabled.checked,
                greeting: greeting.value.trim() || undefined,
                voice: voice.value,
                language: language.value.trim() || "en-GB",
                speechTimeoutSec: t ? Number(t) : null,
              });
              toast("Phone settings saved");
              void reload();
            } catch (err) {
              toast(errText(err), "error");
            }
          },
        },
        [
          field("Your phone number *", number, "E.164 format, e.g. +441234567890."),
          field(
            "Greeting",
            greeting,
            "What the assistant says when it answers. Leave blank for a default.",
          ),
          field("Voice", voice, "The text-to-speech voice callers hear."),
          field("Language", language, "BCP-47 tag Twilio uses for speech, e.g. en-GB."),
          field(
            "Pause before replying (seconds)",
            speechTimeout,
            "Blank = adaptive ‘auto’. Try 1–2 if it cuts callers off.",
          ),
          h("label", { class: "field inline" }, [enabled, h("span", {}, ["Receptionist enabled"])]),
          h("button", { class: "primary", type: "submit" }, ["Save phone settings"]),
        ],
      );

      return h("div", {}, [
        h("h2", {}, ["Phone receptionist"]),
        h("p", { class: "muted" }, [
          s.configured
            ? `Answering calls to ${s.number}.`
            : "Not set up yet. Follow the steps below to have the AI answer your phone.",
        ]),
        h("h3", {}, ["Step-by-step setup"]),
        tutorial(origin),
        h("h3", {}, ["Settings"]),
        form,
      ]);
    });
  void reload();
  return container;
}

export const STEPS = [
  { id: "dashboard", label: "Dashboard", render: dashboardStep },
  { id: "profile", label: "Profile", render: profileStep },
  { id: "services", label: "Services", render: servicesStep },
  { id: "hours", label: "Hours", render: hoursStep },
  { id: "rules", label: "Booking rules", render: bookingRulesStep },
  { id: "knowledge", label: "Knowledge", render: knowledgeStep },
  { id: "connections", label: "Connections", render: connectionsStep },
  { id: "chat", label: "Test chat", render: testChatStep },
  { id: "bookings", label: "Bookings", render: bookingsStep },
  { id: "quotes", label: "Quotes", render: quotesStep },
  { id: "phone", label: "Phone", render: phoneStep },
] as const;
