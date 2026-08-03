import { describe, it, expect } from "vitest";
import { matchReportsToRows, reportUnitKey } from "./report-unit";

describe("reportUnitKey", () => {
  it("반이 있으면 반이 단위", () => {
    expect(reportUnitKey("c1", "math")).toBe("c1");
  });

  it("반이 없으면 과목이 단위(관리자 작성·구버전 행)", () => {
    expect(reportUnitKey(null, "math")).toBe("math");
    expect(reportUnitKey("  ", "math")).toBe("math");
  });

  it("둘 다 없으면 null — 이관분(제약 밖)", () => {
    expect(reportUnitKey(null, null)).toBeNull();
    expect(reportUnitKey(undefined, "")).toBeNull();
  });
});

describe("matchReportsToRows", () => {
  const row = (classId: string | null, subjectKey: string | null) => ({ classId, subjectKey });
  const rep = (classId: string | null, subject: string | null, tag = "") => ({ classId, subject, tag });
  const mkRow = (subjectKey: string | null) => ({ classId: null, subjectKey, isMakeup: true });
  const mkRep = (subject: string | null, tag = "") => ({ classId: null, subject, makeup: true, tag });

  // 🔴 2026-08-03 원장 제보(하은결): 보강 보고서를 발송했는데 강사 화면에서 찾을 수 없었다.
  //    로스터가 보강 행을 되살려도 보고서가 안 붙으면 "미작성"으로 보인다 → 보강끼리 붙는 전용 단계.
  it("보강 행에는 같은 과목 보강 보고서가 붙는다", () => {
    expect(matchReportsToRows([mkRow("math")], [mkRep("math", "MK")]).map((r) => r?.tag)).toEqual(["MK"]);
  });

  it("보강 보고서가 정규 행을 잠그지 않는다(기존 방어 유지)", () => {
    const rows = [row(null, "math")];
    expect(matchReportsToRows(rows, [mkRep("math", "MK")]).map((r) => r?.tag)).toEqual([undefined]);
  });

  it("보강 행이 정규(반 없는) 보고서를 가져가지 않는다", () => {
    expect(matchReportsToRows([mkRow("math")], [rep(null, "math", "N")]).map((r) => r?.tag)).toEqual([undefined]);
  });

  it("정규 행 + 보강 행이 한 학생에 있으면 각자 제 보고서를 가져간다", () => {
    const rows = [row("c1", "math"), mkRow("math")];
    const reports = [mkRep("math", "MK"), rep("c1", "math", "R")];
    expect(matchReportsToRows(rows, reports).map((r) => r?.tag)).toEqual(["R", "MK"]);
  });

  it("정규·특강 두 행이 각자의 보고서를 가져간다", () => {
    const rows = [row("정규", "math"), row("특강", "math")];
    const reports = [rep("특강", "math", "T"), rep("정규", "math", "R")];
    expect(matchReportsToRows(rows, reports).map((r) => r?.tag)).toEqual(["R", "T"]);
  });

  it("반이 없는 보고서(관리자 작성·구버전)는 같은 과목 행에 붙는다", () => {
    const rows = [row("c1", "math")];
    expect(matchReportsToRows(rows, [rep(null, "math", "A")])?.[0]?.tag).toBe("A");
  });

  it("🔴 반 없는 보고서 1건을 같은 과목 두 행이 나눠 갖지 않는다 — 앞 행만", () => {
    const rows = [row("정규", "math"), row("특강", "math")];
    const got = matchReportsToRows(rows, [rep(null, "math", "A")]);
    expect(got.map((r) => r?.tag)).toEqual(["A", undefined]);
  });

  it("반 정확매칭이 과목 폴백을 이긴다(순서 무관)", () => {
    const rows = [row("정규", "math"), row("특강", "math")];
    // 반 없는 행이 먼저 와도 특강 행은 자기 반 보고서를 가져가야 한다.
    const got = matchReportsToRows(rows, [rep(null, "math", "A"), rep("특강", "math", "T")]);
    expect(got.map((r) => r?.tag)).toEqual(["A", "T"]);
  });

  it("과목도 반도 없는 이관분은 legacyFallback + 단일 과목 학생일 때만 붙는다", () => {
    const opts = { legacyFallback: true };
    expect(matchReportsToRows([row("c1", "math")], [rep(null, null, "L")], opts)?.[0]?.tag).toBe("L");
    // 다과목 학생 — 어느 과목인지 알 수 없어 붙이지 않는다.
    const multi = matchReportsToRows([row("c1", "math"), row("c2", "english")], [rep(null, null, "L")], opts);
    expect(multi).toEqual([undefined, undefined]);
  });

  // 🔴 당일 행(기본값)에서 이 폴백이 켜지면, edutrix가 오늘 넣은 이관분(반·과목 없음)이
  // 강사가 쓰지도 않은 "이미 저장됨"으로 붙고 그 본문이 초안으로 로드된다.
  it("legacyFallback 미지정이면 이관분을 붙이지 않는다(당일 행 기본값)", () => {
    expect(matchReportsToRows([row("c1", "math")], [rep(null, null, "L")])).toEqual([undefined]);
  });

  // 🔴 같은 과목 두 반으로 갈린 학생(정규+특강)이 이관분 이력을 통째로 잃던 회귀.
  it("같은 과목 두 행이어도 이관분은 첫 행에 붙는다(이력 유실 방지)", () => {
    const got = matchReportsToRows(
      [row("정규", "math"), row("특강", "math")],
      [rep(null, null, "L")],
      { legacyFallback: true },
    );
    expect(got.map((r) => r?.tag)).toEqual(["L", undefined]);
  });

  // 🔴🔴 2026-07-29 원장 제보(영어 강사 원스크린): 영어 학생인데 '이전 회차'가 수학이었다.
  //    로스터는 **강사 담당 반만** 싣기 때문에, 수학도 듣는 학생이 영어 강사에겐 영어 행 하나로 보인다
  //    → 옛 조건(`subjectKeys.size === 1`)을 통과해 수학 이관분이 영어 행에 붙었다.
  it("영어 단일 행에는 이관분(=수학)을 붙이지 않는다 — 강사 시야가 좁아 단일 과목처럼 보일 뿐이다", () => {
    const got = matchReportsToRows([row("e1", "english")], [rep(null, null, "L")], { legacyFallback: true });
    expect(got).toEqual([undefined]);
  });

  it("영어 두 반(정규+심화)도 마찬가지로 안 붙는다", () => {
    const got = matchReportsToRows(
      [row("e1", "english"), row("e2", "english")],
      [rep(null, null, "L")],
      { legacyFallback: true },
    );
    expect(got).toEqual([undefined, undefined]);
  });

  it("subject='english' 보고서는 영어 행에 정상 매칭된다 — 게이트가 영어를 영구히 막지 않는다", () => {
    const got = matchReportsToRows([row("e1", "english")], [rep(null, "english", "E")], {
      legacyFallback: true,
    });
    expect(got.map((r) => r?.tag)).toEqual(["E"]);
  });

  it("행 과목 미지정('')은 math 간주라 이관분을 받는다(진도 분기와 같은 규약)", () => {
    const got = matchReportsToRows([{ classId: "c1", subjectKey: null }], [rep(null, null, "L")], {
      legacyFallback: true,
    });
    expect(got.map((r) => r?.tag)).toEqual(["L"]);
  });

  it("다과목 학생에겐 여전히 안 붙인다 — 어느 과목인지 모른다", () => {
    expect(
      matchReportsToRows([row("c1", "math"), row("c2", "english")], [rep(null, null, "L")], {
        legacyFallback: true,
      }),
    ).toEqual([undefined, undefined]);
  });

  it("반 매칭으로 이미 채워진 행은 건너뛰고 남은 행에 준다", () => {
    const got = matchReportsToRows(
      [row("정규", "math"), row("특강", "math")],
      [rep("정규", "math", "R"), rep(null, null, "L")],
      { legacyFallback: true },
    );
    expect(got.map((r) => r?.tag)).toEqual(["R", "L"]);
  });

  it("다른 반 보고서는 안 붙는다(교차 주입 금지)", () => {
    expect(matchReportsToRows([row("정규", "math")], [rep("특강", "math")])?.[0]).toBeUndefined();
  });

  it("보고서가 없으면 전부 undefined", () => {
    expect(matchReportsToRows([row("c1", "math"), row("c2", "english")], [])).toEqual([undefined, undefined]);
  });
});

