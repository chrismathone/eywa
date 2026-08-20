import { describe, expect, it } from "vitest";
import {
  applyWriteFilter,
  countByWriteFilter,
  isRowWritten,
  isStudentWritten,
  isWriteTargetRow,
  matchesWriteFilter,
} from "./write-filter";

describe("미발송 반 행(0174a) — 결석과 같은 이유로 '미작성' 판정에서 뺀다(2026-08-19)", () => {
  it("보고서 입력이 잠긴 행이라 채울 수단이 없다 — 끝낼 수 없는 할 일로 남기지 않는다", () => {
    expect(isWriteTargetRow({ reportOptout: true })).toBe(false);
    expect(isWriteTargetRow({ reportOptout: false })).toBe(true);
    expect(isWriteTargetRow({})).toBe(true);
    // 미발송 반 행만 있는 학생은 '작성 완료'로 본다(미작성 목록에 남겨 봐야 할 수 있는 일이 없다).
    expect(isStudentWritten([{ reportOptout: true }, { reportOptout: true }])).toBe(true);
    // 같이 듣는 정규 반은 그대로 판정 대상이다.
    expect(isStudentWritten([{ reportOptout: true }, { draft: "" }])).toBe(false);
    expect(isStudentWritten([{ reportOptout: true }, { draft: "썼다" }])).toBe(true);
  });
});

describe("isRowWritten", () => {
  it("초안이 있으면 작성됨", () => {
    expect(isRowWritten({ draft: "오늘 잘했습니다" })).toBe(true);
  });
  it("공백뿐인 초안은 미작성", () => {
    expect(isRowWritten({ draft: "   \n " })).toBe(false);
  });
  it("초안이 비어도 이미 저장/발송됐으면 작성됨", () => {
    expect(isRowWritten({ draft: "", sent: true })).toBe(true);
  });
  it("아무것도 없으면 미작성", () => {
    expect(isRowWritten({})).toBe(false);
  });
});

describe("isWriteTargetRow", () => {
  it("결석 행은 판정 대상이 아니다(발송 자체가 막혀 있음)", () => {
    expect(isWriteTargetRow({ attendanceRaw: "absent" })).toBe(false);
  });
  it("조퇴·지각·기록없음은 대상", () => {
    expect(isWriteTargetRow({ attendanceRaw: "early_leave" })).toBe(true);
    expect(isWriteTargetRow({ attendanceRaw: "late" })).toBe(true);
    expect(isWriteTargetRow({})).toBe(true);
  });
});

describe("isStudentWritten", () => {
  it("모든 행에 문구가 있어야 작성 완료", () => {
    expect(isStudentWritten([{ draft: "수학 멘트" }, { draft: "영어 멘트" }])).toBe(true);
  });
  it("한 행이라도 비면 미작성", () => {
    expect(isStudentWritten([{ draft: "수학 멘트" }, { draft: "" }])).toBe(false);
  });
  it("빈 행이 결석이면 판정에서 빠져 완료", () => {
    expect(isStudentWritten([{ draft: "수학 멘트" }, { draft: "", attendanceRaw: "absent" }])).toBe(
      true,
    );
  });
  it("전 행 결석(=쓸 게 없음)은 완료로 본다 — 끝낼 수 없는 할 일을 남기지 않는다", () => {
    expect(isStudentWritten([{ attendanceRaw: "absent" }])).toBe(true);
  });
  it("행이 없으면 완료", () => {
    expect(isStudentWritten([])).toBe(true);
  });
});

describe("matchesWriteFilter", () => {
  it("all은 전부 통과", () => {
    expect(matchesWriteFilter("all", true)).toBe(true);
    expect(matchesWriteFilter("all", false)).toBe(true);
  });
  it("written/unwritten은 서로 배타", () => {
    expect(matchesWriteFilter("written", true)).toBe(true);
    expect(matchesWriteFilter("written", false)).toBe(false);
    expect(matchesWriteFilter("unwritten", false)).toBe(true);
    expect(matchesWriteFilter("unwritten", true)).toBe(false);
  });
});

describe("applyWriteFilter", () => {
  const students = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const written = { a: true, b: false, c: false };

  it("all이면 전원 그대로(순서 보존)", () => {
    expect(applyWriteFilter(students, "all", written, new Set()).map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("미작성 필터는 미작성만", () => {
    expect(applyWriteFilter(students, "unwritten", written, new Set()).map((s) => s.id)).toEqual([
      "b",
      "c",
    ]);
  });
  it("작성 필터는 작성만", () => {
    expect(applyWriteFilter(students, "written", written, new Set()).map((s) => s.id)).toEqual(["a"]);
  });
  it("🔴 고정된 학생은 조건이 바뀌어도 남는다 — 입력 중 카드/행이 사라지지 않게", () => {
    // b를 미작성으로 걸어 둔 뒤 문구를 쓰기 시작(=written) → 그래도 목록에 남아야 한다.
    const nowWritten = { a: true, b: true, c: false };
    expect(
      applyWriteFilter(students, "unwritten", nowWritten, new Set(["b"])).map((s) => s.id),
    ).toEqual(["b", "c"]);
  });
  it("고정돼 있어도 원래 자리(정렬 순서)를 지킨다", () => {
    const nowWritten = { a: true, b: true, c: true };
    expect(
      applyWriteFilter(students, "unwritten", nowWritten, new Set(["a", "c"])).map((s) => s.id),
    ).toEqual(["a", "c"]);
  });
  it("필터 중 새로 조건에 맞게 된 학생(보강 추가 등)은 고정이 없어도 들어온다", () => {
    const withMakeup = [...students, { id: "new" }];
    expect(
      applyWriteFilter(withMakeup, "unwritten", written, new Set()).map((s) => s.id),
    ).toEqual(["b", "c", "new"]); // writtenById에 없는 학생 = 미작성 취급
  });
});

describe("countByWriteFilter", () => {
  it("고정과 무관하게 지금 조건에 맞는 수를 센다", () => {
    const students = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const written = { a: true, b: false, c: false };
    expect(countByWriteFilter(students, "written", written)).toBe(1);
    expect(countByWriteFilter(students, "unwritten", written)).toBe(2);
  });
});
