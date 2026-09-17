import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeupStudentIds } from "./input-roster";
import { recordedOnlyMatrixRow, recordedOnlyStudentIds } from "./monthly-makeup-roster";

/**
 * 월별 출석부가 **수강행 없는 기록자**를 명단에 합치는 규약(2026-09-02).
 * 배경은 monthly-makeup-roster.ts 머리 주석 — 보이지 않는 '보강' 반(0241a)이 영원히 0명이던 결함.
 */

// 🔴 "일별 입력과 같은 함수를 쓴다"는 소스 문자열이 아니라 **동작**으로 잠근다 — 스파이가 실제 호출을 본다.
vi.mock("./input-roster", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./input-roster")>();
  return { ...mod, makeupStudentIds: vi.fn(mod.makeupStudentIds) };
});

beforeEach(() => {
  vi.mocked(makeupStudentIds).mockClear();
});

describe("recordedOnlyStudentIds — 기록은 있는데 그 반 수강행이 없는 학생", () => {
  it("수강행 0 + 기록 1건 → 명단 1명", () => {
    expect(recordedOnlyStudentIds(["이윤"], [])).toEqual(["이윤"]);
  });

  it("수강행 있는 학생은 **중복되지 않는다**(두 줄 서지 않게)", () => {
    expect(recordedOnlyStudentIds(["a", "b", "b", "c"], ["a", "c"])).toEqual(["b"]);
    // 같은 학생의 기록이 여러 날이어도 id는 한 번.
    expect(recordedOnlyStudentIds(["b", "b", "b"], [])).toEqual(["b"]);
  });

  it("휴원·종료 수강행도 '수강행 있음'이다 — 일별 로스터와 같은 집합(호출부가 전 행을 넘긴다)", () => {
    // 규칙 자체는 id 집합만 본다 — 호출부가 on_hold·종료 행을 빼고 넘기면 그 학생이 '보강'으로 둔갑한다.
    expect(recordedOnlyStudentIds(["held"], ["held"])).toEqual([]);
  });

  it("🔴 일별 입력 로스터와 **같은 함수**(makeupStudentIds)를 실제로 부른다 — 복제 금지", () => {
    recordedOnlyStudentIds(["x", "y"], ["y"]);
    expect(makeupStudentIds).toHaveBeenCalledTimes(1);
    expect(makeupStudentIds).toHaveBeenCalledWith(["x", "y"], ["y"]);
  });
});

describe("recordedOnlyMatrixRow — 합친 행의 모양", () => {
  it("spans·attendDows·badges 전부 빈 배열, enrolledAt null", () => {
    const row = recordedOnlyMatrixRow({ id: "s1", name: "이윤", grade: "초5", school: "칠성초" });
    expect(row).toEqual({
      id: "s1",
      name: "이윤",
      grade: "초5",
      school: "칠성초",
      enrolledAt: null,
      attendDows: [],
      spans: [],
      badges: [],
    });
  });

  it("🔴 가짜 수강 구간을 지어내지 않는다 — 빈 spans라야 isEnrolledOn이 true라 칸이 회색으로 안 죽는다", () => {
    const row = recordedOnlyMatrixRow({ id: "s1", name: "이윤", grade: null, school: null });
    expect(row.spans).toHaveLength(0);
    // 등원일이 없어야 기록이 있는 **그날만** 값이 서고 나머지는 빈칸("그날만 출석한것처럼").
    expect(row.attendDows).toHaveLength(0);
  });
});

describe("배선 — getMonthlyAttendanceMatrix가 순서를 지킨다", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "features", "attendance", "server", "queries.ts"),
    "utf8",
  );
  const fn = src.slice(src.indexOf("export async function getMonthlyAttendanceMatrix"));

  it("합치기는 뱃지 계산(attachLifecycleBadges) **뒤**, 출결 조회(studentIds) **앞**", () => {
    const badgesAt = fn.indexOf("await attachLifecycleBadges(");
    const mergeAt = fn.indexOf("recordedOnlyStudentIds(");
    const studentIdsAt = fn.indexOf("const studentIds = ");
    expect(badgesAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(badgesAt); // 구간 없는 학생에게 신입/퇴원을 계산시키지 않는다
    expect(studentIdsAt).toBeGreaterThan(mergeAt); // 합친 학생의 칸이 비지 않는다
    expect(fn).toContain("recordedOnlyMatrixRow(");
  });

  it("⚠️ 명단을 만드는 조회는 무페이징 select가 아니다(B2) — fetchAllPaged", () => {
    const head = fn.slice(0, fn.indexOf("const studentIds = "));
    // session_date = 강사 보기가 그 강사가 수업하는 날의 기록으로만 명단을 합치는 재료(2026-09-17).
    expect(head).toMatch(/fetchAllPaged<\{ student_id: string; session_date: string \}>/);
  });
});
