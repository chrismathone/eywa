import type { SeatKey } from "@/features/attendance/seat/seat";

/**
 * 고정 질문 + 교시 호출 장부 — **순수 규칙**(React·서버 없음). 가게(store)는 [`seat-pin-ask.tsx`](./seat-pin-ask.tsx),
 * 배선은 [`seat-all-day.tsx`](./seat-all-day.tsx), 화면 동작 잠금은 `seat-all-day.test.tsx`.
 *
 * 원장 2026-09-10 *"한번 드래그한 학생은 '다음에도 이 LAB실 수업을 이 시간대로 고정할까요?'라고 물어볼것"*.
 *
 * 🔑 질문은 서버가 이동을 받아 준 **뒤에** 선다(창 문장이 "옮겼습니다"라서). 그래서 왕복 사이에 벌어지는 일이 질문을
 *    바꾼다 — 다음 카드를 끌었거나, 같은 학생을 또 옮겼거나, 그 반을 [해제]했다. 그 규칙을 이 파일 하나가 정한다.
 * 🔴 **(자리|날짜|반|학생) 한 칸마다** 따로 센다 — 반 단위로 뭉치면 같은 반 두 학생이 서로의 질문을 삼키고 낙관 반영을
 *    되돌리지 못한다(적대 리뷰 2026-09-11).
 * 🔴 옛 질문은 **지우지 않고 숨긴다**(`stash`) — 뒤 호출이 서버에서 거절되면 서버에 남은 앞 이동의 질문이 **돌아와야**
 *    한다(지우면 영영 안 뜬다 — 적대 리뷰 2026-09-11). 뒤 호출이 받아지면 버린다.
 */

/** 드래그가 끝나고 물어볼 고정 — 그날 이동은 이미 반영된 뒤다. 🔴 **자리·날짜를 싣는다** — 다른 날 화면에서 답해도 그날로 보낸다. */
export type SeatPinAsk = {
  seat: SeatKey;
  date: string;
  studentId: string;
  classId: string;
  name: string;
  fromSlot: string;
  toSlot: string;
};

/** 호출 한 줄의 과녁 — (자리|날짜|반|학생). */
export type SeatPinTarget = Pick<SeatPinAsk, "seat" | "date" | "classId" | "studentId">;

/** 과녁 키 — 질문과 호출이 같은 키를 쓴다. */
export function seatPinKey(t: SeatPinTarget): string {
  return `${t.seat}|${t.date}|${t.classId}|${t.studentId}`;
}

/** 질문(또는 과녁을 품은 값)에서 과녁만 떼어 낸다 — 호출이 그 질문의 **자리·날짜**로 가게. */
export function seatPinTargetOf(t: SeatPinTarget): SeatPinTarget {
  return { seat: t.seat, date: t.date, classId: t.classId, studentId: t.studentId };
}

type Entry = {
  target: SeatPinTarget;
  /** 마지막으로 보낸 호출 번호. 응답의 번호가 이것과 같아야 그 응답이 화면(질문·낙관 반영 되돌리기)을 정한다. */
  seq: number;
  /** 돌아온 호출 중 가장 큰 번호 — 뒤 호출이 이미 돌아왔는데 늦게 온 앞 응답이 숨긴 질문을 바꾸지 않게. */
  resolved: number;
  /**
   * 뒤 호출이 도는 동안 **숨겨 둔** 질문 = 서버가 마지막으로 받아 준 이동의 질문(`ask: null` = 받아 준 마지막 상태엔
   * 물을 것이 없다 — 고정된 제 교시로 되돌렸거나 [해제]가 받아졌다). `seq` = 그 상태를 만든 호출 번호.
   */
  stash: { ask: SeatPinAsk | null; seq: number } | null;
};

export type SeatPinLedger = {
  /** 창에 띄울 질문 줄 — 맨 앞 하나만 선다. */
  asks: readonly SeatPinAsk[];
  calls: Readonly<Record<string, Entry>>;
};

export const EMPTY_SEAT_PIN_LEDGER: SeatPinLedger = { asks: [], calls: {} };

/**
 * 질문 줄에 하나를 더한다 — 같은 과녁의 옛 질문은 **그 자리에서** 새 질문으로 바꾼다(줄 끝으로 밀려 순서가 뒤집히지 않게).
 * 🔴 한 칸이 아니라 줄이다 — 한 칸이면 왕복 사이 끈 다음 카드의 질문이 앞 질문을 덮어 앞 학생은 답을 못 받는다.
 */
export function queueSeatPinAsk(queue: readonly SeatPinAsk[], next: SeatPinAsk): SeatPinAsk[] {
  const k = seatPinKey(next);
  const i = queue.findIndex((a) => seatPinKey(a) === k);
  if (i === -1) return [...queue, next];
  const out = [...queue];
  out[i] = next;
  return out;
}

