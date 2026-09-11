import { describe, expect, it } from "vitest";
import { SEAT_MOVE_MARKED_ERROR } from "./placement";
import { SEAT_PERIOD_CLASS_BUSY, SEAT_PERIOD_SAME } from "./period-choice";
import {
  SEAT_DROP_GUIDE,
  SEAT_PERIOD_LOCKED,
  seatDragHint,
  seatDropOkText,
  seatDropVerdict,
  type SeatDropInputs,
} from "./drop-verdict";
import type { SeatStudentClass } from "./student-classes";

/**
 * 드래그 한 번의 가부 — 원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임. 같은 시간대의
 * 수업으로 옮기고 싶은게 아니야."* · *"아니 드래그는 '전체' 에서도 다른 시간으로 이동하려고하면 경고 문구 뜨면서 안됨"*.
 *
 * 실측(읽기 전용, injaewon 2026-09-11 금): 랩실 교시 14:20·15:00·15:40·16:20·17:00·17:40(각 40분).
 * 이도윤B(PL1b) = PL1b 14:20~15:00 원어민 수업(본원606) → 15:00 랩실 → 수학 `초등M 초4 EL2S` 16:20~17:15·17:15~18:10.
 * 이 학생이 옮겨 갈 수 있는 곳은 **15:40 하나**다 — 14:20은 반 축(PL1b 정규), 16:20·17:00·17:40은 학생 축(수학).
 */
const STARTS = ["14:20", "15:00", "15:40", "16:20", "17:00", "17:40"];
const plus40 = (s: string): string => {
  const [h, m] = s.split(":").map(Number);
  const t = h! * 60 + m! + 40;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const cls = (classId: string, className: string, start: string, end: string): SeatStudentClass => ({
  classId,
  className,
  start,
  end,
  room: null,
  seatLabel: null,
});
const DOYUN: SeatStudentClass[] = [
  cls("PL1b", "PL1b", "14:20", "15:00"),
  cls("EL2S", "초등M 초4 EL2S", "16:20", "17:15"),
  cls("EL2S", "초등M 초4 EL2S", "17:15", "18:10"),
];

const inputs = (over: Partial<SeatDropInputs> = {}): SeatDropInputs => ({
  canMove: true,
  periodStarts: STARTS,
  endsByStart: Object.fromEntries(STARTS.map((s) => [s, [plus40(s)]])),
  slotsByClass: { PL1b: ["15:00"] },
  busyStartsByClass: { PL1b: ["14:20"] },
  studentClasses: { y: DOYUN },
  ...over,
});
const card = { studentId: "y", homeClassId: "PL1b", start: "15:00", marked: false };
const clash = (range: string) =>
  `그 시각에 이 학생의 다른 수업(초등M 초4 EL2S ${range})이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다`;

describe("드래그 한 번의 가부 — 이도윤B 금 15:00 랩실", () => {
  it("🔴 같은 시간 = 제자리 — 막힌 게 아니라 취소(`same`, 빗금을 치지 않는다)", () => {
    expect(seatDropVerdict(card, "15:00", inputs())).toEqual({ kind: "same", text: SEAT_PERIOD_SAME });
  });

  it("그 반의 정규 수업 시각(14:20)은 반 축으로 막힌다", () => {
    expect(seatDropVerdict(card, "14:20", inputs())).toEqual({ kind: "blocked", text: SEAT_PERIOD_CLASS_BUSY });
  });

  it("🔑 15:40은 옮길 수 있다 — 16:20 수학과는 경계만 닿는다", () => {
    expect(seatDropVerdict(card, "15:40", inputs())).toEqual({ kind: "ok", text: seatDropOkText("15:40") });
  });

  it("🔴 16:20·17:00·17:40은 학생 축으로 막힌다 — 그 시각 수학을 적는다", () => {
    expect(seatDropVerdict(card, "16:20", inputs())).toEqual({ kind: "blocked", text: clash("16:20~17:15") });
    expect(seatDropVerdict(card, "17:00", inputs())).toEqual({ kind: "blocked", text: clash("16:20~17:15") });
    expect(seatDropVerdict(card, "17:40", inputs())).toEqual({ kind: "blocked", text: clash("17:15~18:10") });
  });

  it("학생 축 재료가 없으면(모름) 화면은 막지 않는다 — 서버가 자기 조회로 다시 본다", () => {
    expect(seatDropVerdict(card, "16:20", inputs({ studentClasses: undefined })).kind).toBe("ok");
    // 재료는 있어도 이 학생 키가 없으면(조회 대상 밖) 역시 모름이다.
    expect(seatDropVerdict(card, "16:20", inputs({ studentClasses: {} })).kind).toBe("ok");
  });

  it("🔴 목표 교시 **안에서 시작하는** 수업도 막는다 — 교시 끝(`endsByStart`)이 판정까지 가야 보인다", () => {
    // 17:00~17:40 랩실로 옮기려는데 17:20에 시작하는 수업이 있다 — 시작이 같지도, 그 수업이 17:00을 품지도 않는다.
    const late = inputs({ studentClasses: { y: [cls("MX", "수학 보충", "17:20", "18:10")] } });
    expect(seatDropVerdict(card, "17:00", late)).toEqual({
      kind: "blocked",
      text: "그 시각에 이 학생의 다른 수업(수학 보충 17:20~18:10)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다",
    });
    // 교시 끝을 모르면 이 모양은 판정할 수 없다(모르는 것으로 막지 않는다) — 끝을 빠뜨리면 화면·서버가 함께 통과시킨다.
    expect(seatDropVerdict(card, "17:00", { ...late, endsByStart: {} }).kind).toBe("ok");
  });

  it("그날 이 자리에 없는 교시는 막힌다(지어낸 교시로 옮기지 않는다)", () => {
    expect(seatDropVerdict(card, "19:00", inputs()).kind).toBe("blocked");
  });

  it("잠긴 화면이면 다른 교시는 전부 막히고, 제자리는 여전히 취소다", () => {
    const locked = inputs({ canMove: false });
    expect(seatDropVerdict(card, "15:40", locked)).toEqual({ kind: "blocked", text: SEAT_PERIOD_LOCKED });
    expect(seatDropVerdict(card, "15:00", locked).kind).toBe("same");
  });

  it("🔴 찍힌 카드는 다른 교시가 전부 막힌다 — 같은 문장(`seatMoveBlockReason`)", () => {
    const marked = { ...card, marked: true };
    expect(seatDropVerdict(marked, "15:40", inputs())).toEqual({ kind: "blocked", text: SEAT_MOVE_MARKED_ERROR });
    expect(seatDropVerdict(marked, "15:00", inputs()).kind).toBe("same");
  });
});

describe("끄는 카드 아래 한 줄 — 놓을 곳의 판정을 그대로 옮겨 적는다", () => {
  it("놓을 곳 밖이면 어디에 놓을지부터 안내한다", () => {
    expect(seatDragHint(null)).toEqual({ text: SEAT_DROP_GUIDE, ok: null });
  });

  it("제자리는 안내(행동 아님) · 되는 곳·막힌 곳은 판정 문장 그대로", () => {
    expect(seatDragHint(seatDropVerdict(card, "15:00", inputs()))).toEqual({ text: SEAT_PERIOD_SAME, ok: null });
    expect(seatDragHint(seatDropVerdict(card, "15:40", inputs()))).toEqual({ text: "15:40 수업으로 옮기기", ok: true });
    expect(seatDragHint(seatDropVerdict(card, "16:20", inputs()))).toEqual({ text: clash("16:20~17:15"), ok: false });
  });
});
