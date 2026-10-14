import { describe, expect, it } from "vitest";
import type { Sections } from "@/features/dashboard/overview/model";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/program";
import { applySlices, inSliceAny, sliceGroupOf, sliceGroupsOf, sliceKey, slicePredicate, subjectsNamedIn } from "./slices";

const subjects = programSubjectsOf({ english: "영어", math: "수학", subject_1: "수학(심화)", korean: "국어" });
const groupOf = (key: string | null | undefined) => subjectGroupOf(key, subjects);
const group = sliceGroupOf(subjects, groupOf);
const groupsOf = sliceGroupsOf(subjects, groupOf);

describe("과목별 값(원장 2026-10-14 2단계)", () => {
  it("묶음 키는 순서·중복과 무관하다", () => {
    expect(sliceKey(["math", "english", "math"])).toBe("english+math");
    expect(sliceKey(["math"])).toBe("math");
  });

  it("묶음 판정 — 키·이름(옛 자유 입력) 둘 다 · 설정에 없는 과목과 빈 과목은 '모름'(null)", () => {
    expect(group("math")).toBe("math");
    expect(group("subject_1")).toBe("math"); // 수학(심화)는 수학 묶음
    expect(group("수학")).toBe("math"); // 옛 상담의 자유 입력
    expect(group("korean")).toBe("korean");
    expect(group("arts")).toBeNull(); // 설정에 없는 과목
    expect(group("")).toBeNull();
    expect(group(null)).toBeNull();
  });

  it("콜&상담 자유 입력 — EiE는 영어 · 두 과목 표기는 둘 다 · 못 읽는 낱말이 남으면 모름(원장 2026-10-14 *\"EiE ... 영어 아닌가\"*)", () => {
    // 운영 DB 실측 표기(2026-10-14)
    expect(groupsOf("EIE")).toEqual(["english"]);
    expect(groupsOf("EiE")).toEqual(["english"]);
    expect(groupsOf("eie")).toEqual(["english"]);
    expect(groupsOf("인재원 영어")).toEqual(["english"]);
    expect(groupsOf("english")).toEqual(["english"]);
    for (const both of ["영어 수학", "영어, 수학", "수학, 영어", "수학 영어", "영어수학", "영어+수학", "EIE, 수학", "EiE 수학", "수학 EIE"]) {
      expect(new Set(groupsOf(both)), both).toEqual(new Set(["english", "math"]));
    }
    expect(groupsOf("수학(심화)")).toEqual(["math"]);
    expect(groupsOf("subject_1")).toEqual(["math"]);
    expect(new Set(groupsOf("국어 영어 수학"))).toEqual(new Set(["korean", "english", "math"]));
    // 못 읽는 낱말이 하나라도 남으면 칸 전체가 모름(재리뷰 2026-10-14) — 'EiE 매쓰몽'을 영어로만 읽으면 매쓰몽(수학일 수 있다)이 수학 관리자에게서 사라진다.
    // 오탐하던 부분 일치('중국어'·'과학고')와 첫 글자 줄임('영수'·'수영')도 모름 — 숨는 쪽보다 더 보이는 쪽.
    // 프로그램 이름 '매쓰몽' = 수학(원장 2026-10-14 *"매쓰몽 수학"*)
    expect(groupsOf("매쓰몽")).toEqual(["math"]);
    expect(new Set(groupsOf("EiE 매쓰몽"))).toEqual(new Set(["english", "math"]));
    expect(new Set(groupsOf("매쓰몽 EIE"))).toEqual(new Set(["english", "math"]));
    expect(sliceGroupsOf(programSubjectsOf({ english: "영어" }), (k) => subjectGroupOf(k, programSubjectsOf({ english: "영어" })))("매쓰몽")).toEqual([]); // 수학 없는 지점엔 안 쓴다
    for (const unknown of ["매쓰몽 교과", "EiE 고등특강", "수학 특강", "수학상담", "중국어 수학", "과학고 대비", "영수", "수영", "기타", "mathmong",
      "고등특강", "설명회", "엉여", "인재원300", "010-3370-1764", "", null]) expect(groupsOf(unknown), String(unknown)).toEqual([]);
    // 한 값이 필요한 곳은 묶음이 하나일 때만
    expect(group("EiE")).toBe("english");
    expect(group("영어 수학")).toBeNull();
  });

  it("모르는 과목은 모든 관리자에게 든다 · 다른 과목은 빠진다 · 두 과목 학생은 양쪽에", () => {
    const math = slicePredicate(["math"], groupsOf);
    const english = slicePredicate(["english"], groupsOf);
    const korean = slicePredicate(["korean"], groupsOf);
    expect(math("EIE")).toBe(false);
    expect(english("EIE")).toBe(true);
    expect(math("영어 수학")).toBe(true);
    expect(english("영어 수학")).toBe(true);
    expect(korean("영어 수학")).toBe(false);
    expect(korean("고등특강")).toBe(true); // 모름 = 모두에게
    expect(korean("매쓰몽")).toBe(false); // 매쓰몽 = 수학
    expect(math("math")).toBe(true);
    expect(math("english")).toBe(false);
    expect(math(null)).toBe(true);
    expect(math("arts")).toBe(true);
    expect(inSliceAny(math, ["english", "math"])).toBe(true);
    expect(inSliceAny(english, ["english", "math"])).toBe(true);
    expect(inSliceAny(math, ["english"])).toBe(false);
    expect(inSliceAny(math, [])).toBe(true); // 과목을 하나도 모르면 든다
  });

  it("일정 제목 속 과목 이름 — 낱말로 선 것만('중국어'·'과학고'는 아니다) · EiE도 영어 · 붙여 쓴 '수학입테'는 수학", () => {
    const withScience = programSubjectsOf({ english: "영어", math: "수학", korean: "국어", science: "과학", subject_1: "수학(심화)" });
    const of = (key: string | null | undefined) => subjectGroupOf(key, withScience);
    const named = (text: string) => subjectsNamedIn(text, withScience, of);
    const pred = slicePredicate(["english"], sliceGroupsOf(withScience, of));
    expect(named("[수학] 보강")).toEqual(["수학"]);
    expect(new Set(named("영어/수학 설명회"))).toEqual(new Set(["영어", "수학"]));
    expect(named("중국어 체험")).toEqual([]);
    expect(named("경북과학고 입시설명회")).toEqual([]);
    expect(named("과학고 대비")).toEqual([]);
    expect(named("수학입테")).toEqual(["수학"]);
    expect(named("중국어·국어 상담")).toEqual(["국어"]); // 둘째 자리는 과목
    expect(new Set(named("수학(심화) 입테"))).toEqual(new Set(["수학(심화)", "수학"]));
    // 영어 갈래 이름 — 콜&상담과 같은 이름표(재리뷰 2026-10-14)
    expect(named("EiE 입테")).toEqual(["eie"]);
    expect(named("EiE입테 김OO")).toEqual(["eie"]);
    expect(named("Eiec 행사")).toEqual([]); // 영문은 영문 경계
    expect(inSliceAny(pred, named("EiE 입테"))).toBe(true);
    expect(inSliceAny(slicePredicate(["math"], sliceGroupsOf(withScience, of)), named("EiE 입테"))).toBe(false);
  });

  it("과목 값이 있는 영역만 갈아 끼우고, 실패한 칸(null)은 건드리지 않는다", () => {
    const sections: Sections = {
      intake: { data: [{ id: "a", name: "A", time: null }, { id: "b", name: "B", time: null }], at: 1, error: false },
      makeup: { data: null, at: null, error: true },
      notices: { data: [], at: 1, error: false },
    };
    const out = applySlices(sections, { intake: { math: [{ id: "a", name: "A", time: null }] }, makeup: { math: { range: { start: "x", end: "y" }, rows: [], later: 0 } } }, "math");
    expect(out.intake?.data?.map((r) => r.id)).toEqual(["a"]);
    expect(out.makeup?.data).toBeNull();
    expect(out.notices).toBe(sections.notices);
    expect(applySlices(sections, undefined, "math")).toBe(sections);
  });
});
