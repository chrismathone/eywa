import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IJW_SCHEMAS } from "./contract";
import { parseJjSnapshot, slotAvailability, snapshotFromDay } from "./snapshot";
import { badgeGradeLabel, compareText, groupDigits } from "./components/jj-standing";
import { TemplateBody } from "@/features/onescreen/components/report-template-body";
import { BUILTIN_JJ_SHEET_TEMPLATE, ENGLISH_TEMPLATE_TOKEN_KEYS, TEMPLATE_DECORATION_TOKENS } from "@/features/report-templates/defaults";
import { fillReportTemplate } from "@/features/report-templates/fill";
import { englishTemplateValues } from "@/features/report-templates/values";

/** 단어 순위·학습 배지(원장 2026-10-26) — 인재원 하루치의 선택 필드 `standing`. */

const STUDY = {
  student: { id: "jdw", name: "jdw", className: null },
  from: "2026-09-27",
  to: "2026-10-26",
  totals: { answers: 30, correct: 20, accuracy: 67, studyMs: 60000, newWords: 3, activeDays: 4 },
  longTermWords: 560,
  seenWords: 1234,
  daily: [],
  byDeck: [],
  byPos: [],
  weak: [],
  exams: [],
};

const STANDING = {
  basis: "기본모드(주관식 단어장) 기준",
  at: "2026-10-26T06:00:00.000Z",
  seenWords: { value: 1234, grade: { label: "중2", rank: 3, of: 41, topPct: 7.3 }, class: { label: "A반", rank: 1, of: 9, topPct: 11.1 } },
  longTermWords: { value: 560, grade: { label: "중2", rank: 10, of: 41, topPct: 24.4 }, class: null },
  // 인재원 실제 모양(2026-10-26 anki-main 5b40b6a) — 이름에 '과정 통과'까지 붙고 code가 더 온다.
  badge: { grade: 6, label: "중1 과정 통과", code: "M1", imageUrl: "https://injaewon.vercel.app/img/level/M1.webp" },
};

const day = (standing?: unknown) =>
  IJW_SCHEMAS.day.parse({ v: 1, ijwId: "jdw", name: "jdw", date: "2026-10-26", exams: [], study: STUDY, ...(standing === undefined ? {} : { standing }) });

describe("계약 · 저장본", () => {
  it("실려 오면 그대로 읽고, 저장본에도 묶인다", () => {
    const d = day(STANDING);
    expect(d.standing?.seenWords?.grade?.rank).toBe(3);
    const snap = snapshotFromDay(d, "2026-10-26T06:00:00.000Z");
    expect(snap.standing?.badge?.label).toBe("중1 과정 통과");
    expect(parseJjSnapshot(JSON.parse(JSON.stringify(snap)))?.standing?.longTermWords?.value).toBe(560);
  });

  it("🔴 안 실려 오거나 모양이 어긋나도 하루치는 산다(그 자리만 빈다)", () => {
    expect(day().standing).toBeUndefined();
    // 어긋난 칸 하나만 비운다(나머지 칸·하루치는 산다).
    expect(day({ basis: "x", seenWords: "이상한 값" }).standing?.seenWords).toBeNull();
    expect(day({ basis: 3, at: [] }).standing).toMatchObject({ basis: "", at: "" });
    expect(day({ ...STANDING, badge: { grade: "?" } }).standing?.badge).toBeNull();
    const old = snapshotFromDay(day(), "t");
    expect("standing" in old).toBe(false); // 옛 저장본과 같은 모양
    expect(parseJjSnapshot({ ...old, standing: { nope: 1 } })).not.toBeNull();
  });

  it("자리 가용성 — 비교가 있어야 백분위, 배지가 있어야 배지", () => {
    expect(slotAvailability(snapshotFromDay(day(STANDING), "t"))).toMatchObject({ 단어백분위: true, 학습배지: true });
    const bare = { ...STANDING, seenWords: { value: 5, grade: null, class: null }, longTermWords: null, badge: null };
    expect(slotAvailability(snapshotFromDay(day(bare), "t"))).toMatchObject({ 단어백분위: false, 학습배지: false });
    expect(slotAvailability(null)).toMatchObject({ 단어백분위: false, 학습배지: false });
  });
});

