/**
 * 반 블록 옮기기의 **함께 옮기기** — 적용일 이후 옛 교시에 매달린 기록(수업 계획·학생 기록·미룸 표식·Shouting 체크·자리 이동·
 * 교시 메모)을 새 교시로 함께 옮길 때의 날짜 규칙과 판정(순수 함수 · 서버 `moveClassSlots`가 쓴다).
 * 원장 2026-10-28 *"(가)로 구현"* — 요일이 앞으로 당겨져 같은 주의 새 요일이 적용일보다 앞이면 **다음 주** 그 요일로 보낸다.
 * 🔴 출결은 여기 오지 않는다 — 실제로 찍힌 기록이고 급여로 흐르니 시스템이 고치지 않는다(여전히 막는다).
 * 🔴 덮어쓰지 않는다 — 옮겨 갈 교시에 기록이 이미 있거나, 두 교시의 기록이 한 교시로 모이거나, 배치가 끝나는 날 뒤로 넘어가면 막는다.
 */
import { normalizeSlotPicks, parseSlotPick, slotPickKey } from "@/features/textbooks/lesson-schedule";
import { picksOverlap } from "@/features/textbooks/plan-siblings";

const DAY_INDEX: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** `YYYY-MM-DD` → 요일 키(`mon`…) — UTC 결정적(KST 날짜 문자열 산술의 앱 관례). */
export function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return DAY_KEYS[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
}

/** `YYYY-MM-DD` ± 일수(UTC 결정적). */
export function shiftYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + delta)).toISOString().slice(0, 10);
}

/** 그 주 월요일(수업 시트 메모의 `week_start` 규약 — 주는 월~일). */
export function mondayOf(ymd: string): string {
  return shiftYmd(ymd, -(DAY_INDEX[weekdayOf(ymd)] ?? 0));
}

/** 수업 시트 교시 메모 열쇠(`slot:<날짜>:<HH:MM>` — DB CHECK와 같은 모양). */
export function slotMemoKey(date: string, slot: string): string {
  return `slot:${date}:${slot.slice(0, 5)}`;
}

