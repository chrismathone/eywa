import { describe, expect, it } from "vitest";
import { ATTENDANCE_GRACE_MIN } from "./signals";
import {
  canDeskMark,
  crossNotifyDirection,
  deskMarkDeniedReason,
  shouldEnforceDeskGate,
  deskWriteDenied,
  isArrivalStatus,
  isUnmarkedToArrival,
  seatMarkOf,
  shortSeatName,
} from "./mark-state";

describe("ATTENDANCE_GRACE_MIN", () => {
  it("원장 지시 그대로 10분 — 한 곳의 상수", () => {
    expect(ATTENDANCE_GRACE_MIN).toBe(10);
  });
});

describe("seatMarkOf", () => {
  it("기록이 있으면 그 값(출석·결석·지각)", () => {
    expect(seatMarkOf("present", "due")).toBe("present");
    expect(seatMarkOf("absent", "grace")).toBe("absent");
    expect(seatMarkOf("late", "before")).toBe("late");
  });

  it("보강은 출석, 공결은 결석, 조퇴는 지각 칸(5색 안에 흡수)", () => {
    expect(seatMarkOf("makeup", "due")).toBe("present");
    expect(seatMarkOf("excused", "due")).toBe("absent");
    expect(seatMarkOf("early_leave", "due")).toBe("late");
  });

  it("시작 전·유예 안의 빈 칸은 대기 — 미출결이 아니다", () => {
    expect(seatMarkOf(null, "before")).toBe("waiting");
    expect(seatMarkOf(null, "grace")).toBe("waiting");
  });

  it("유예 경과·종료 뒤 빈 칸이 미출결", () => {
    expect(seatMarkOf(null, "due")).toBe("unmarked");
    expect(seatMarkOf(null, "ended")).toBe("unmarked");
  });
});

describe("canDeskMark", () => {
  it("유예 경과 뒤의 빈 칸만", () => {
    expect(canDeskMark(null, "due")).toBe(true);
    expect(canDeskMark(null, "ended")).toBe(true);
  });

  it("유예 안·시작 전은 강사 몫", () => {
    expect(canDeskMark(null, "before")).toBe(false);
    expect(canDeskMark(null, "grace")).toBe(false);
  });

  it("이미 찍힌 칸은 덮지 못한다", () => {
    expect(canDeskMark("present", "due")).toBe(false);
    expect(canDeskMark("absent", "ended")).toBe(false);
    expect(canDeskMark("late", "due")).toBe(false);
  });

  it("거절 메시지는 한글 — raw phase를 내보내지 않는다", () => {
    expect(deskMarkDeniedReason("present", "due")).toMatch(/이미 입력된/);
    expect(deskMarkDeniedReason(null, "grace")).toMatch(/10분/);
    expect(deskMarkDeniedReason(null, "due")).toBeNull();
  });
});

describe("shouldEnforceDeskGate", () => {
  it("당일 출결 화면만 켠다 — 없으면 월간 격자가 종전 권한", () => {
    expect(shouldEnforceDeskGate("live")).toBe(true);
    expect(shouldEnforceDeskGate(undefined)).toBe(false);
    expect(shouldEnforceDeskGate(null)).toBe(false);
    expect(shouldEnforceDeskGate("grid")).toBe(false);
  });
});

describe("deskWriteDenied", () => {
  const desk = (over: Parameters<typeof deskWriteDenied>[0]) => deskWriteDenied(over);

  it("(a) 플래그 없는 경로 — 담당이 아닌 master가 기존 기록의 status를 바꿀 수 있다", () => {
    expect(
      desk({ via: "desk", currentStatus: "absent", nextStatus: "present", phase: "ended" }),
    ).toBeNull();
    expect(
      desk({
        source: undefined,
        via: "desk",
        currentStatus: "present",
        nextStatus: "late",
        phase: "due",
      }),
    ).toBeNull();
  });

  it("(b) 플래그 없는 경로 — 기존 기록을 삭제할 수 있다", () => {
    expect(
      desk({ via: "desk", currentStatus: "present", nextStatus: null, phase: "ended" }),
    ).toBeNull();
    expect(
      desk({ via: "desk", currentStatus: "absent", nextStatus: null, phase: "grace" }),
    ).toBeNull();
  });

  it("(c) source:live — 미출결 칸만, 유예가 지난 뒤에만", () => {
    expect(
      desk({
        source: "live",
        via: "desk",
        currentStatus: null,
        nextStatus: "present",
        phase: "due",
      }),
    ).toBeNull();
    expect(
      desk({
        source: "live",
        via: "desk",
        currentStatus: null,
        nextStatus: "absent",
        phase: "ended",
      }),
    ).toBeNull();
    expect(
      desk({
        source: "live",
        via: "desk",
        currentStatus: null,
        nextStatus: "present",
        phase: "grace",
      }),
    ).toMatch(/10분/);
    expect(
      desk({
        source: "live",
        via: "desk",
        currentStatus: null,
        nextStatus: "present",
        phase: "before",
      }),
    ).toMatch(/시작 전/);
    expect(
      desk({
        source: "live",
        via: "desk",
        currentStatus: "absent",
        nextStatus: "present",
        phase: "ended",
      }),
    ).toMatch(/이미 입력된/);
    expect(
      desk({
        source: "live",
        via: "desk",
        currentStatus: "present",
        nextStatus: null,
        phase: "ended",
      }),
    ).toMatch(/지울 수 없습니다/);
  });
});

describe("미출결 → 출결 전이", () => {
  it("빈 칸에 출석·지각이 찍히면 전이", () => {
    expect(isUnmarkedToArrival(null, "present")).toBe(true);
    expect(isUnmarkedToArrival(null, "late")).toBe(true);
  });

  it("결석으로 바꾸는 건 이 알림이 아니다", () => {
    expect(isUnmarkedToArrival(null, "absent")).toBe(false);
  });

  it("이미 있던 칸을 고치는 건 전이가 아니다", () => {
    expect(isUnmarkedToArrival("absent", "present")).toBe(false);
    expect(isUnmarkedToArrival("present", "present")).toBe(false);
  });

  it("출결 = 왔다(출석·지각·조퇴·보강)", () => {
    expect(isArrivalStatus("present")).toBe(true);
    expect(isArrivalStatus("late")).toBe(true);
    expect(isArrivalStatus("absent")).toBe(false);
    expect(isArrivalStatus(null)).toBe(false);
  });
});

describe("교차 알림 방향", () => {
  it("데스크가 찍으면 강사에게, 강사가 찍으면 데스크에게", () => {
    expect(crossNotifyDirection("desk")).toBe("to_teacher");
    expect(crossNotifyDirection("teacher")).toBe("to_desk");
  });

  it("자리·키오스크는 이 알림이 아니다", () => {
    expect(crossNotifyDirection("seat")).toBeNull();
    expect(crossNotifyDirection("kiosk")).toBeNull();
  });
});

describe("shortSeatName", () => {
  it("한국 이름 3자는 그대로, 길면 앞 3자", () => {
    expect(shortSeatName("김철수")).toBe("김철수");
    expect(shortSeatName("남궁민수")).toBe("남궁민");
    expect(shortSeatName("  Jo  ")).toBe("Jo");
  });
});