/** 답한 질문 하나를 뺀다 — **본 그 질문**(참조)만. */
export function dropSeatPinAsk(queue: readonly SeatPinAsk[], done: SeatPinAsk): SeatPinAsk[] {
  return queue.filter((a) => a !== done);
}

/**
 * 그 과녁으로 호출을 **보낸다** — 번호를 올리고, 줄에 선 그 과녁의 질문은 숨긴다(`stash`, 지우지 않는다).
 * 🔴 숨기는 이유: 새 호출이 끝나기 전의 옛 문장("…로 옮겼습니다")은 이제 거짓일 수 있다. 🔴 지우지 않는 이유: 새 호출이
 *    거절되면 서버엔 옛 이동이 그대로 남아 그 질문이 다시 참이 된다.
 */
export function beginSeatPinCall(ledger: SeatPinLedger, target: SeatPinTarget): { ledger: SeatPinLedger; seq: number } {
  const k = seatPinKey(target);
  const e: Entry = ledger.calls[k] ?? { target, seq: 0, resolved: 0, stash: null };
  const queued = ledger.asks.find((a) => seatPinKey(a) === k);
  const seq = e.seq + 1;
  return {
    seq,
    ledger: {
      asks: queued ? dropSeatPinAsk(ledger.asks, queued) : ledger.asks,
      calls: {
        ...ledger.calls,
        // 줄에 선 질문 = 이미 돌아온 호출이 만든 것이다(번호 = `resolved`).
        [k]: { ...e, seq, stash: queued ? { ask: queued, seq: e.resolved } : e.stash },
      },
    },
  };
}

/**
 * [해제] — 그 반의 과녁 **전부**로 호출을 보낸다(물을 것 없는 호출). 이 반의 질문이 숨고, 아직 오는 중인 앞 이동의 응답은
 * 옛 것이 된다. 🔴 다른 반·다른 날은 건드리지 않는다(그 반 응답의 질문까지 삼키게 된다).
 */
export function beginSeatPinClassClear(
  ledger: SeatPinLedger,
  scope: Pick<SeatPinTarget, "seat" | "date" | "classId">,
): { ledger: SeatPinLedger; calls: { target: SeatPinTarget; seq: number }[] } {
  const targets = Object.values(ledger.calls)
    .map((e) => e.target)
    .filter((t) => t.seat === scope.seat && t.date === scope.date && t.classId === scope.classId);
  const calls: { target: SeatPinTarget; seq: number }[] = [];
  let next = ledger;
  for (const target of targets) {
    const r = beginSeatPinCall(next, target);
    next = r.ledger;
    calls.push({ target, seq: r.seq });
  }
  return { ledger: next, calls };
}

/** 응답 한 건 — 받아졌으면 그 호출이 낳은 질문(없으면 null), 거절됐으면 `ok: false`. */
export type SeatPinOutcome = { ok: true; ask: SeatPinAsk | null } | { ok: false };

/**
 * 응답이 **돌아왔다** — `latest`면 이 응답이 화면을 정한다(질문을 싣거나 되살리고, 거절이면 낙관 반영을 되돌린다).
 *
 * - 마지막 호출이 받아짐 → 숨긴 질문은 버리고 이 호출의 질문(있으면)을 줄에 싣는다.
 * - 마지막 호출이 거절됨 → 서버엔 숨긴 질문의 이동이 그대로 남았다 → **숨긴 질문을 되살린다**.
 * - 앞선 호출이 받아짐(뒤 호출이 아직 안 돌아옴) → 이 이동이 서버의 새 마지막 상태다 → 숨긴 질문을 이것으로 바꾼다
 *   (물을 것 없는 호출이면 null — 옛 질문은 이제 거짓이다).
 * - 앞선 호출이 거절됨, 또는 뒤 호출이 이미 돌아온 뒤 늦게 온 응답 → 장부만 적고 그대로 둔다.
 */
export function settleSeatPinCall(
  ledger: SeatPinLedger,
  target: SeatPinTarget,
  seq: number,
  outcome: SeatPinOutcome,
): { ledger: SeatPinLedger; latest: boolean } {
  const k = seatPinKey(target);
  const e = ledger.calls[k];
  if (!e) return { ledger, latest: false };
  const resolved = Math.max(e.resolved, seq);
  if (seq === e.seq) {
    const back = outcome.ok ? outcome.ask : (e.stash?.ask ?? null);
    return {
      latest: true,
      ledger: {
        asks: back ? queueSeatPinAsk(ledger.asks, back) : ledger.asks,
        calls: { ...ledger.calls, [k]: { ...e, resolved, stash: null } },
      },
    };
  }
  const newerOut = e.resolved < e.seq;
  const stash = outcome.ok && newerOut && seq > (e.stash?.seq ?? -1) ? { ask: outcome.ask, seq } : e.stash;
  return { latest: false, ledger: { asks: ledger.asks, calls: { ...ledger.calls, [k]: { ...e, resolved, stash } } } };
}