/** 교시 메모 열쇠 → (날짜, `HH:MM:SS`). 모양이 다르면 null. */
export function parseSlotMemoKey(key: string): { date: string; slot: string } | null {
  const m = /^slot:(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(key);
  return m ? { date: m[1]!, slot: `${m[2]}:00` } : null;
}

/**
 * 옛 요일 → 새 요일로 옮길 때 기록 날짜에 더할 일수(`days`) — **같은 주(월~일) 안의 새 요일**로 간다(시각만 바뀌면 0).
 * (가)안: 그 날짜가 적용일보다 앞이면(새 요일이 앞으로 당겨짐) 7일을 더해 **다음 주** 그 요일로 — 그 줄의 기록이 모두 한 주씩 밀린다
 * (`pushedWeek` — 화면·감사로그가 알린다).
 * 첫 주 하나만 밀면 다음 주 기록과 같은 날로 겹치므로 줄 전체에 같은 값을 쓴다.
 * 🔴 판정은 기록이 아니라 **적용일 이후 첫 옛 요일**로 한다 — 표마다 기록으로 판정하면 계획 줄과 학생 기록이 서로 다른 날로 갈라진다.
 * 예) 목 → 월, 적용일 2026-11-04(수): 11/5(목) → 같은 주 월 11/2는 적용일 앞 → 11/9(월) · 11/12(목) → 11/16(월).
 *     적용일이 그 주 월요일(11/2)이면 11/5 → 11/2(밀림 없음).
 */
export function carryOffset(fromDay: string, toDay: string, effective: string): { days: number; pushedWeek: boolean } {
  const from = DAY_INDEX[fromDay];
  const to = DAY_INDEX[toDay];
  const eff = DAY_INDEX[weekdayOf(effective)];
  if (from === undefined || to === undefined || eff === undefined) throw new Error(`요일 값이 올바르지 않습니다: ${fromDay}→${toDay}`);
  const delta = to - from;
  const firstOld = shiftYmd(effective, (from - eff + 7) % 7);
  return shiftYmd(firstOld, delta) < effective ? { days: delta + 7, pushedWeek: true } : { days: delta, pushedWeek: false };
}

/**
 * 블록(배치 여러 줄)의 날짜 이동 — 줄마다 정한 날짜(`carryOffset`)가 **수업 차례를 지키면 그대로** 쓰고, 뒤집으면 **블록 전체를
 * 한 주** 민다(적대 리뷰 2026-10-28). 줄마다만 정하면 두 요일에 걸친 블록에서 한 요일만 밀려 차례가 뒤집힌다 — 화·금 → 월·목,
 * 적용일 금 11/6이면 금→목만 밀려(11/6 → 11/12) 화 11/10 → 월 11/9가 그보다 앞에 온다 → 모든 줄(제자리 줄 포함)에 7일을 더한다.
 * 반대로 줄별로 이미 차례가 맞는데(목·토 → 토·월, 둘 다 +2일) 블록을 밀면 오히려 차례가 깨진다 — 그래서 먼저 줄별로 본다.
 * `pushed` = 한 주 밀린 줄이 없음 / 일부 / 블록 전체(화면·감사로그 문구).
 */
export function blockCarryOffsets(
  rows: readonly { fromDay: string; toDay: string; fromSlot: string; toSlot: string }[],
  effective: string,
): { days: number[]; pushed: "none" | "some" | "all" } {
  const each = rows.map((r) => carryOffset(r.fromDay, r.toDay, effective));
  const n = each.filter((o) => o.pushedWeek).length;
  if (n === 0) return { days: each.map((o) => o.days), pushed: "none" };
  const days = each.map((o) => o.days);
  if (carryKeepsOrder(rows.map((r, i) => ({ ...r, days: days[i]! })), effective)) {
    return { days, pushed: n === rows.length ? "all" : "some" };
  }
  return { days: each.map((o) => (o.pushedWeek ? o.days : o.days + 7)), pushed: "all" };
}

/**
 * 옮긴 뒤 **비는 회차** — 새 교시 회차 중 옛 회차가 옮겨 오지 않는 날(적대 리뷰 2026-10-28). (가)안은 새 요일의 첫 회차가 옮긴
 * 첫 날짜보다 앞이면 그 회차를 비워 둔다(화→수, 적용일 수 11/4 → 11/4 회차는 비고 화 11/10 계획이 수 11/11로). 배치가 끝나는 날
 * 앞에서 새 요일이 앞당겨지면 마지막 새 회차도 빈다. 교재 계산(`buildLessonSchedule`)은 이 회차에도 차수를 앉혀 실제 줄과 한 칸씩
 * 어긋나므로, 서버가 이 날짜에 **칸 미룸 표식**을 써서 "비운 회차"를 계산에도 알린다.
 * 새 요일 회차 t(적용일~끝나는 날 · 마지막 계획 줄 `horizon`까지)마다 옛 날짜 o = t − `days`를 본다(3차 리뷰 2026-10-28).
 * - `gaps`: t는 수업일인데 o가 [적용일, 끝나는 날] 밖이거나 **휴원일**(옮겨 올 회차가 없다) → 칸 미룸 표식.
 * - `onHoliday`: o는 수업일인데 t가 휴원일 — 그 회차 계획이 휴원일로 가고 계산은 그날을 건너뛰어 뒤 차수가 한 칸씩 어긋난다.
 *   표식으로 맞출 수 없다(막는다).
 * - `straddled`: 적용일 뒤 배정 시작일 S가 o와 t 사이에 낀다(o < S ≤ t 또는 t < S ≤ o) — 그 배정의 첫 회차가 계획 줄과 한 칸
 *   어긋난다. 칸 표식은 같은 칸의 다른 배정까지 밀므로 막는다. (o가 적용일 앞이면 t는 비는 회차라 이미 맞는다.)
 * `horizon` = 그 반의 적용일 이후 마지막 계획 줄 날짜 — 그 뒤엔 맞출 줄이 없다(null이면 아무것도 안 본다).
 */
export function carryGapDates(input: {
  toDay: string;
  days: number;
  effective: string;
  until: string | null;
  horizon: string | null;
  holidays?: Readonly<Record<string, string>> | null;
  starts?: readonly string[];
}): { gaps: string[]; onHoliday: string[]; straddled: string[] } {
  const { toDay, days, effective, until, horizon } = input;
  const out = { gaps: [] as string[], onHoliday: [] as string[], straddled: [] as string[] };
  if (days === 0 || horizon === null) return out;
  const off = (d: string) => Boolean(input.holidays?.[d]);
  const end = until && until < horizon ? until : horizon;
  const starts = (input.starts ?? []).filter((s) => s > effective);
  let t = effective;
  while (weekdayOf(t) !== toDay) t = shiftYmd(t, 1);
  for (; t <= end; t = shiftYmd(t, 7)) {
    const o = shiftYmd(t, -days);
    const oIn = o >= effective && (!until || o <= until);
    if (!off(t) && (!oIn || off(o))) out.gaps.push(t);
    if (off(t) && oIn && !off(o)) out.onHoliday.push(t);
    if (oIn) for (const s of starts) if ((o < s && s <= t) || (t < s && s <= o)) out.straddled.push(s);
  }
  out.straddled = [...new Set(out.straddled)].sort();
  return out;
}

/**
 * 하루 단위(`pace:"day"`)로 세는 배정이 걸린 교시들의 요일이 **하루끼리 그대로 묶여** 가나(3차 리뷰 2026-10-28) — 같은 날 두
 * 교시 중 하나만 다른 요일로 가면(월16·월17 → 월16·화17) 하루가 둘로 갈려 차수가 하나 늘고, 두 요일이 한 요일로 모이면 준다.
 * `pairs` = 그 배정이 고른 교시마다 (옛 요일, 새 요일)(안 옮기는 교시는 같은 요일).
 */
export function dayPaceKeepsDays(pairs: readonly { fromDay: string; toDay: string }[]): boolean {
  const to = new Map<string, string>();
  const from = new Map<string, string>();
  for (const p of pairs) {
    if ((to.get(p.fromDay) ?? p.toDay) !== p.toDay || (from.get(p.toDay) ?? p.fromDay) !== p.fromDay) return false;
    to.set(p.fromDay, p.toDay);
    from.set(p.toDay, p.fromDay);
  }
  return true;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dayNo = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86_400_000);
};

