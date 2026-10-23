import { describe, expect, it } from "vitest";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { classKeysOfGroups, consultClassKeys, consultClassKeysOf, inConsultClasses } from "./consult-subject";

/** 침산 학원 설정 과목(2026-10-23 운영 DB) — 판정은 key·label만 본다. */
const CHIMSAN = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "science", label: "과학" },
  { key: "korean", label: "국어" },
] as unknown as SubjectSetting[];
/** 수학(심화)가 따로 있는 학원(코드 기본값) — 수학 묶음에 둘 다 든다. */
const WITH_DEEP = [
  { key: "math", label: "수학" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "english", label: "영어" },
] as unknown as SubjectSetting[];

describe("상담 과목 글자 → 반 과목 키(옛 이관 자유 글자 실측)", () => {
  it.each([
    ["수학", ["math"]],
    ["영어", ["english"]],
    ["EIE", ["english"]],
    ["EiE", ["english"]],
    ["영어, 수학", ["english", "math"]],
    ["수학 영어", ["english", "math"]],
    ["수학, 영어", ["english", "math"]],
    ["매쓰몽", ["math"]],
    ["math", ["math"]],
    ["english", ["english"]],
    ["국어", ["korean"]],
    // 못 읽는 글자 = 배정 없음(아무 과목으로 추정하지 않는다)
    ["영수", []],
    ["고등특강", []],
    ["EiE 고등특강", []],
    ["설명회 문의", []],
  ])("'%s' → %j", (text, keys) => {
    expect(consultClassKeys(text, CHIMSAN)).toEqual(keys);
  });

  it("빈칸·null = 과목 모름 → null(전 과목 수강으로 판정 — 종전 폴백)", () => {
    expect(consultClassKeys("", CHIMSAN)).toBeNull();
    expect(consultClassKeys("   ", CHIMSAN)).toBeNull();
    expect(consultClassKeys(null, CHIMSAN)).toBeNull();
    expect(consultClassKeys(undefined, CHIMSAN)).toBeNull();
  });

  it("수학 묶음 = 수학 + 수학(심화) 반 · 영어는 영어 반만", () => {
    expect(consultClassKeys("수학", WITH_DEEP)).toEqual(["math", "subject_1"]);
    expect(consultClassKeys("수학(심화)", WITH_DEEP)).toEqual(["math", "subject_1"]);
    expect(consultClassKeys("EIE", WITH_DEEP)).toEqual(["english"]);
  });

  it("묶음 키 자신은 설정 이름과 무관하게 그 과목 반 — 수학 과목 키가 다른 학원에서도 math 반을 놓치지 않는다", () => {
    const renamed = [{ key: "subject_3", label: "수학" }] as unknown as SubjectSetting[];
    expect(classKeysOfGroups(["math"], renamed)).toEqual(["math", "subject_3"]);
    expect(classKeysOfGroups([], renamed)).toEqual([]);
  });

  it("같은 설정으로 여러 번 부르면 같은 답(글자마다 한 번 계산)", () => {
    const of = consultClassKeysOf(CHIMSAN);
    expect(of("영어 수학")).toBe(of("영어 수학"));
    expect(of("영어 수학")).toEqual(["english", "math"]);
  });
});

describe("반 과목이 상담이 보는 반인가", () => {
  it("null(과목 모름)은 모든 반 · [](못 읽음)은 어떤 반도 아니다 · 그 밖은 키 목록 안", () => {
    expect(inConsultClasses(null, "math")).toBe(true);
    expect(inConsultClasses(null, null)).toBe(true);
    expect(inConsultClasses([], "math")).toBe(false);
    expect(inConsultClasses(["math"], "math")).toBe(true);
    expect(inConsultClasses(["math"], "english")).toBe(false);
    expect(inConsultClasses(["math"], null)).toBe(false);
  });
});
