import { describe, expect, it } from "vitest";
import {
  buildHomeroomSinceIndex,
  buildTeacherAsOfIndex,
  buildUniqueClassNameIndex,
  homeroomSinceOf,
  resolveTransitionClassId,
  historyWindowStart,
  resolveTeacherAsOf,
  type MonthlyWriter,
  type TeacherTransition,
} from "./teacher-as-of";

const idx = (t: TeacherTransition[], w: MonthlyWriter[] = [], since = "2026-06-01") =>
  buildTeacherAsOfIndex({ transitions: t, writers: w, since });

describe("resolveTeacherAsOf — 인수인계 기록(사실)", () => {
  const i = idx([
    { classId: "c1", date: "2026-07-01", teacherName: "김강사" },
    { classId: "c1", date: "2026-08-04", teacherName: "허은진" },
  ]);

  it("그 날짜 이하의 마지막 인계가 그때 담임", () => {
    expect(resolveTeacherAsOf(i, "c1", "2026-07-15")).toEqual({ name: "김강사", inferred: false });
    expect(resolveTeacherAsOf(i, "c1", "2026-08-05")).toEqual({ name: "허은진", inferred: false });
  });

  it("인계 당일부터 새 담임", () => {
    expect(resolveTeacherAsOf(i, "c1", "2026-08-04")!.name).toBe("허은진");
    expect(resolveTeacherAsOf(i, "c1", "2026-08-03")!.name).toBe("김강사");
  });
});

describe("resolveTeacherAsOf — 보고서 작성자(추정)", () => {
  it("🔴 인계가 그 날짜보다 뒤에만 있으면 보고서로 메우고 **추정으로 표시**한다", () => {
    const i = idx(
      [{ classId: "c1", date: "2026-08-04", teacherName: "허은진" }],
      [{ classId: "c1", month: "2026-07", teacherName: "이유정", count: 7 }],
    );
    expect(resolveTeacherAsOf(i, "c1", "2026-07-15")).toEqual({ name: "이유정", inferred: true });
  });

  it("같은 달에 여러 명이면 건수 많은 쪽(동수면 이름 순 — 결정적)", () => {
    const i = idx(
      [],
      [
        { classId: "c1", month: "2026-07", teacherName: "나중", count: 2 },
        { classId: "c1", month: "2026-07", teacherName: "많이", count: 9 },
      ],
    );
    expect(resolveTeacherAsOf(i, "c1", "2026-07-10")).toEqual({ name: "많이", inferred: true });
  });

  it("근거가 없으면 null — 빈 이름을 지어내지 않는다(호출부가 현재 담임을 쓴다)", () => {
    expect(resolveTeacherAsOf(idx([]), "c1", "2026-07-10")).toBeNull();
  });

  it("창(2개월) 밖은 추정하지 않는다", () => {
    const i = idx([], [{ classId: "c1", month: "2026-03", teacherName: "옛사람", count: 5 }], "2026-06-01");
    expect(resolveTeacherAsOf(i, "c1", "2026-03-10")).toBeNull();
  });

  it("이름 없는 전이는 이력이 못 된다(빈 칸 방지)", () => {
    const i = idx([{ classId: "c1", date: "2026-07-01", teacherName: null }]);
    expect(resolveTeacherAsOf(i, "c1", "2026-07-15")).toBeNull();
  });
});