// 2026-07-23 원장 제보: "특강에서도 정규수업의 이전 보고서를 가져온다".
// 원인 = 2·3차 폴백이 "반 없는 보고서"를 과목만 보고 붙이는데, 정규와 특강은 같은 과목이라 구분 못 함.
describe("정규/특강 분리 — 특강 행은 그 반으로 확정된 보고서만", () => {
  const 정규 = { classId: "c-regular", subjectKey: "math" };
  const 특강 = { classId: "c-special", subjectKey: "math", isSpecial: true };

  it("이관분(반·과목 없음)은 특강이 아니라 정규 행에 붙는다", () => {
    const legacy = { classId: null, subject: null, tag: "이관분" };
    const out = matchReportsToRows([정규, 특강], [legacy], { legacyFallback: true });
    expect(out[0]).toBe(legacy);
    expect(out[1]).toBeUndefined();
  });

  it("정규가 이미 자기 반 보고서를 가졌으면 이관분은 아무 행에도 안 붙는다(특강으로 새지 않음)", () => {
    const own = { classId: "c-regular", subject: "math", tag: "정규 당일" };
    const legacy = { classId: null, subject: null, tag: "이관분" };
    const out = matchReportsToRows([정규, 특강], [own, legacy], { legacyFallback: true });
    expect(out[0]).toBe(own);
    expect(out[1]).toBeUndefined(); // ← 예전엔 여기에 legacy가 붙어 정규 진도가 특강에 떴다
  });

  it("반 없는 과목 보고서(2차)도 특강 행엔 안 붙는다", () => {
    const bySubject = { classId: null, subject: "math", tag: "관리자 작성" };
    const out = matchReportsToRows([특강], [bySubject], { legacyFallback: true });
    expect(out[0]).toBeUndefined();
  });

  it("특강 반으로 확정된 보고서는 정확히 그 행에 붙는다", () => {
    const sp = { classId: "c-special", subject: "math", tag: "특강" };
    const reg = { classId: "c-regular", subject: "math", tag: "정규" };
    const out = matchReportsToRows([정규, 특강], [sp, reg], { legacyFallback: true });
    expect(out[0]).toBe(reg);
    expect(out[1]).toBe(sp);
  });

  it("특강이 없는 학생은 기존 동작 그대로(이관분 폴백 유지)", () => {
    const legacy = { classId: null, subject: null, tag: "이관분" };
    const out = matchReportsToRows([정규], [legacy], { legacyFallback: true });
    expect(out[0]).toBe(legacy);
  });
});