/**
 * 옮긴 뒤에도 **수업 차례가 그대로인가** — 적용일부터 7일 안의 옛 회차(줄마다 하나)를 시간순으로 세운 차례가, 옮긴 회차의
 * 차례와 같고 한 주 안에 들어야 다음 주들도 차례가 같다. `blockCarryOffsets`로 정한 요일 순서대로의 이동이면 언제나 참이고,
 * 요일 순서를 뒤바꾸는 이동(화·금 → 목·월)만 거짓이다 — 서버의 안전장치.
 */
export function carryKeepsOrder(
  rows: readonly { fromDay: string; fromSlot: string; toSlot: string; days: number }[],
  effective: string,
): boolean {
  const eff = DAY_INDEX[weekdayOf(effective)] ?? 0;
  const pts = rows.map((r) => {
    const first = shiftYmd(effective, ((DAY_INDEX[r.fromDay] ?? 0) - eff + 7) % 7);
    return {
      old: dayNo(first) * 1440 + minutesOf(r.fromSlot),
      next: dayNo(shiftYmd(first, r.days)) * 1440 + minutesOf(r.toSlot),
    };
  });
  pts.sort((a, b) => a.old - b.old);
  for (let i = 1; i < pts.length; i++) if (pts[i]!.next <= pts[i - 1]!.next) return false;
  return pts.length < 2 || pts[pts.length - 1]!.next < pts[0]!.next + 7 * 1440;
}

