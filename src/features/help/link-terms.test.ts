import { describe, expect, it } from "vitest";
import { tokenizeHelp } from "./link-terms";
import { HELP_TERMS } from "./terms";
import { HELP_SLUGS, MANUALS } from "./manuals";

describe("도움말 용어 연결", () => {
  it("본문의 화면 이름을 하이라이트 토큰으로 자른다 — 긴 말이 먼저다", () => {
    const tokens = tokenizeHelp("원생의 시간표를 확인할 수 있습니다.");
    const terms = tokens.filter((t) => t.type === "term");
    expect(terms.map((t) => (t.type === "term" ? t.label : ""))).toEqual(["원생", "시간표"]);
    expect(terms.map((t) => (t.type === "term" ? t.slug : ""))).toEqual(["students", "timetable"]);
  });

  it("원생상담이 원생보다 먼저다", () => {
    const tokens = tokenizeHelp("원생상담 기록을 엽니다.");
    const terms = tokens.filter((t) => t.type === "term");
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ slug: "consultations", label: "원생상담" });
  });

  it("[[slug|표시]]가 자동 연결보다 앞선다", () => {
    const tokens = tokenizeHelp("자세한 번호는 [[attendance-live|오늘 출결]] 설명서.");
    expect(tokens.some((t) => t.type === "term" && t.slug === "attendance-live" && t.label === "오늘 출결")).toBe(
      true,
    );
  });

  it("지금 보고 있는 화면 이름은 current 표시 — 눌러 순환하지 않게", () => {
    const tokens = tokenizeHelp("시간표에서 옮깁니다.", "timetable");
    const t = tokens.find((x) => x.type === "term" && x.slug === "timetable");
    expect(t).toMatchObject({ current: true });
  });

  it("열 수 없는 화면은 토큰이 아니라 글자다", () => {
    const tokens = tokenizeHelp("학원 설정에서 과목을 정합니다.", undefined, new Set(["timetable"]));
    expect(tokens.every((t) => t.type === "text")).toBe(true);
    expect(tokens.map((t) => (t.type === "text" ? t.value : "")).join("")).toBe(
      "학원 설정에서 과목을 정합니다.",
    );
  });

  it("🔴 낱말 중간은 잇지 않는다 — '재원생'이 재 + [원생]으로 갈리던 것", () => {
    for (const s of ["기존 재원생이면 그대로 씁니다.", "퇴원생은 그 달에 셉니다."]) {
      const tokens = tokenizeHelp(s);
      expect(
        tokens.every((t) => t.type === "text"),
        s,
      ).toBe(true);
      expect(tokens.map((t) => (t.type === "text" ? t.value : "")).join(""), s).toBe(s);
    }
  });

  it("낱말이 제대로 서면 그대로 잇는다 — 앞 경계만 본다(조사는 막지 않는다)", () => {
    for (const s of ["원생 명단을 봅니다.", "원생을 찾습니다.", "그 원생은 재원입니다."]) {
      const tokens = tokenizeHelp(s);
      expect(
        tokens.some((t) => t.type === "term" && t.slug === "students"),
        s,
      ).toBe(true);
    }
  });
});

describe("설명서 카탈로그", () => {
  it("슬러그는 유일하고, 용어가 가리키는 설명서가 있다", () => {
    expect(new Set(HELP_SLUGS).size).toBe(HELP_SLUGS.length);
    for (const term of HELP_TERMS) {
      expect(HELP_SLUGS, term.pattern).toContain(term.slug);
    }
  });

  it("번호는 설명서마다 겹치지 않고 1부터다", () => {
    for (const m of MANUALS) {
      const nums = m.callouts.map((c) => c.n);
      expect(nums, m.slug).toEqual([...nums].sort((a, b) => a - b));
      expect(new Set(nums).size, m.slug).toBe(nums.length);
      if (nums.length > 0) expect(nums[0], m.slug).toBe(1);
      for (const face of m.faces ?? []) {
        const fn = face.callouts.map((c) => c.n);
        expect(new Set(fn).size, `${m.slug}/${face.title}`).toBe(fn.length);
      }
    }
  });

  it("관련 설명서 슬러그가 실재한다", () => {
    const slugs = new Set(HELP_SLUGS);
    for (const m of MANUALS) {
      for (const r of m.related) expect(slugs, `${m.slug} → ${r}`).toContain(r);
    }
  });
});
