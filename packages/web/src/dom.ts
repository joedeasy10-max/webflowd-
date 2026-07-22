/** Minimal DOM helpers — no framework, to match the static marketing site. */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "value" && "value" in el) {
      (el as HTMLInputElement).value = String(value);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function mount(root: HTMLElement, ...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}

export function field(
  label: string,
  input: HTMLElement,
  hint?: string,
): HTMLElement {
  return h("label", { class: "field" }, [
    h("span", { class: "field-label" }, [label]),
    input,
    ...(hint ? [h("small", { class: "field-hint" }, [hint])] : []),
  ]);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(message: string, kind: "ok" | "error" = "ok"): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast" });
    document.body.append(el);
  }
  el.className = kind;
  el.textContent = message;
  el.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el!.style.opacity = "0";
  }, 3000);
}
