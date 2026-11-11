import { describe, expect, it } from "vitest";
import { briefFactLines, BRIEF_FACT_TOPICS, EMPTY_BRIEF_FACTS } from "./brief-facts";
import { consultationsSchema } from "@/features/owner/settings-types";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { GENERIC_SETTINGS } from "@/features/owner/generic-defaults";
import { prepareSectionForSave } from "@/features/owner/preset";
import { diffSettingsSection } from "@/features/owner/settings-diff";

describe("상담 준비 브리프 — 학원 운영 안내 설정(2026-11-12)", () => {
  it("옛 설정(키 없음)은 빈칸으로 읽는다 · 기본값은 두 판 모두 빈칸(지어낸 운영 사실 없음)", () => {
    const parsed = consultationsSchema.parse({ templates: [] });
    expect(parsed.briefFacts).toEqual(EMPTY_BRIEF_FACTS);
    expect(DEFAULT_SETTINGS.consultations.briefFacts).toEqual(EMPTY_BRIEF_FACTS);
    expect(GENERIC_SETTINGS.consultations.briefFacts).toEqual(EMPTY_BRIEF_FACTS);
  });

  it("앞뒤 공백은 지우고 200자를 넘으면 저장을 거절한다(잘라 저장하지 않는다)", () => {
    const ok = consultationsSchema.parse({ templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS, makeup: "  결석 2일 전 신청 시 월 1회  " } });
    expect(ok.briefFacts.makeup).toBe("결석 2일 전 신청 시 월 1회");
    const long = consultationsSchema.safeParse({ templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS, reportCycle: "가".repeat(201) } });
    expect(long.success).toBe(false);
  });

  it("브리프에 싣는 줄 = 빈칸 빼고 주제 순서대로 · 원장이 넣은 줄바꿈은 지킨다 · 손상된 값은 빈칸", () => {
    expect(briefFactLines(null)).toEqual([]);
    expect(briefFactLines(EMPTY_BRIEF_FACTS)).toEqual([]);
    const lines = briefFactLines({ ...EMPTY_BRIEF_FACTS, discount: "형제 동시 등록 시 둘째부터 10%", reportCycle: "매 수업 후\n\n  수업보고서 발송  " });
    expect(lines).toEqual([
      { label: BRIEF_FACT_TOPICS[0].label, text: "매 수업 후\n수업보고서 발송" },
      { label: "할인", text: "형제 동시 등록 시 둘째부터 10%" },
    ]);
    expect(briefFactLines({ ...EMPTY_BRIEF_FACTS, makeup: 42 as unknown as string })).toEqual([]);
  });

  it("배포 전에 열어 둔 옛 폼(양식만 보냄)이 저장해도 운영 안내 원문을 지우지 않는다", () => {
    const stored = { templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS, makeup: "결석 2일 전 신청 시 월 1회" } };
    const raw = { templates: [] };
    const saved = prepareSectionForSave("chinsan", "consultations", raw, consultationsSchema.parse(raw), stored) as typeof stored;
    expect(saved.briefFacts.makeup).toBe("결석 2일 전 신청 시 월 1회");
    const withFacts = { templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS } };
    const cleared = prepareSectionForSave("chinsan", "consultations", withFacts, consultationsSchema.parse(withFacts), stored) as typeof stored;
    expect(cleared.briefFacts.makeup).toBe("");
    // 일부 주제만 보낸 요청은 나머지를 지우지 않는다
    const partial = { templates: [], briefFacts: { discount: "둘째부터 10%" } };
    const merged = prepareSectionForSave("chinsan", "consultations", partial, consultationsSchema.parse(partial), stored) as typeof stored;
    expect(merged.briefFacts.makeup).toBe("결석 2일 전 신청 시 월 1회");
    expect(merged.briefFacts.discount).toBe("둘째부터 10%");
    // 손상된 저장값(숫자 · 200자 넘음 · 옛 키)은 남기지 않는다
    const broken = { templates: [], briefFacts: { makeup: 42, trial: "가".repeat(201), report: "옛 키" } };
    const fixed = prepareSectionForSave("chinsan", "consultations", partial, consultationsSchema.parse(partial), broken) as unknown as { briefFacts: Record<string, string> };
    expect(fixed.briefFacts).toEqual({ ...EMPTY_BRIEF_FACTS, discount: "둘째부터 10%" });
  });

  it("감사로그 — 빈칸 첫 저장은 변경이 아니고, 고친 주제는 전후를 남긴다", () => {
    const first = diffSettingsSection("consultations", { templates: [] }, { templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS } });
    expect(JSON.stringify(first)).not.toContain("운영 안내");
    const edit = diffSettingsSection(
      "consultations",
      { templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS } },
      { templates: [], briefFacts: { ...EMPTY_BRIEF_FACTS, discount: "둘째부터 10%" } },
    );
    expect(JSON.stringify(edit)).toContain("할인");
    expect(JSON.stringify(edit)).toContain("둘째부터 10%");
  });
});