// 2026-07-24 적대검수: 병합 보강(수업외) 보고서(class_id=null·makeup)가 새로고침 후 매처의 과목 폴백으로
// **정규 반 행에 오배정**돼, 안 보낸 정규 보고서가 보강의 발송상태로 잠기던 버그. 보강 보고서는 로스터가
// 재구성하지 않는 임시 행의 산물이라 어느 정규/이관 행에도 붙으면 안 된다(깨끗이 orphan → 재추가 시 복원).
describe("보강(makeup) 보고서는 과목 폴백으로 정규 행에 붙지 않는다", () => {
  it("2차(반 없는 과목) 폴백 — makeup 보고서는 정규 행에 안 붙는다", () => {
    const 정규 = { classId: "c1", subjectKey: "math" };
    const makeup = { classId: null, subject: "math", makeup: true, tag: "보강" };
    // makeup=true라 2차 폴백에서 제외 → 정규 행은 미매칭(=안 보낸 정규가 잠기지 않음).
    expect(matchReportsToRows([정규], [makeup])).toEqual([undefined]);
  });

  it("makeup이 아닌 반 없는 보고서(관리자 작성)는 여전히 붙는다 — 회귀 방지", () => {
    const 정규 = { classId: "c1", subjectKey: "math" };
    const admin = { classId: null, subject: "math", makeup: false, tag: "관리자" };
    expect(matchReportsToRows([정규], [admin])?.[0]?.tag).toBe("관리자");
    // makeup 필드가 아예 없어도(레거시 행) 붙는다.
    const legacyRow = { classId: null, subject: "math", tag: "구버전" };
    expect(matchReportsToRows([정규], [legacyRow])?.[0]?.tag).toBe("구버전");
  });

  it("정규 반 보고서는 자기 행에 붙고, 같은 과목 makeup 보고서는 어느 행에도 안 붙는다(공존)", () => {
    const 정규 = { classId: "c1", subjectKey: "math" };
    const own = { classId: "c1", subject: "math", tag: "정규 발송본" };
    const makeup = { classId: null, subject: "math", makeup: true, tag: "보강 발송본" };
    const out = matchReportsToRows([정규], [own, makeup]);
    expect(out[0]?.tag).toBe("정규 발송본"); // 1차 정확매칭 — 보강에 오염되지 않음
  });

  it("3차 이관분 폴백도 makeup 보고서는 제외한다(방어)", () => {
    const 정규 = { classId: "c1", subjectKey: "math" };
    const makeupNoSubject = { classId: null, subject: null, makeup: true, tag: "보강(과목없음)" };
    // legacyFallback이 켜져도 makeup이면 안 붙는다.
    expect(matchReportsToRows([정규], [makeupNoSubject], { legacyFallback: true })).toEqual([undefined]);
  });
});
