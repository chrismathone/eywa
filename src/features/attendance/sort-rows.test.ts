import { describe, expect, it } from "vitest";
import {
  gradeOrder,
  isGroupedSort,
  parseAttendanceSortKey,
  sortAttendanceRows,
  type SortableRow,
} from "./sort-rows";

const row = (p: Partial<SortableRow> & { studentId: string; name: string }): SortableRow => ({
  classId: "c1",
  className: "반1",
  grade: null,
  role: null,
  ...p,
});

describe("gradeOrder — 초 → 중 → 고", () => {
  it("급간이 학년보다 우선한다(초6 < 중1)", () => {
    expect(gradeOrder("초6")).toBeLessThan(gradeOrder("중1"));
    expect(gradeOrder("중3")).toBeLessThan(gradeOrder("고1"));
  });

  it("같은 급간 안에서는 학년 오름차순", () => {
    expect(gradeOrder("고1")).toBeLessThan(gradeOrder("고2"));
  });

  it("모르는 표기·빈 값은 맨 뒤 — 숨기지 않는다(숨기면 그 학생이 출석부에서 사라진다)", () => {
    expect(gradeOrder(null)).toBeGreaterThan(gradeOrder("고3"));
    expect(gradeOrder("성인")).toBeGreaterThan(gradeOrder("고3"));
  });
});

describe("sortAttendanceRows", () => {
  it("🔴 반별은 입력 순서를 그대로 둔다 — 지금 화면(서버 쿼리 순서)이 바뀌면 안 된다", () => {
    const rows = [
      row({ studentId: "s3", name: "하늘", classId: "cB" }),
      row({ studentId: "s1", name: "가람", classId: "cA" }),
      row({ studentId: "s2", name: "나래", classId: "cA" }),
    ];
    expect(sortAttendanceRows(rows, "class").map((r) => r.studentId)).toEqual(["s3", "s1", "s2"]);
  });

  it("가나다순은 반 구분 없이 섞는다", () => {
    const rows = [
      row({ studentId: "s3", name: "하늘", classId: "cB" }),
      row({ studentId: "s1", name: "가람", classId: "cA" }),
      row({ studentId: "s2", name: "나래", classId: "cB" }),
    ];
    expect(sortAttendanceRows(rows, "name").map((r) => r.name)).toEqual(["가람", "나래", "하늘"]);
  });

  it("학년순은 초→중→고, 같은 학년은 이름순", () => {
    const rows = [
      row({ studentId: "s1", name: "나래", grade: "고1" }),
      row({ studentId: "s2", name: "가람", grade: "초3" }),
      row({ studentId: "s3", name: "다솜", grade: "중2" }),
      row({ studentId: "s4", name: "가온", grade: "고1" }),
    ];
    expect(sortAttendanceRows(rows, "grade").map((r) => r.name)).toEqual(["가람", "다솜", "가온", "나래"]);
  });

  it("담임·부담임순 — 담임 먼저, 판정 불가는 맨 뒤", () => {
    const rows = [
      row({ studentId: "s1", name: "나래", role: "assistant" }),
      row({ studentId: "s2", name: "가람", role: null }),
      row({ studentId: "s3", name: "다솜", role: "primary" }),
    ];
    expect(sortAttendanceRows(rows, "role").map((r) => r.role)).toEqual(["primary", "assistant", null]);
  });

  it("입력 배열을 변형하지 않는다(서버 캐시 오염 방지)", () => {
    const rows = [row({ studentId: "s2", name: "나래" }), row({ studentId: "s1", name: "가람" })];
    const before = rows.map((r) => r.studentId);
    sortAttendanceRows(rows, "name");
    expect(rows.map((r) => r.studentId)).toEqual(before);
  });

  it("같은 값끼리는 이름→id로 안정 정렬 — 새로고침마다 방향키 위치가 흔들리면 안 된다", () => {
    const rows = [
      row({ studentId: "sB", name: "동명", grade: "중1" }),
      row({ studentId: "sA", name: "동명", grade: "중1" }),
    ];
    expect(sortAttendanceRows(rows, "grade").map((r) => r.studentId)).toEqual(["sA", "sB"]);
  });

  it("반 그룹 머리행은 반별에서만", () => {
    expect(isGroupedSort("class")).toBe(true);
    expect(isGroupedSort("name")).toBe(false);
    expect(isGroupedSort("role")).toBe(false);
  });

  it("모르는 정렬 키는 반별로 폴백(설정 한 줄이 화면을 깨뜨리지 않게)", () => {
    expect(parseAttendanceSortKey("nope")).toBe("class");
    expect(parseAttendanceSortKey(undefined)).toBe("class");
    expect(parseAttendanceSortKey("grade")).toBe("grade");
  });
});
