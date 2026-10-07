import { expect, it } from "vitest";
import { legacyVerificationHref, sessionPanelHref } from "./panel-href";

it("moves old verification bookmarks into sessions while retaining filters and window context", () => {
  const url = new URL(legacyVerificationHref({ tab: "verify", period: "2026-09", status: "short", page: "2", subject: "math", q: "학생", lang: "en", embed: "1" }), "https://test.invalid");
  expect(Object.fromEntries(url.searchParams)).toEqual({ tab: "sessions", period: "2026-09", status: "short", page: "2", subject: "math", q: "학생", lang: "en", embed: "1", panel: "verify" });
});
it("panel switches preserve student/subject/month and clear filters belonging to another panel", () => {
  const params = { tab: "sessions", panel: "verify", status: "over", page: "9", only: "open,share", confirmation: "open", allocation: "pending", q: "학생", subject: "english", embed: "1" };
  for (const panel of ["confirm", "verify"] as const) {
    const url = new URL(sessionPanelHref(params, "2026-10", panel), "https://test.invalid");
    expect(url.searchParams.get("tab")).toBe("sessions");
    expect(url.searchParams.get("period")).toBe("2026-10");
    expect(url.searchParams.get("subject")).toBe("english");
    expect(url.searchParams.get("q")).toBe("학생");
    expect(url.searchParams.get("embed")).toBe("1");
    for (const key of ["page", "status", "only", "confirmation", "allocation"]) expect(url.searchParams.has(key)).toBe(false);
    expect(url.searchParams.get("panel")).toBe(panel === "verify" ? "verify" : null);
  }
});
