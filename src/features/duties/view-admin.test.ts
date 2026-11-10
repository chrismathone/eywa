import { describe, expect, it } from "vitest";
import { adminRange, buildAttention, cellOf, cellTitle, cellTone, distinctStudents, earlyDoneOf, progressText, foldMatrixRows, lateByKind, lateLabel, pctOf, upcomingOf, type Counts, type LateItem, type RollupOwnerKind, dutyTier } from "./view-admin";

/** 셈 한 묶음 — total · done · due(기한 온 것) · ontime(제때) · late(지금 지연). 나머지는 0에서 덮어쓴다. */
const c = (total: number, done: number, due: number, ontime: number, late = 0, o: Partial<Counts> = {}): Counts => ({ total, done, due, ontime, late, lateDone: 0, expired: 0, over7: 0, ...o });
const ok = (o: Partial<RollupOwnerKind>): RollupOwnerKind => ({ ownerId: "t1", subject: "math", kind: "attendance", period: "daily", ...c(10, 9, 10, 9, 1), ...o });
const OWNERS = { t1: "한지우", t2: "문예린" };
const NOW = Date.parse("2026-11-10T09:00:00.000Z");

describe("adminRange", () => {
  it("오늘 · 이번 주(월요일 시작) · 이번 달(1일~오늘) · 지난 달(1일~말일)", () => {
    expect(adminRange("today", "2026-11-10")).toMatchObject({ from: "2026-11-10", to: "2026-11-10" });
    expect(adminRange("week", "2026-11-10")).toMatchObject({ from: "2026-11-09", to: "2026-11-10" });
    expect(adminRange("month", "2026-11-10")).toMatchObject({ from: "2026-11-01", to: "2026-11-10" });
    expect(adminRange("prevMonth", "2026-11-10")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "2026년 10월" });
    expect(adminRange("prevMonth", "2026-01-05")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("기한 준수율 · 칸 색", () => {
  it("🔴 준수율 = 기한 도래 것 중 준수 끝낸 비율 — 기한 전 의무는 분모에 안 든다", () => {
    // 월 상담 30건(말일 기한) 중 3건만 했어도, 기한 도래 것이 없으면 판정하지 않는다.
    expect(pctOf(c(30, 3, 0, 0))).toBeNull();
    // 출결 10건이 기한이 왔고 8건 준수 · 1건 지연 완료 · 1건 지금 지연 = 80%(늦게 끝낸 것은 분모에만).
    expect(pctOf(c(40, 12, 10, 8, 1, { lateDone: 1 }))).toBe(80);
  });
  it("칸 색 — 해당 없음 · 기한 온 것 3건 미만은 중립(평가 대기) · 그 밖은 등급의 색 묶음", () => {
    expect(cellTone(cellOf(c(0, 0, 0, 0)))).toBe("none");
    expect(cellTone(cellOf(c(30, 3, 0, 0)))).toBe("wait");
    expect(cellTone(cellOf(c(5, 0, 2, 0, 2)))).toBe("wait");
    expect(cellTone(cellOf(c(10, 9, 10, 9, 1)))).toBe("good");
    expect(cellTone(cellOf(c(10, 7, 10, 7, 3)))).toBe("warn");
    expect(cellTone(cellOf(c(10, 6, 10, 6, 4)))).toBe("warn");
    expect(cellTone(cellOf(c(10, 5, 10, 5, 5)))).toBe("bad");
  });
  it("등급 경계 — 96 · 89 · 77 · 60 · 40 · 23 · 11 · 4(로열티의 누적 비율과 같은 수)", () => {
    expect([100, 96, 95, 89, 88, 77, 76, 60, 59, 40, 39, 23, 22, 11, 10, 4, 3, 0].map(dutyTier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
  });
  it("기한 전 남은 것 · 칸 설명은 숫자의 뜻을 글로", () => {
    const x = c(40, 12, 10, 8, 1, { lateDone: 1 });
    expect(upcomingOf(x)).toBe(27);
    expect(cellTitle(x)).toBe("기한 도래 10건 중 준수 8건 · 지연 1 · 지연 완료 1 · 기한 전 27 · 조기 완료 3");
    expect(cellTitle(c(30, 0, 0, 0))).toBe("기한 도래 없음 · 기한 전 30");
    // 🔴 기한 전에 다 끝낸 종류 — '예정 0'이 아니라 진행 5/5.
    expect([upcomingOf(c(5, 5, 0, 0)), earlyDoneOf(c(5, 5, 0, 0)), progressText(c(5, 5, 0, 0))]).toEqual([0, 5, "5/5"]);
  });
  it("전체 줄 = 보이는 줄의 합", () => {
    const rows = [{ ownerId: "t1", name: "한지우", cells: { attendance: cellOf(c(10, 10, 10, 10)) }, all: cellOf(c(10, 10, 10, 10)) }, { ownerId: "t2", name: "문예린", cells: { attendance: cellOf(c(10, 5, 10, 5, 5)) }, all: cellOf(c(10, 5, 10, 5, 5)) }];
    expect(foldMatrixRows(rows)).toMatchObject({ name: "전체", all: { due: 20, ontime: 15, late: 5, pct: 75 } });
    expect(foldMatrixRows([])).toBeNull();
  });
});

describe("buildAttention · lateByKind", () => {
  const late = (o: Partial<LateItem>): LateItem => ({ id: Math.random().toString(36).slice(2), kind: "report_write", period: "daily", cycle: "2026-11-09", status: "open", dueAt: "2026-11-09T15:00:00.000Z", doneAt: null, voidReason: null,
    school: "경명여중", grade: "중1", studentId: "s1", studentName: "김하준", classId: "c1", className: "중2 A", subject: "math", escalation: 1, ownerId: "t1", inherited: false, ...o });
  it("담당자 × 반 × 학생으로 묶고 오래된 것 먼저 · 요약은 종류별 수 · 반 알림장은 반 단위", () => {
    const rows = buildAttention([
      late({}), late({ kind: "attendance", dueAt: "2026-11-08T15:00:00.000Z" }), late({}),
      late({ studentId: "s2", studentName: "이서아", ownerId: "t2", dueAt: "2026-11-01T15:00:00.000Z" }),
      late({ studentId: null, studentName: null, classId: "e1", className: "LE2", subject: "english" }),
    ], OWNERS, undefined, NOW);
    expect(rows.map((r) => [r.title, r.count, r.days])).toEqual([["이서아", 1, 8], ["김하준", 3, 1], ["LE2", 1, 0]]);
    expect(rows[1]).toMatchObject({ sub: "경명여중1", teacher: "한지우", className: "중2 A", summary: "수업보고서 작성 2 · 출결 입력 1", oldest: "2026-11-08T15:00:00.000Z" });
    expect(rows[2]!.sub).toBe("반 알림장");
  });
  it("🔴 같은 학생이라도 담당자가 다르면 따로 — 다른 선생님 몫이 한 사람에게 붙지 않는다", () => {
    const rows = buildAttention([late({ ownerId: "t1", subject: "math" }), late({ ownerId: "t2", subject: "english", classId: "e1", className: "LE2", kind: "counsel_monthly" })], OWNERS, undefined, NOW);
    expect(rows.map((r) => [r.teacher, r.summary]).sort()).toEqual([["문예린", "월 학부모 상담 1"], ["한지우", "수업보고서 작성 1"]].sort());
    expect(distinctStudents(rows)).toBe(1);
  });
  it("과목 거르기 — undefined = 전부 · null = 과목 없는 것만 · 글자 = 그 과목", () => {
    const items = [late({}), late({ subject: "english" }), late({ subject: null })];
    expect(buildAttention(items, OWNERS, "math", NOW)).toHaveLength(1);
    expect(buildAttention(items, OWNERS, undefined, NOW).reduce((n, r) => n + r.count, 0)).toBe(3);
    const rows = [ok({ kind: "report_write", late: 12 }), ok({ kind: "attendance", late: 3 }), ok({ subject: "english", kind: "attendance", late: 1 }), ok({ subject: null, kind: "attendance", late: 2 })];
    expect(lateByKind(rows, undefined)).toBe("수업보고서 작성 12 · 출결 입력 6");
    expect(lateByKind(rows, "math")).toBe("수업보고서 작성 12 · 출결 입력 3");
    expect(lateByKind(rows, null)).toBe("출결 입력 2");
  });
  it("지연 표식 = 실제 지난 날 수", () => {
    expect([0, 1, 2, 3, 6, 7, 30].map(lateLabel)).toEqual(["1일 미만", "1일", "2일", "3일 이상", "3일 이상", "7일 이상", "7일 이상"]);
  });
});