describe("문구", () => {
  it("백분위 = 100 − 상위 %(반올림, 상위 0%는 1%로) · 꼴찌는 0 · 자릿수 쉼표는 로캘과 무관", () => {
    expect(compareText({ label: "중2", rank: 3, of: 41, topPct: 7.3 }, "학년")).toMatchObject({ label: "중2 학년 백분위", value: "93", sub: "41명 중 3등", fill: 93 });
    expect(compareText({ label: "", rank: 1, of: 300, topPct: 0.2 }, "학년")).toMatchObject({ label: "학년 백분위", value: "99" });
    // 원장 2026-10-28 — 반은 반 이름 없이 '반 등수 N등'(막대는 같은 백분위)
    expect(compareText({ label: "중등E_초5 의치대", rank: 1, of: 8, topPct: 12.5 }, "반")).toMatchObject({ label: "반 등수", value: "1", unit: "등", sub: "8명 중", fill: 87 });
    // 원장 2026-10-27 — 하위 학생이 '상위 86%'로 읽히던 것: 8명 중 7등은 백분위 14 · 꼴찌는 0
    expect(compareText({ label: "A반", rank: 7, of: 8, topPct: 86 }, "반").fill).toBe(14);
    expect(compareText({ label: "중2", rank: 8, of: 8, topPct: 100 }, "학년").value).toBe("0");
    // 인원이 적은 학년(5명 미만)은 등수로 — 1명 중 1등이 '백분위 0'으로 읽히지 않게(원장 2026-10-28).
    expect(compareText({ label: "초5", rank: 1, of: 1, topPct: 100 }, "학년")).toMatchObject({ label: "초5 학년 등수", value: "1", unit: "등", sub: "1명 중", fill: 100 });
    expect(compareText({ label: "초5", rank: 3, of: 4, topPct: 75 }, "학년")).toMatchObject({ label: "초5 학년 등수", value: "3", fill: 50 });
    expect(compareText({ label: "초5", rank: 1, of: 5, topPct: 20 }, "학년").label).toBe("초5 학년 백분위");
    expect(groupDigits(1234567)).toBe("1,234,567");
    expect(badgeGradeLabel("초4 과정 통과")).toBe("초4");
    expect(badgeGradeLabel("중1")).toBe("중1");
  });
});

describe("JJ 수업보고서 · 카드", () => {
  const snap = snapshotFromDay(day(STANDING), "t");
  const fill = (slots: Record<string, boolean>) => {
    const values = englishTemplateValues({
      studentName: "이윤건",
      teacherName: "김동후",
      progress: "",
      homeworkToday: "",
      tests: { daily: "", check: "" },
      nextTest: "",
      aiIntro: "",
      aiComment: "",
      slots,
    });
    const all = Object.fromEntries(ENGLISH_TEMPLATE_TOKEN_KEYS.map((k) => [k, ""]));
    return fillReportTemplate(BUILTIN_JJ_SHEET_TEMPLATE.body, { ...all, ...values }, { decorationTokens: TEMPLATE_DECORATION_TOKENS }).text;
  };

  it("JJ 템플릿에 '단어 학습 현황' 항목 — 자료가 있을 때만 선다", () => {
    expect(fill({ 학습배지: true, 단어백분위: true })).toContain("■ 단어 학습 현황\n[학습배지]\n[단어백분위]");
    expect(fill({ 학습배지: false, 단어백분위: true })).toContain("■ 단어 학습 현황\n[단어백분위]");
    expect(fill({})).not.toContain("단어 학습 현황");
  });

  it("자리 줄에 순위·배지 그림 — 대괄호는 안 나간다", () => {
    const html = renderToStaticMarkup(<TemplateBody text={"[학습배지]\n[단어백분위]"} jj={snap} inline={new Map()} />);
    expect(html).toContain("중1 과정 통과");
    expect(html).not.toContain("과정 통과 과정 통과");
    expect(html).toContain('src="https://injaewon.vercel.app/img/level/M1.webp"');
    expect(html).toContain("누적 단어");
    expect(html).toContain("1,234");
    expect(html).toContain("중2 학년 백분위");
    expect(html).not.toContain("상위");
    expect(html).toContain("41명 중 3등");
    expect(html).toContain("반 등수");
    expect(html).not.toContain("A반");
    expect(html).toContain("장기기억 단어");
    // 인재원 계산 기준 문장은 싣지 않는다(원장 2026-10-27)
    expect(html).not.toContain("기본모드(주관식 단어장) 기준");
    expect(html).not.toContain("[학습배지]");
    expect(html).not.toContain("[단어백분위]");
  });

  it("인재원이 순위를 안 주면(옛 저장본) 그 자리는 비고 대괄호도 안 나간다", () => {
    const html = renderToStaticMarkup(<TemplateBody text={"안녕\n[학습배지]\n[단어백분위]"} jj={snapshotFromDay(day(), "t")} inline={new Map()} />);
    expect(html).not.toContain("과정 통과");
    expect(html).not.toContain("[학습배지]");
    expect(html).not.toContain("[단어백분위]");
  });
});
