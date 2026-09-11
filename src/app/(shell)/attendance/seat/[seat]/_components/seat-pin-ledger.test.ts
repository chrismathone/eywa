import { describe, expect, it } from "vitest";
import {
  beginSeatPinCall,
  beginSeatPinClassClear,
  dropSeatPinAsk,
  EMPTY_SEAT_PIN_LEDGER,
  queueSeatPinAsk,
  seatPinTargetOf,
  settleSeatPinCall,
  type SeatPinAsk,
  type SeatPinLedger,
} from "./seat-pin-ledger";

/**
 * 고정 질문 + 교시 호출 장부의 **순수 규칙** — 창엔 맨 앞 하나만 서고(원장 *"한번 드래그한 학생은 … 고정할까요?"라고
 * 물어볼것"*), 거짓이 된 질문은 줄에 서지 않고, 서버에 남은 이동의 질문은 사라지지 않는다. 화면 배선(왕복 사이 끈 카드 ·
 * [해제] · 늦게 온 응답 · 보기/날짜 전환)은 `seat-all-day.test.tsx`.
 */

const DATE = "2026-09-11";
const ask = (classId: string, studentId: string, toSlot: string, date = DATE): SeatPinAsk => ({
  seat: "lab",
  date,
  classId,
  studentId,
  name: studentId,
  fromSlot: "15:00",
  toSlot,
});

/** 호출 하나를 보내고 번호를 돌려준다. */
function begin(l: SeatPinLedger, a: SeatPinAsk) {
  return beginSeatPinCall(l, seatPinTargetOf(a));
}
function settle(l: SeatPinLedger, a: SeatPinAsk, seq: number, outcome: Parameters<typeof settleSeatPinCall>[3]) {
  return settleSeatPinCall(l, seatPinTargetOf(a), seq, outcome);
}

describe("질문 줄", () => {
  it("다른 학생의 질문은 줄 끝에 선다 · 같은 과녁은 그 자리에서 새 질문으로 바뀐다 · 다른 날의 같은 학생은 따로 선다", () => {
    const a = ask("PL1b", "y", "15:40");
    const b = ask("LE1", "b", "16:20");
    const a2 = ask("PL1b", "y", "16:20");
    const aNextDay = ask("PL1b", "y", "15:40", "2026-09-12");
    expect(queueSeatPinAsk([a], b)).toEqual([a, b]);
    expect(queueSeatPinAsk([a, b], a2)).toEqual([a2, b]);
    expect(queueSeatPinAsk([a, b], aNextDay)).toEqual([a, b, aNextDay]);
  });

  it("답한 질문은 **본 그 질문**(참조)만 빠진다", () => {
    const a = ask("PL1b", "y", "15:40");
    const a2 = ask("PL1b", "y", "16:20");
    const b = ask("LE1", "b", "16:20");
    expect(dropSeatPinAsk([a, b], a)).toEqual([b]);
    expect(dropSeatPinAsk([a2, b], a)).toEqual([a2, b]);
    expect(dropSeatPinAsk([a, b], { ...a })).toEqual([a, b]);
  });
});

