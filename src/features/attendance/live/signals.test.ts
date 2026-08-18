import { describe, expect, it } from "vitest";
import {
  classifySignal,
  hhmm,
  hhmmToMin,
  ATTENDANCE_GRACE_MIN,
  resolveSlotStatus,
  shouldQueue,
  shouldQueueWithRequest,
  slotPhase,
} from "./signals";

describe("slotPhase", () => {
  const start = 16 * 60 + 20; // 16:20
  const end = 17 * 60 + 20;

  it("시작 전은 before", () => {
    expect(slotPhase(start - 1, start, end)).toBe("before");
  });

  it("시작 직후 유예 안은 grace", () => {
    expect(slotPhase(start, start, end)).toBe("grace");
    expect(slotPhase(start + ATTENDANCE_GRACE_MIN - 1, start, end)).toBe("grace");
  });

  it("유예를 넘기면 due", () => {
    expect(slotPhase(start + ATTENDANCE_GRACE_MIN, start, end)).toBe("due");
  });

  it("종료시각부터 ended", () => {
    expect(slotPhase(end, start, end)).toBe("ended");
    expect(slotPhase(end + 120, start, end)).toBe("ended");
  });

  it("종료시각을 모르면 끝난 척하지 않는다", () => {
    expect(slotPhase(start + 600, start, null)).toBe("due");
  });
});

describe("classifySignal", () => {
  it("강사가 찍은 결석은 사실이라 즉시 신호", () => {
    expect(classifySignal("absent", true)).toBe("absent");
    expect(classifySignal("absent", false)).toBe("absent");
  });

  it("강사가 답한 칸은 신호가 아니다 — 지각도 '왔다'는 뜻", () => {
    for (const s of ["present", "late", "excused", "makeup", "early_leave"]) {
      expect(classifySignal(s, true), s).toBeNull();
    }
  });

  it("같은 교시에 다른 기록이 있으면 이 학생만 빈 칸 = unmarked", () => {
    expect(classifySignal(null, true)).toBe("unmarked");
  });

  it("그 교시가 통째로 비어 있으면 학생이 아니라 강사 미체크", () => {
    expect(classifySignal(null, false)).toBe("class_unmarked");
  });
});

describe("shouldQueue", () => {
  it("시작 전에는 어떤 신호도 큐에 올리지 않는다", () => {
    expect(shouldQueue("absent", "before")).toBe(false);
    expect(shouldQueue("unmarked", "before")).toBe(false);
  });

  it("결석은 유예를 기다리지 않는다", () => {
    expect(shouldQueue("absent", "grace")).toBe(true);
  });

  it("미확인은 유예를 넘긴 뒤부터", () => {
    expect(shouldQueue("unmarked", "grace")).toBe(false);
    expect(shouldQueue("unmarked", "due")).toBe(true);
    expect(shouldQueue("unmarked", "ended")).toBe(true);
  });
});

describe("shouldQueueWithRequest — 강사의 데스크 확인 요청(역방향 버튼)", () => {
  it("요청이 있으면 유예를 건너뛴다 — 강사가 교실을 보고 지목한 것은 오탐이 아니다", () => {
    expect(shouldQueueWithRequest("unmarked", "grace", true)).toBe(true);
    expect(shouldQueueWithRequest("class_unmarked", "grace", true)).toBe(true);
  });

  it("요청이 없으면 shouldQueue와 완전히 같다", () => {
    expect(shouldQueueWithRequest("unmarked", "grace", false)).toBe(false);
    expect(shouldQueueWithRequest("unmarked", "due", false)).toBe(true);
    expect(shouldQueueWithRequest("absent", "grace", false)).toBe(true);
  });

  it("시작 전(before)은 요청이 있어도 제외 — 아직 안 온 게 정상이다", () => {
    expect(shouldQueueWithRequest("unmarked", "before", true)).toBe(false);
    expect(shouldQueueWithRequest("class_unmarked", "before", true)).toBe(false);
  });
});

describe("resolveSlotStatus", () => {
  it("교시별 기록이 그날 전체 기록을 이긴다", () => {
    expect(resolveSlotStatus("absent", "present")).toBe("absent");
  });

  it("교시별이 없으면 그날 전체로 폴백 — 원스크린에서 찍은 게 당일 출석부에도 보여야 한다", () => {
    expect(resolveSlotStatus(null, "present")).toBe("present");
    expect(resolveSlotStatus(undefined, "present")).toBe("present");
  });

  it("둘 다 없으면 미기록", () => {
    expect(resolveSlotStatus(null, null)).toBeNull();
  });
});

describe("시각 파싱", () => {
  it("HH:MM[:SS] → 분", () => {
    expect(hhmmToMin("16:20")).toBe(980);
    expect(hhmmToMin("16:20:00")).toBe(980);
    expect(hhmmToMin("00:00")).toBe(0);
  });

  it("형식이 아니면 null(0으로 접지 않는다 — 자정으로 오인하면 온종일 due가 된다)", () => {
    expect(hhmmToMin("")).toBeNull();
    expect(hhmmToMin(null)).toBeNull();
    expect(hhmmToMin("교시")).toBeNull();
    expect(hhmmToMin("99:99")).toBeNull();
  });

  it("표시용은 초를 자르되 알 수 없는 값은 원문 보존", () => {
    expect(hhmm("16:20:00")).toBe("16:20");
    expect(hhmm("이상한값")).toBe("이상한값");
    expect(hhmm(null)).toBe("");
  });
});