/** 교재 배정의 고른 교시(`class_textbook_plans.slot_picks`, `"요일|HH:MM[|자리]"`) 한 배정. */
export type PicksPlan = { id: string; textbookId: string; startDate: string; picks: readonly string[] };
/** 옮기는 교시 하나(`HH:MM`). */
export type PicksMove = { fromDay: string; fromStart: string; toDay: string; toStart: string };
/** 그 반의 배치(지난 것 포함) — 새 교시를 더하면 지난 회차까지 고르게 되는지 본다. */
export type PicksSchedule = { day: string; start: string; validFrom: string | null; validTo: string | null };
/** `chain` = 막힌 칸이 이 이동의 **출발 칸이기도 하다**(16·17시 → 17·18시처럼 이어지는 교시를 한 칸씩 미는 이동). */
export type PicksConflict = {
  planId: string;
  textbookId: string;
  kind: "dayless" | "taken" | "past" | "full" | "sibling";
  cell: string;
  chain?: boolean;
  /** taken 중 같은 배정이 출발 칸도 골랐는데 자리 번호가 다르다(안내 문구가 다르다). */
  mixed?: boolean;
};

/**
 * 반 블록을 옮길 때 **교재 배정의 고른 교시도 따라가게** — 옛 칸을 고른 배정에 새 칸(같은 자리 번호)을 **더한다**(적대 리뷰 2026-10-28).
 * 안 하면 월간계획이 적용일 이후 그 교재를 새 칸에 앉히지 못하고, 새 칸의 미룸·당김이 종전 방식으로 떨어진다.
 * 🔴 옛 칸은 **지우지 않는다** — `slot_picks`엔 날짜 축이 없고 차수는 배정 시작일부터 칸을 세므로, 지우면 지난 회차가 빠져
 *    앞으로의 차수 번호까지 바뀐다. 옛 칸은 옛 배치가 끝나 적용일 뒤엔 칸이 없다.
 * 🔴 더한 결과가 틀려지는 경우는 **막는다**(덮어쓰지 않는다와 같은 결):
 *    - taken: 배정이 옮겨 갈 칸을 이미 골랐는데(연쇄 이동 16→17·17→18에서 17시만 고른 배정 등) 그 칸으로 오는 교시의 출발 칸은
 *      안 골랐다(또는 자리 번호가 다르다) — 옮긴 뒤 다른 교재의 칸에 차수가 얹힌다.
 *    - past: 더할 칸에 이 반이 배정 시작일 이후 적용일 전에 수업한 적이 있다 — 지난 회차까지 새로 세게 된다.
 *    - dayless: 요일 없는 옛 값(`"17:20"`)이 옮기는 교시를 가리킨다 — 어느 요일을 따라갈지 가를 수 없다.
 *    - full: 0268a 상한(48칸)을 넘는다. sibling: 같은 교재 배정끼리 안 겹치던 교시가 겹치게 된다(plan-siblings 규칙 ②).
 */
