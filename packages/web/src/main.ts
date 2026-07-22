import { api } from "./api.js";
import { getAuth0, handleRedirectIfPresent, isAuthenticated, login, logout } from "./auth.js";
import { h, mount } from "./dom.js";
import { assertConfigured } from "./env.js";
import { STEPS } from "./steps.js";

interface Me {
  user: { id: string; email: string; role: string };
  tenantId: string;
  onboarding: Record<string, boolean>;
}

const root = document.getElementById("app")!;

function loginView(message?: string): void {
  mount(
    root,
    h("main", { class: "centered" }, [
      h("h1", {}, ["Webflow'd Assistant"]),
      h("p", { class: "muted" }, ["Sign in to set up your AI receptionist."]),
      ...(message ? [h("p", { class: "error" }, [message])] : []),
      h("button", { class: "primary", onclick: () => void login() }, ["Sign in"]),
    ]),
  );
}

function appView(me: Me): void {
  const content = h("section", { class: "content" });

  const tabs = STEPS.map((step) => {
    const done = me.onboarding[step.id];
    return h(
      "button",
      {
        class: "tab",
        "data-step": step.id,
        onclick: () => selectStep(step.id),
      },
      [step.label, ...(done ? [h("span", { class: "badge" }, ["✓"])] : [])],
    );
  });

  function selectStep(id: string): void {
    for (const t of tabs) t.classList.toggle("active", t.getAttribute("data-step") === id);
    const step = STEPS.find((s) => s.id === id)!;
    content.replaceChildren(step.render());
  }

  mount(
    root,
    h("header", { class: "app-header" }, [
      h("strong", {}, ["Webflow'd Assistant"]),
      h("span", { class: "spacer" }),
      h("span", { class: "muted" }, [me.user.email]),
      h("button", { class: "link", onclick: () => void logout() }, ["Sign out"]),
    ]),
    h("nav", { class: "tabs" }, tabs),
    content,
  );

  selectStep(STEPS[0]!.id);
}

async function bootstrap(): Promise<void> {
  try {
    assertConfigured();
  } catch (err) {
    loginView((err as Error).message);
    return;
  }

  try {
    await getAuth0();
    await handleRedirectIfPresent();

    if (!(await isAuthenticated())) {
      loginView();
      return;
    }

    const me = await api.get<Me>("/api/me");
    appView(me);
  } catch (err) {
    loginView(`Could not start: ${(err as Error).message}`);
  }
}

void bootstrap();
