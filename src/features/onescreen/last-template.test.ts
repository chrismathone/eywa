import { describe, expect, it } from "vitest";
import { BUILTIN_ENGLISH_JJ_TEMPLATE_ID, BUILTIN_ENGLISH_TEMPLATE_ID, BUILTIN_JJ_SHEET_TEMPLATE_ID } from "@/features/report-templates/defaults";
import {
  EMPTY_TEMPLATE_PREFS,
  LAST_TEMPLATE_BY_CLASS_MAX,
  implicitTemplateFor,
  preferredTemplateFor,
  readTemplatePrefs,
  rememberTemplate,
  settleImplicit,
  retargetImplicit,
  revertImplicit,
} from "./last-template";

const JJ = BUILTIN_JJ_SHEET_TEMPLATE_ID;
const ECS = BUILTIN_ENGLISH_TEMPLATE_ID;
const MINE = "0b6f3c1e-1111-4222-8333-444455556666"; // 사용자 템플릿

describe("내 기본 템플릿 = 마지막으로 고른 것(원장 2026-10-27)", () => {
  it("ui_prefs에서 읽기 — 모양이 아닌 값은 버린다", () => {
    expect(readTemplatePrefs({ onescreen: { lastTemplateId: JJ, lastTemplateByClass: { c1: JJ, "x y": ECS, c2: 3 } } })).toEqual({
      last: JJ,
      byClass: { c1: JJ },
    });
    expect(readTemplatePrefs(null)).toEqual(EMPTY_TEMPLATE_PREFS);
  });

  it("반 기록이 먼저 · 계정 값은 JJ면 다른 반에 안 번진다", () => {
    const p = rememberTemplate(EMPTY_TEMPLATE_PREFS, JJ, "jj-class");
    expect(preferredTemplateFor(p, "jj-class")).toBe(JJ);
    // 🔴 일반 영어 반이 JJ로 시작하면 숙제 완성도가 빠지고 한마디 필수가 풀린다(적대 리뷰)
    expect(preferredTemplateFor(p, "regular")).toBeNull();
    const p2 = rememberTemplate(p, MINE, "other");
    expect(preferredTemplateFor(p2, "regular")).toBe(MINE);
    expect(preferredTemplateFor(p2, "jj-class")).toBe(JJ);
  });

  it("숨긴 기본 템플릿(ECS 자동, 2026-11-06)이 기록돼 있으면 새 행은 기본 템플릿으로", () => {
    const p = rememberTemplate(rememberTemplate(EMPTY_TEMPLATE_PREFS, ECS, "c1"), BUILTIN_ENGLISH_JJ_TEMPLATE_ID, "c2");
    expect(preferredTemplateFor(p, "c1")).toBeNull();
    expect(preferredTemplateFor(p, "c2")).toBeNull();
    expect(preferredTemplateFor(p, "other")).toBeNull();
  });

  it("반 기록 상한 — 오래된 것부터 버린다", () => {
    let p = EMPTY_TEMPLATE_PREFS;
    for (let i = 0; i <= LAST_TEMPLATE_BY_CLASS_MAX; i++) p = rememberTemplate(p, ECS, `c${i}`);
    expect(Object.keys(p.byClass)).toHaveLength(LAST_TEMPLATE_BY_CLASS_MAX);
    expect(p.byClass.c0).toBeUndefined();
  });

  it("글이 없고 안 보낸, 고른 적 없는 영어 행에만 붙인다", () => {
    const p = rememberTemplate(EMPTY_TEMPLATE_PREFS, JJ, "c1");
    expect(implicitTemplateFor({ subjectKey: "english", classId: "c1", draft: "" }, p)).toBe(JJ);
    expect(implicitTemplateFor({ subjectKey: "english", classId: "c1", templateId: "abc", draft: "" }, p)).toBeNull();
    // 🔴 옛 기본 템플릿으로 이미 쓴 글(templateId 없음)에 붙이면 저장 때 다른 템플릿으로 다시 짠다
    expect(implicitTemplateFor({ subjectKey: "english", classId: "c1", draft: "■ 진도\nUnit 1" }, p)).toBeNull();
    expect(implicitTemplateFor({ subjectKey: "english", classId: "c1", draft: "", reportSent: true }, p)).toBeNull();
    expect(implicitTemplateFor({ subjectKey: "math", classId: "c1", draft: "" }, p)).toBeNull();
  });

  it("되돌리기 — 기본값으로 붙인 빈 행만 · 바뀐 게 없으면 같은 객체", () => {
    const reports = {
      s1: { 영어: { templateId: "gone", templateImplicit: true, draft: "" } },
      s2: { 영어: { templateId: "gone", draft: "" } }, // 강사가 고른 것
      s3: { 영어: { templateId: "gone", templateImplicit: true, draft: "쓴 글" } },
    };
    const out = revertImplicit(reports, (id) => id === "gone");
    expect(out.s1!["영어"]).toEqual({ templateId: undefined, templateImplicit: undefined, draft: "" });
    expect(out.s2).toBe(reports.s2);
    expect(out.s3).toBe(reports.s3);
    expect(revertImplicit(reports, () => false)).toBe(reports);
  });

  it("기본값이 바뀌면 같은 반의 빈 행이 따라온다 — 고른 행·쓴 글·보낸 글·다른 반은 그대로", () => {
    type Row = { draft: string; templateId?: string; templateImplicit?: boolean; sent?: boolean };
    const reports: Record<string, Record<string, Row>> = {
      a: { 영어: { draft: "" } },
      b: { 영어: { templateId: ECS, templateImplicit: true, draft: "" } },
      c: { 영어: { templateId: ECS, draft: "" } },
      d: { 영어: { draft: "글" } },
      e: { 영어: { draft: "", sent: true } },
      f: { 영어: { draft: "" } },
    };
    const out = retargetImplicit(reports, (sid) => (sid === "f" ? "other" : "c1"), "c1", JJ);
    expect(out.a!["영어"]).toEqual({ draft: "", templateId: JJ, templateImplicit: true });
    expect(out.b!["영어"]!.templateId).toBe(JJ);
    expect(out.c).toBe(reports.c);
    expect(out.d).toBe(reports.d);
    expect(out.e).toBe(reports.e);
    expect(out.f).toBe(reports.f);
  });

  it("글이 생기면 기본값을 강사의 템플릿으로 굳힌다(직접 타이핑·사진 넣기)", () => {
    const r = { templateId: JJ, templateImplicit: true, draft: "직접 쓴 글" };
    expect(settleImplicit(r)).toEqual({ templateId: JJ, templateImplicit: undefined, draft: "직접 쓴 글" });
    const empty = { templateId: JJ, templateImplicit: true, draft: "" };
    expect(settleImplicit(empty)).toBe(empty);
  });
});