describe("호출 장부", () => {
  it("마지막 호출이 받아지면 그 질문이 줄에 선다", () => {
    const a = ask("PL1b", "y", "15:40");
    const r = begin(EMPTY_SEAT_PIN_LEDGER, a);
    const s = settle(r.ledger, a, r.seq, { ok: true, ask: a });
    expect(s.latest).toBe(true);
    expect(s.ledger.asks).toEqual([a]);
  });

  it("🔴 호출하는 순간 그 과녁의 질문만 숨는다 — 같은 반의 다른 학생 · 다른 반의 같은 학생 · 다른 날은 남는다", () => {
    const y = ask("PL1b", "y", "15:40");
    const z = ask("PL1b", "z", "15:40");
    const yElsewhere = ask("LE1", "y", "16:20");
    const yNextDay = ask("PL1b", "y", "15:40", "2026-09-12");
    const l: SeatPinLedger = { asks: [y, z, yElsewhere, yNextDay], calls: {} };
    expect(begin(l, ask("PL1b", "y", "16:20")).ledger.asks).toEqual([z, yElsewhere, yNextDay]);
  });

  it("🔴 뒤 호출이 거절되면 **숨긴 질문이 돌아온다** — 서버엔 앞 이동이 그대로 남았다(적대 리뷰 2026-09-11)", () => {
    const a1 = ask("PL1b", "y", "15:40");
    const a2 = ask("PL1b", "y", "16:20");
    // ① 앞 이동이 받아져 질문이 섰다 → ② 같은 학생을 또 옮긴다(숨는다) → ② 거절.
    let l = begin(EMPTY_SEAT_PIN_LEDGER, a1).ledger;
    l = settle(l, a1, 1, { ok: true, ask: a1 }).ledger;
    const r2 = begin(l, a2);
    expect(r2.ledger.asks).toEqual([]);
    const s2 = settle(r2.ledger, a2, r2.seq, { ok: false });
    expect(s2.latest).toBe(true);
    expect(s2.ledger.asks).toEqual([a1]);
  });

  it("🔴 앞 호출이 응답 전이어도 — 앞이 받아지고 뒤가 거절되면 앞 질문이 선다(번호가 밀렸다고 버리지 않는다)", () => {
    const a1 = ask("PL1b", "y", "15:40");
    const a2 = ask("PL1b", "y", "16:20");
    const r1 = begin(EMPTY_SEAT_PIN_LEDGER, a1);
    const r2 = begin(r1.ledger, a2);
    const s1 = settle(r2.ledger, a1, r1.seq, { ok: true, ask: a1 });
    expect(s1.latest).toBe(false);
    expect(s1.ledger.asks).toEqual([]);
    const s2 = settle(s1.ledger, a2, r2.seq, { ok: false });
    expect(s2.ledger.asks).toEqual([a1]);
  });

  it("뒤 호출이 받아지면 숨긴 질문은 버리고 새 질문만 선다", () => {
    const a1 = ask("PL1b", "y", "15:40");
    const a2 = ask("PL1b", "y", "16:20");
    const r1 = begin(EMPTY_SEAT_PIN_LEDGER, a1);
    const r2 = begin(r1.ledger, a2);
    const s1 = settle(r2.ledger, a1, r1.seq, { ok: true, ask: a1 });
    expect(settle(s1.ledger, a2, r2.seq, { ok: true, ask: a2 }).ledger.asks).toEqual([a2]);
    // 묻지 않는 이동(고정된 제 교시로 되돌리기)이 받아지면 아무것도 안 선다.
    expect(settle(s1.ledger, a2, r2.seq, { ok: true, ask: null }).ledger.asks).toEqual([]);
  });

  it("🔴 마지막 호출이 받아지면 숨긴 질문은 **버린다** — 그 뒤 호출이 거절돼도 버린 질문이 되살아나지 않는다", () => {
    const a1 = ask("PL1b", "y", "15:40");
    const home = ask("PL1b", "y", "15:00");
    const a3 = ask("PL1b", "y", "16:20");
    // ① 15:40 받아짐(질문) → ② 고정된 제 교시로 되돌리기(묻지 않음) 받아짐 → ③ 16:20 거절.
    // 서버의 마지막 상태는 ②(제 교시)다 — ①의 "…15:40로 옮겼습니다" 창이 다시 서면 거짓이다.
    let l = settle(begin(EMPTY_SEAT_PIN_LEDGER, a1).ledger, a1, 1, { ok: true, ask: a1 }).ledger;
    const r2 = begin(l, home);
    l = settle(r2.ledger, home, r2.seq, { ok: true, ask: null }).ledger;
    expect(l.asks).toEqual([]);
    const r3 = begin(l, a3);
    expect(settle(r3.ledger, a3, r3.seq, { ok: false }).ledger.asks).toEqual([]);
  });

  it("🔴 받아진 앞 호출이 **물을 것 없는** 상태를 만들었으면, 뒤 호출이 거절돼도 더 옛 질문을 되살리지 않는다", () => {
    const a1 = ask("PL1b", "y", "15:40");
    const home = ask("PL1b", "y", "15:00");
    const a3 = ask("PL1b", "y", "16:20");
    // ① 15:40 받아짐(질문) → ② 고정된 제 교시로 되돌리기(묻지 않음) → ③ 16:20 — ② 받아짐 · ③ 거절.
    let l = settle(begin(EMPTY_SEAT_PIN_LEDGER, a1).ledger, a1, 1, { ok: true, ask: a1 }).ledger;
    const r2 = begin(l, home);
    const r3 = begin(r2.ledger, a3);
    l = settle(r3.ledger, home, r2.seq, { ok: true, ask: null }).ledger;
    expect(settle(l, a3, r3.seq, { ok: false }).ledger.asks).toEqual([]);
  });

  it("🔴 뒤 호출이 이미 돌아온 뒤 늦게 온 앞 응답은 아무것도 바꾸지 않는다", () => {
    const a1 = ask("PL1b", "y", "15:40");
    const home = ask("PL1b", "y", "15:00");
    const r1 = begin(EMPTY_SEAT_PIN_LEDGER, a1);
    const r2 = begin(r1.ledger, home);
    const s2 = settle(r2.ledger, home, r2.seq, { ok: true, ask: null });
    const late = settle(s2.ledger, a1, r1.seq, { ok: true, ask: a1 });
    expect(late.latest).toBe(false);
    expect(late.ledger.asks).toEqual([]);
    // 그 뒤 새 호출이 거절돼도 늦게 온 옛 질문이 숨어 있다가 돌아오지 않는다.
    const r3 = begin(late.ledger, a1);
    expect(settle(r3.ledger, a1, r3.seq, { ok: false }).ledger.asks).toEqual([]);
  });

  it("번호는 과녁마다 따로다 — 같은 반 다른 학생의 호출은 서로를 옛 것으로 만들지 않는다", () => {
    const y = ask("PL1b", "y", "15:40");
    const z = ask("PL1b", "z", "15:40");
    const ry = begin(EMPTY_SEAT_PIN_LEDGER, y);
    const rz = begin(ry.ledger, z);
    const sz = settle(rz.ledger, z, rz.seq, { ok: true, ask: z });
    const sy = settle(sz.ledger, y, ry.seq, { ok: true, ask: y });
    expect(sy.latest).toBe(true);
    expect(sy.ledger.asks).toEqual([z, y]);
  });
});