export function carrySlotPicks(input: {
  plans: readonly PicksPlan[];
  moves: readonly PicksMove[];
  schedules: readonly PicksSchedule[];
  effective: string;
}): { changes: { id: string; prev: string[]; next: string[] }[]; conflicts: PicksConflict[] } {
  const moves = input.moves.filter((m) => m.fromDay !== m.toDay || m.fromStart !== m.toStart);
  const fromCells = new Set(moves.map((m) => `${m.fromDay}|${m.fromStart}`));
  const changes: { id: string; prev: string[]; next: string[] }[] = [];
  const conflicts: PicksConflict[] = [];
  const nextOf = new Map<string, string[]>();
  for (const p of input.plans) {
    const parsed = p.picks.map((v) => ({ v, p: parseSlotPick(v) })).filter((x) => x.p !== null);
    const keysAt = (day: string, start: string) =>
      parsed.filter((x) => x.p!.dow === day && x.p!.start === start).map((x) => x.p!.pos ?? 0);
    const add: string[] = [];
    const conflict = (kind: PicksConflict["kind"], cell: string, mixed = false) =>
      conflicts.push({
        planId: p.id,
        textbookId: p.textbookId,
        kind,
        cell,
        ...(fromCells.has(cell) ? { chain: true } : {}),
        ...(mixed ? { mixed: true } : {}),
      });
    for (const m of moves) {
      if (parsed.some((x) => x.p!.dow === null && (x.p!.start === m.fromStart || x.p!.start === m.toStart))) {
        conflict("dayless", `${m.fromDay}|${m.fromStart}`);
        continue;
      }
      const src = keysAt(m.fromDay, m.fromStart).sort((a, b) => a - b);
      const dst = keysAt(m.toDay, m.toStart).sort((a, b) => a - b);
      if (dst.length > 0) {
        if (src.join(",") !== dst.join(",")) conflict("taken", `${m.toDay}|${m.toStart}`, src.length > 0);
        continue; // 같은 자리로 이미 골라 두었다 — 더할 것이 없다.
      }
      if (src.length === 0) continue;
      const pastHere = input.schedules.some(
        (s) =>
          s.day === m.toDay &&
          s.start.slice(0, 5) === m.toStart &&
          (s.validFrom === null || s.validFrom < input.effective) &&
          (s.validTo === null || s.validTo >= p.startDate),
      );
      if (pastHere) {
        conflict("past", `${m.toDay}|${m.toStart}`);
        continue;
      }
      for (const pos of src) add.push(slotPickKey(m.toDay, m.toStart, pos || undefined));
    }
    if (add.length === 0) continue;
    const next = normalizeSlotPicks([...p.picks, ...add]);
    if (next.length > 48) conflict("full", "");
    nextOf.set(p.id, next);
    changes.push({ id: p.id, prev: [...p.picks], next });
  }
  // 같은 교재 배정끼리 — 안 겹치던 것이 겹치게 되면 막는다(줄의 주인을 고른 교시로 가르는 규칙이 무너진다).
  for (const a of input.plans) {
    for (const b of input.plans) {
      if (a.id >= b.id || a.textbookId !== b.textbookId) continue;
      const na = nextOf.get(a.id) ?? [...a.picks];
      const nb = nextOf.get(b.id) ?? [...b.picks];
      if (!picksOverlap(a.picks, b.picks) && picksOverlap(na, nb)) {
        conflicts.push({ planId: a.id, textbookId: a.textbookId, kind: "sibling", cell: "" });
      }
    }
  }
  return { changes, conflicts };
}

const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const cellText = (cell: string) => {
  const [d, t] = cell.split("|");
  return d && t ? `${DAY_KO[d] ?? d} ${t}` : "";
};

/**
 * 교재 배정 교시 막힘 안내 — 어느 교재 · 어느 칸 · 무엇을 하면 되는지. `titleOf`가 교재 이름을 준다.
 * 🔑 연쇄 이동(`chain`)은 따로 한 문장 — 교재목록에서 교시를 고쳐도 풀리지 않는다(새 칸이 아직 시간표에 없고, 고른 교시엔 날짜
 *    축이 없어 같은 칸이 적용일 전후로 다른 배정을 가리킬 수 없다). 지금 교시와 겹치지 않는 시각·다른 요일로 옮기면 된다.
 */