describe("historyWindowStart", () => {
  it("N개월 전 1일", () => {
    expect(historyWindowStart("2026-08-04", 2)).toBe("2026-06-01");
    expect(historyWindowStart("2026-01-15", 2)).toBe("2025-11-01");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// "언제부터 이 사람이 담임인가"(id 기준) — 강사 축 출석부가 담임 이전 칸을 가리는 근거.
// ──────────────────────────────────────────────────────────────────────────────

const tr = (classId: string, date: string, teacherId: string | null) => ({
  classId,
  date,
  teacherId,
  teacherName: teacherId ? `이름:${teacherId}` : null,
});

describe("buildHomeroomSinceIndex / homeroomSinceOf", () => {
  it("마지막 전이가 그 사람이면 그 날짜부터 담임", () => {
    const i = buildHomeroomSinceIndex([tr("c1", "2026-08-03", "u9"), tr("c1", "2026-08-10", "u1")], "2026-06-01");
    expect(homeroomSinceOf(i, "c1", "u1")).toBe("2026-08-10");
    // 전임에게는 경계를 주지 않는다 — 그 사람은 지금 담임이 아니고, 호출부도 현재 담임만 묻는다.
    expect(homeroomSinceOf(i, "c1", "u9")).toBeNull();
  });

  it("🔴 근거가 없으면 null — 호출부가 지금처럼 전부 보여준다(폴백이 안전벨트)", () => {
    const i = buildHomeroomSinceIndex([tr("c1", "2026-08-10", "u1")], "2026-06-01");
    expect(homeroomSinceOf(i, "없는반", "u1")).toBeNull();
    expect(homeroomSinceOf(i, "c1", null)).toBeNull();
    expect(homeroomSinceOf(buildHomeroomSinceIndex([], "2026-06-01"), "c1", "u1")).toBeNull();
  });

  it("반이나 사람을 모르는 로그는 경계를 만들지 않는다", () => {
    const i = buildHomeroomSinceIndex([tr("", "2026-08-10", "u1"), tr("c1", "2026-08-10", null)], "2026-06-01");
    expect(homeroomSinceOf(i, "c1", "u1")).toBeNull();
  });

  it("같은 사람으로 연달아 찍힌 로그는 한 구간 — **더 이른 날**을 준다(덜 지우는 쪽)", () => {
    const i = buildHomeroomSinceIndex(
      [tr("c1", "2026-07-20", "u9"), tr("c1", "2026-08-01", "u1"), tr("c1", "2026-08-10", "u1")],
      "2026-06-01",
    );
    expect(homeroomSinceOf(i, "c1", "u1")).toBe("2026-08-01");
  });

  it("반마다 따로 센다", () => {
    const i = buildHomeroomSinceIndex([tr("c1", "2026-08-10", "u1"), tr("c2", "2026-08-14", "u1")], "2026-06-01");
    expect(homeroomSinceOf(i, "c1", "u1")).toBe("2026-08-10");
    expect(homeroomSinceOf(i, "c2", "u1")).toBe("2026-08-14");
  });
});

describe("resolveTransitionClassId — classId 없는 인계 로그를 반 이름으로 잇기", () => {
  const idx = buildUniqueClassNameIndex([
    { id: "c1", name: "중등M 초6 JJ2A" },
    { id: "c2", name: "쌍둥이" },
    { id: "c3", name: "쌍둥이" },
    { id: "c4", name: null },
  ]);

  it("metadata.classId가 있으면 그걸 쓴다(이름은 안 본다)", () => {
    expect(
      resolveTransitionClassId({ metaClassId: "cX", targetLabel: "중등M 초6 JJ2A", classIdByUniqueName: idx }),
    ).toBe("cX");
  });

  it("🔴 classId가 없으면 반 이름으로 잇는다 — class_handover_apply 실측 전건이 이 경로다", () => {
    expect(
      resolveTransitionClassId({ metaClassId: null, targetLabel: "중등M 초6 JJ2A", classIdByUniqueName: idx }),
    ).toBe("c1");
  });

  it("🔴 이름이 유일하지 않으면 버린다 — 잘못 붙이느니 비운다", () => {
    expect(resolveTransitionClassId({ targetLabel: "쌍둥이", classIdByUniqueName: idx })).toBeNull();
    expect(resolveTransitionClassId({ targetLabel: "없는 반", classIdByUniqueName: idx })).toBeNull();
    expect(resolveTransitionClassId({ classIdByUniqueName: idx })).toBeNull();
  });

  it("이름 인덱스는 중복·빈 이름을 담지 않는다", () => {
    expect(idx.get("중등M 초6 JJ2A")).toBe("c1");
    expect(idx.has("쌍둥이")).toBe(false);
    expect(idx.size).toBe(1);
  });
});
