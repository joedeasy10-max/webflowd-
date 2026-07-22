import { describe, expect, it } from "vitest";
import { classifySpam } from "./spam.js";

describe("classifySpam", () => {
  it("flags empty and auto-reply messages", () => {
    expect(classifySpam("").isSpam).toBe(true);
    expect(classifySpam("This is an automatic reply — I am out of office.").isSpam).toBe(true);
  });

  it("flags obvious spam keywords and link floods", () => {
    expect(classifySpam("Cheap SEO services, guaranteed ranking").isSpam).toBe(true);
    expect(classifySpam("http://a http://b http://c http://d http://e buy now").isSpam).toBe(true);
  });

  it("passes a normal enquiry", () => {
    const v = classifySpam("Hi, my boiler is leaking — can someone come out tomorrow?");
    expect(v.isSpam).toBe(false);
    expect(v.score).toBeLessThan(70);
  });
});