export function picksConflictText(conflicts: readonly PicksConflict[], titleOf: (textbookId: string) => string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const chain = conflicts.filter((c) => c.chain);
  if (chain.length > 0) {
    const books = [...new Set(chain.map((c) => `「${titleOf(c.textbookId)}」`))].join("·");
    const cells = [...new Set(chain.map((c) => cellText(c.cell)))].join("·");
    parts.push(
      `이어지는 교시를 한 칸씩 미는 이동이라(${cells}) 교시마다 따로 고른 교재 배정(${books})의 고른 교시를 따라 옮길 수 없습니다 — 옮기면 지난 회차 차수까지 바뀝니다`,
    );
  }
  for (const c of conflicts) {
    if (c.chain) continue;
    const k = `${c.kind}|${c.planId}|${c.cell}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const book = `「${titleOf(c.textbookId)}」`;
    const at = cellText(c.cell);
    parts.push(
      c.kind === "taken" && c.mixed
        ? `${book} 배정이 옮겨 갈 교시(${at})를 다른 자리 번호로 이미 골라 두어 옮기면 자리끼리 차수가 섞입니다`
        : c.kind === "taken"
        ? `${book} 배정이 옮겨 갈 교시(${at})를 이미 골라 두어 옮긴 뒤 다른 교재 칸에 차수가 얹힙니다`
        : c.kind === "past"
          ? `${book} 배정에 ${at} 교시를 더하면 이 반이 전에 그 교시에 한 수업까지 차수로 다시 셉니다`
          : c.kind === "dayless"
            ? `${book} 배정이 요일 없는 옛 교시 값을 써서 어느 요일로 따라갈지 정할 수 없습니다`
            : c.kind === "full"
              ? `${book} 배정의 고른 교시가 48칸을 넘습니다`
              : `같은 교재 ${book}의 두 배정이 같은 교시를 고르게 됩니다`,
    );
  }
  // 교재목록엔 배정의 교시를 고치는 칸이 없다(미리보기·삭제뿐) — 할 수 있는 일만 권한다(적대 리뷰 2026-10-28).
  const todo =
    chain.length === conflicts.length
      ? "지금 교시와 겹치지 않는 시각이나 다른 요일로 옮겨 주세요"
      : "다른 자리로 옮기거나, 그 배정을 지우고 옮긴 뒤 다시 걸어 주세요";
  return `교재 배정의 고른 교시를 새 교시로 이어 붙일 수 없어 옮기지 않았습니다 — ${parts.join(" · ")}. ${todo}`;
}

/** 함께 옮길 기록 한 줄. 교시는 `HH:MM:SS`. */
export type CarryItem = {
  table: string;
  label: string;
  id: string;
  fromDate: string;
  fromSlot: string;
  toDate: string;
  toSlot: string;
  /** 유니크 열쇠의 날짜·교시 밖 칸 값(학생·줄 번호 …)을 이은 것. */
  keyRest: string;
  /** 유니크 열쇠에 교시가 들어가나(자리 이동은 아니다 — 학생·날짜 하나에 한 줄). */
  slotInKey: boolean;
  /** 그 배치가 끝나는 날(새 배치도 같은 날 끝난다) — 없으면 null. */
  until: string | null;
};

/** 옮겨 갈 자리를 이미 차지할 수 있는 기록(같은 반의 그 표 기록 전부 — 옮길 기록 자신도 섞여 와도 된다). */
export type CarryOccupant = { table: string; id: string; date: string; slot: string; keyRest: string; slotInKey: boolean };

export type CarryConflict = { label: string; kind: "occupied" | "merge" | "beyond"; dates: string[] };

const uniqueKey = (table: string, date: string, slot: string, keyRest: string, slotInKey: boolean) =>
  `${table}|${date}|${slotInKey ? slot : ""}|${keyRest}`;
const cellKey = (table: string, date: string, slot: string) => `${table}|${date}|${slot}`;
/** 그 자리를 '차지했다'의 축 — 교시가 열쇠인 표는 교시 칸 전체(다른 학생·다른 줄이어도 그 칸엔 이미 기록이 있다), 자리 이동은 유니크 열쇠. */
const occupyKey = (o: { table: string; date: string; slot: string; keyRest: string; slotInKey: boolean }) =>
  o.slotInKey ? cellKey(o.table, o.date, o.slot) : uniqueKey(o.table, o.date, o.slot, o.keyRest, false);

/**
 * 옮기면 안 되는 경우 — 하나라도 있으면 아무것도 옮기지 않는다.
 * - occupied: 옮겨 갈 자리에 옮기지 않는 기록이 이미 있다(옛 배치의 고아 기록 등 — 덮어쓰지 않는다).
 * - merge: 서로 다른 교시의 기록이 한 교시로 모이거나 유니크 열쇠가 겹친다.
 * - beyond: 옮긴 날짜가 배치가 끝나는 날 뒤다(새 배치가 그날 없어 다시 고아가 된다).
 */
export function carryConflicts(items: readonly CarryItem[], occupants: readonly CarryOccupant[]): CarryConflict[] {
  const out = new Map<string, CarryConflict>();
  const add = (label: string, kind: CarryConflict["kind"], date: string) => {
    const k = `${kind}|${label}`;
    const c = out.get(k) ?? { label, kind, dates: [] };
    if (!c.dates.includes(date)) c.dates.push(date);
    out.set(k, c);
  };
  const moving = new Set(items.map((i) => `${i.table}|${i.id}`));
  const held = new Set(occupants.filter((o) => !moving.has(`${o.table}|${o.id}`)).map(occupyKey));
  const srcOfCell = new Map<string, string>();
  const dstSeen = new Set<string>();
  for (const i of items) {
    if (i.until && i.toDate > i.until) add(i.label, "beyond", i.fromDate);
    if (held.has(occupyKey({ table: i.table, date: i.toDate, slot: i.toSlot, keyRest: i.keyRest, slotInKey: i.slotInKey }))) {
      add(i.label, "occupied", i.toDate);
    }
    const dstCell = cellKey(i.table, i.toDate, i.toSlot);
    const src = cellKey(i.table, i.fromDate, i.fromSlot);
    const dst = uniqueKey(i.table, i.toDate, i.toSlot, i.keyRest, i.slotInKey);
    if ((srcOfCell.get(dstCell) ?? src) !== src || dstSeen.has(dst)) add(i.label, "merge", i.toDate);
    srcOfCell.set(dstCell, src);
    dstSeen.add(dst);
  }
  for (const c of out.values()) c.dates.sort();
  return [...out.values()];
}

/**
 * 옮기는 순서 — 유니크 열쇠가 옮기는 도중에 부딪히지 않게 **자리를 비울 기록부터** 옮긴다(예: 16시→17시·17시→18시를 함께
 * 옮기면 17시 기록이 먼저 18시로 가야 16시 기록이 17시로 들어간다). 한 단계 안의 기록은 서로 무관하다.
 * 되돌릴 땐 단계를 거꾸로 밟으면 된다. 순환이면 null(같은 거리로 함께 옮기는 블록에선 생기지 않는다 — 안전장치).
 */
export function carryRounds(items: readonly CarryItem[]): CarryItem[][] | null {
  const rounds: CarryItem[][] = [];
  let pending = [...items];
  while (pending.length > 0) {
    const srcOwner = new Map(pending.map((i) => [uniqueKey(i.table, i.fromDate, i.fromSlot, i.keyRest, i.slotInKey), i.id]));
    const ready = pending.filter((i) => {
      const owner = srcOwner.get(uniqueKey(i.table, i.toDate, i.toSlot, i.keyRest, i.slotInKey));
      return owner === undefined || owner === i.id;
    });
    if (ready.length === 0) return null;
    rounds.push(ready);
    const done = new Set(ready);
    pending = pending.filter((i) => !done.has(i));
  }
  return rounds;
}

/** 한 단계 안에서 한 번에 쓸 묶음 — 같은 표·같은 도착(날짜, 교시). `carryConflicts`가 통과했으면 출발 칸도 하나다. */
export function carryGroups(round: readonly CarryItem[]): {
  table: string;
  label: string;
  ids: string[];
  fromDate: string;
  fromSlot: string;
  toDate: string;
  toSlot: string;
}[] {
  const groups = new Map<
    string,
    { table: string; label: string; ids: string[]; fromDate: string; fromSlot: string; toDate: string; toSlot: string }
  >();
  for (const i of round) {
    const k = `${i.table}|${i.fromDate}|${i.fromSlot}|${i.toDate}|${i.toSlot}`;
    const g = groups.get(k) ?? {
      table: i.table,
      label: i.label,
      ids: [],
      fromDate: i.fromDate,
      fromSlot: i.fromSlot,
      toDate: i.toDate,
      toSlot: i.toSlot,
    };
    g.ids.push(i.id);
    groups.set(k, g);
  }
  return [...groups.values()];
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
/** `11/9·11/16·11/23 외 1일` — 날짜 목록 표기(되짚기 실패 안내도 쓴다). */
export const dateList = (dates: readonly string[]) =>
  dates.slice(0, 3).map(md).join("·") + (dates.length > 3 ? ` 외 ${dates.length - 3}일` : "");

/**
 * 막힘 안내 — 무엇이 어느 날인지 · 덮어쓰지 않았다는 것 · **종류마다 할 수 있는 일**(적대 리뷰 2026-10-28: 한 문장으로
 * "기록을 확인하거나 적용일을 바꾸라"고 하면 할 수 없는 일을 권한다).
 * - occupied: 막는 기록은 늘 **배치가 없는 교시**에 남은 기록이다(같은 반 배치가 있으면 자리 판정이 먼저 막는다) — 수업 시트가
 *   그 칸을 그리지 않아 화면에서 확인할 수 없다 → 다른 자리로 옮기거나 정리를 요청한다.
 * - merge: 블록을 나누거나 다른 자리로. beyond: 배치 끝나는 날을 늦추거나 그 기록을 먼저 정리한다(적용일을 바꿔도 안 풀릴 수 있다).
 */
export function carryConflictText(conflicts: readonly CarryConflict[]): string {
  const part = (kind: CarryConflict["kind"]) =>
    conflicts
      .filter((c) => c.kind === kind)
      .map((c) => `${c.label} ${dateList(c.dates)}`)
      .join(" · ");
  const parts = [
    part("occupied") &&
      `옮겨 갈 교시에 이미 기록이 있습니다(${part("occupied")}) — 대개 배치가 없는 교시에 남은 기록이라 수업 시트에선 보이지 않을 수 있습니다. 다른 자리로 옮기거나 그 기록 정리를 요청해 주세요`,
    part("merge") && `두 교시의 기록이 한 교시로 겹칩니다(${part("merge")}) — 블록을 나눠 옮기거나 다른 자리로 옮겨 주세요`,
    part("beyond") &&
      `옮기면 배치가 끝나는 날 뒤로 넘어가는 기록이 있습니다(옛 날짜 ${part("beyond")}) — 반 배치가 끝나는 날을 늦추거나 그 기록을 먼저 정리해 주세요`,
  ].filter(Boolean);
  return `기록을 덮어쓰거나 버리지 않으려고 옮기지 않았습니다 — ${parts.join(" · ")}`;
}

/**
 * 함께 옮긴 기록 한 줄(감사로그·화면) — 없으면 null. `plans` = 새 교시를 더한 교재 배정 수 · `gaps` = 비워 둔 회차 날짜
 * (`carryGapDates` — 칸 미룸 표식을 썼다). 한 주 밀림이 블록 전체인지 일부 요일인지(`blockCarryOffsets`) 그대로 읽히게 적는다.
 */
export function carrySummary(
  items: readonly CarryItem[],
  pushed: "none" | "some" | "all",
  plans = 0,
  gaps: readonly string[] = [],
): string | null {
  if (items.length === 0 && plans === 0 && gaps.length === 0) return null;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
  const what = [
    ...[...counts].map(([label, n]) => `${label} ${n}건`),
    ...(plans > 0 ? [`교재 배정 교시 ${plans}개`] : []),
    ...(gaps.length > 0 ? [`비워 둔 회차 ${dateList([...new Set(gaps)].sort())}(미룸 표식)`] : []),
  ].join(" · ");
  const week =
    items.length === 0 || pushed === "none"
      ? ""
      : pushed === "all"
        ? " (새 요일이 적용일보다 앞서 블록의 기록을 모두 한 주 뒤 같은 요일로)"
        : " (새 요일이 적용일보다 앞선 요일의 기록은 한 주 뒤 같은 요일로)";
  return `함께 옮긴 기록: ${what}${week}`;
}
