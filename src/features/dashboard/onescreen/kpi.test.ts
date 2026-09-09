import { describe, expect, it } from "vitest";
import {
  attendanceTone,
  closedAttendanceRate,
  toneOf,
  todayAttendanceKpi,
  type ClassProgress,
} from "./kpi";

const started = (...ids: string[]) => new Set(ids);
const cls = (classId: string, expected: number, recorded: number): ClassProgress => ({
  classId,
  expected,
  recorded,
});

describe("오늘 출결 타일", () => {
  it("아직 시작 안 한 교시는 분모에 안 들어간다 — 아침부터 빨간 화면을 만들지 않는다", () => {
    const k = todayAttendanceKpi({
      // 오늘 반은 셋인데 시작한 건 A 하나뿐(B·C는 저녁 수업).
      processing: [cls("A", 8, 8), cls("B", 9, 0), cls("C", 7, 0)],
      startedClassIds: started("A"),
    });
    expect(k.startedClasses).toBe(1);
    expect(k.unmarkedClasses).toBe(0);
    expect(k.mode).toBe("closed");
  });

  it("손도 안 댄 반이 있으면 주숫자는 **미기록 반 수**다(출석률이 아니라)", () => {
    const k = todayAttendanceKpi({
      processing: [cls("A", 8, 8), cls("B", 9, 0), cls("C", 7, 3)],
      startedClassIds: started("A", "B", "C"),
    });
    expect(k.mode).toBe("unmarked");
    expect(k.unmarkedClasses).toBe(1); // B
    expect(k.inProgressClasses).toBe(2); // B(0/9) + C(3/7)
    expect(attendanceTone(k)).toBe("caution");
  });

  it("🔴 진행 중에는 출석률을 내주지 않는다 — 40/121 반의 98%는 거짓 안심이다", () => {
    const k = todayAttendanceKpi({
      processing: [cls("A", 10, 10), cls("B", 10, 0)],
      startedClassIds: started("A", "B"),
    });
    expect(closedAttendanceRate(k, { rate: 98, date: "2026-09-09" }, "2026-09-09")).toBe(null);
  });

  it("시작한 반이 전부 찍히면 그때 출석률을 적는다", () => {
    const k = todayAttendanceKpi({
      processing: [cls("A", 10, 10), cls("B", 6, 6)],
      startedClassIds: started("A", "B"),
    });
    expect(k.mode).toBe("closed");
    expect(closedAttendanceRate(k, { rate: 93, date: "2026-09-09" }, "2026-09-09")).toBe(93);
    expect(attendanceTone(k)).toBe("positive");
  });

  it("어제 스냅샷으로 오늘 출석률을 적지 않는다", () => {
    const k = todayAttendanceKpi({ processing: [cls("A", 10, 10)], startedClassIds: started("A") });
    expect(closedAttendanceRate(k, { rate: 93, date: "2026-09-08" }, "2026-09-09")).toBe(null);
  });

  it("오늘 시작한 수업이 없으면 '다 했다'가 아니라 '잴 것이 없다'", () => {
    const k = todayAttendanceKpi({ processing: [cls("A", 8, 0)], startedClassIds: started() });
    expect(k.mode).toBe("none");
    // 🔴 초록(positive)이 아니다 — 휴일과 '전부 완료'가 같은 색이면 원장이 구분을 못 한다.
    expect(attendanceTone(k)).toBe("inert");
  });

  it("예정 0명인 반은 분모에서 뺀다 — 영영 안 채워지는 반이 남는다", () => {
    const k = todayAttendanceKpi({
      processing: [cls("A", 0, 0), cls("B", 5, 5)],
      startedClassIds: started("A", "B"),
    });
    expect(k.startedClasses).toBe(1);
    expect(k.mode).toBe("closed");
  });

  it("보강 방문자로 기록이 예정을 넘어도 100%를 넘지 않는다", () => {
    // 보강 온 학생이 그 반에 찍히면 recorded > expected가 된다(실제로 일어난다).
    const k = todayAttendanceKpi({
      processing: [cls("A", 5, 7), cls("B", 5, 5)],
      startedClassIds: started("A", "B"),
    });
    expect(k.recorded).toBe(10);
    expect(k.expected).toBe(10);
    expect(k.mode).toBe("closed");
  });
});

describe("실패·낡은 값의 톤", () => {
  it("갱신에 실패한 값은 초록으로 그리지 않는다", () => {
    const fresh = { value: 1, at: 0, stale: false };
    const stale = { value: 1, at: 0, stale: true };
    expect(toneOf(fresh, "positive")).toBe("positive");
    expect(toneOf(stale, "positive")).toBe("inert");
    // 아예 못 읽은 것도 마찬가지 — "정상"으로 보이는 것이 이 화면의 최악이다.
    expect(toneOf(null, "positive")).toBe("inert");
  });
});
