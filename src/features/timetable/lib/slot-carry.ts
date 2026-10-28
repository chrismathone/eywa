/**
 * 반 블록 옮기기의 **함께 옮기기** — 적용일 이후 옛 교시에 매달린 기록(수업 계획·학생 기록·미룸 표식·Shouting 체크·자리 이동·
 * 교시 메모)을 새 교시로 함께 옮길 때의 날짜 규칙과 판정(순수 함수 · 서버 `moveClassSlots`가 쓴다).
 * 원장 2026-10-28 *"(가)로 구현"* — 요일이 앞으로 당겨져 같은 주의 새 요일이 적용일보다 앞이면 **다음 주** 그 요일로 보낸다.
 * 🔴 출결은 여기 오지 않는다 — 실제로 찍힌 기록이고 급여로 흐르니 시스템이 고치지 않는다(여전히 막는다).
 * 🔴 덮어쓰지 않는다 — 옮겨 갈 교시에 기록이 이미 있거나, 두 교시의 기록이 한 교시로 모이거나, 배치가 끝나는 날 뒤로 넘어가면 막는다.
 */

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
  ids: string[];
  fromDate: string;
  fromSlot: string;
  toDate: string;
  toSlot: string;
}[] {
  const groups = new Map<string, { table: string; ids: string[]; fromDate: string; fromSlot: string; toDate: string; toSlot: string }>();
  for (const i of round) {
    const k = `${i.table}|${i.fromDate}|${i.fromSlot}|${i.toDate}|${i.toSlot}`;
    const g = groups.get(k) ?? { table: i.table, ids: [], fromDate: i.fromDate, fromSlot: i.fromSlot, toDate: i.toDate, toSlot: i.toSlot };
    g.ids.push(i.id);
    groups.set(k, g);
  }
  return [...groups.values()];
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const dateList = (dates: readonly string[]) =>
  dates.slice(0, 3).map(md).join("·") + (dates.length > 3 ? ` 외 ${dates.length - 3}일` : "");

/** 막힘 안내 — 무엇이 어느 날인지 · 덮어쓰지 않았다는 것. */
export function carryConflictText(conflicts: readonly CarryConflict[]): string {
  const part = (kind: CarryConflict["kind"]) =>
    conflicts
      .filter((c) => c.kind === kind)
      .map((c) => `${c.label} ${dateList(c.dates)}`)
      .join(" · ");
  const parts = [
    part("occupied") && `옮겨 갈 교시에 이미 기록이 있습니다(${part("occupied")})`,
    part("merge") && `두 교시의 기록이 한 교시로 겹칩니다(${part("merge")})`,
    part("beyond") && `옮기면 배치가 끝나는 날 뒤로 넘어가는 기록이 있습니다(옛 날짜 ${part("beyond")})`,
  ].filter(Boolean);
  return `${parts.join(" · ")} — 기록을 덮어쓰거나 버리지 않으려고 옮기지 않았습니다. 그 날짜의 기록을 확인하거나 적용일을 바꿔 주세요`;
}

/** 함께 옮긴 기록 한 줄(감사로그·화면) — 없으면 null. */
export function carrySummary(items: readonly CarryItem[], pushedWeek: boolean): string | null {
  if (items.length === 0) return null;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
  const what = [...counts].map(([label, n]) => `${label} ${n}건`).join(" · ");
  return `함께 옮긴 기록: ${what}${pushedWeek ? " (새 요일이 앞당겨져 한 주 뒤 같은 요일로)" : ""}`;
}