describe("[해제]", () => {
  it("🔴 그 반의 질문을 전부 숨긴다 — 다른 반·다른 날은 남는다 · 받아지면 버리고, 거절되면 되살린다", () => {
    const y = ask("PL1b", "y", "15:40");
    const z = ask("PL1b", "z", "15:40");
    const b = ask("LE1", "b", "16:20");
    const yNextDay = ask("PL1b", "y", "15:40", "2026-09-12");
    let l = EMPTY_SEAT_PIN_LEDGER;
    for (const a of [y, b, z, yNextDay]) l = settle(begin(l, a).ledger, a, 1, { ok: true, ask: a }).ledger;
    expect(l.asks).toEqual([y, b, z, yNextDay]);
    const clear = beginSeatPinClassClear(l, { seat: "lab", date: DATE, classId: "PL1b" });
    expect(clear.ledger.asks).toEqual([b, yNextDay]);
    expect(clear.calls.map((c) => c.target.studentId).sort()).toEqual(["y", "z"]);

    let ok = clear.ledger;
    for (const c of clear.calls) ok = settleSeatPinCall(ok, c.target, c.seq, { ok: true, ask: null }).ledger;
    expect(ok.asks).toEqual([b, yNextDay]);

    let failed = clear.ledger;
    for (const c of clear.calls) failed = settleSeatPinCall(failed, c.target, c.seq, { ok: false }).ledger;
    expect(failed.asks).toEqual([b, yNextDay, y, z]);
  });

  it("🔴 아직 오는 중인 그 반 이동의 응답은 옛 것이 된다 — 다른 반 응답은 그대로 질문을 싣는다", () => {
    const y = ask("PL1b", "y", "15:40");
    const b = ask("LE1", "b", "16:20");
    const ry = begin(EMPTY_SEAT_PIN_LEDGER, y);
    const rb = begin(ry.ledger, b);
    const clear = beginSeatPinClassClear(rb.ledger, { seat: "lab", date: DATE, classId: "PL1b" });
    let l = clear.ledger;
    for (const c of clear.calls) l = settleSeatPinCall(l, c.target, c.seq, { ok: true, ask: null }).ledger;
    const sy = settle(l, y, ry.seq, { ok: true, ask: y });
    expect(sy.latest).toBe(false);
    const sb = settle(sy.ledger, b, rb.seq, { ok: true, ask: b });
    expect(sb.latest).toBe(true);
    expect(sb.ledger.asks).toEqual([b]);
  });
});
