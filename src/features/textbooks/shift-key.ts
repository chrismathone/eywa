/**
 * **회차 미룸·당김 표식의 키** — 순수(Vitest). 표식을 읽고 쓰는 모든 자리가 이 모양 하나를 쓴다.
 *
 * 원장 2026-10-20 *"미룸 당김을 수업이 2개면 각각 미룸, 당김 버튼이 활성화되어야"* — 한 교시에 25분 차수가
 * 둘이면(같은 교재 1·2차수, 또는 교재 둘) 줄마다 따로 민다. 그래서 표식이 **칸(날짜·교시)** 에서
 * **칸 · 교재 · 자리(그 교시의 몇 번째 25분)** 로 좁아졌다(0381a `lane`·`pos`).
 *
 * · 칸 표식(옛 모양, 0282a) = `"YYYY-MM-DD|HH:MM"` — 그 교시를 **통째로** 미루거나 당긴다(교재 전부).
 *   0381a 적용 전의 표식이 전부 이 모양이고, 적용 뒤에도 그대로 읽는다(`lane = ''`, `pos = 0`).
 * · 줄 표식(새 모양) = `"YYYY-MM-DD|HH:MM|<교재 id>|<자리>"` — 그 교재의 그 자리 **한 차수만**.
 * 🔑 문자열 순서가 곧 시간 순서다(같은 교재끼리) — `placeShiftMarker`가 그 순서로 "다음 빈 자리"를 찾는다.
 */
export type ShiftKind = "skip" | "advance";

/** 한 교시에 들어가는 차수 자리의 상한 — `MAX_SLOT_POSITION`(lesson-schedule)과 같은 값. */
export const LANE_SLOTS = 4;
/**
 * 키의 `pos` 상한 — **같은 자리를 여러 번 당기면** 쌓을 칸이 필요하다(원장 2026-10-20 제보 *"안당겨지고"*: 같은 줄을
 * 두 번 당기면 두 번째가 **다음 자리**에 걸려, 누른 줄은 그대로고 엉뚱한 차수가 사라졌다).
 * 🔑 `pos = 자리 + 4×(k−1)` = 그 자리의 k번째 당김. 자리는 `physicalPos`로 되짚는다(유니크 한 축에 그대로 담긴다).
 *    미룸은 쌓지 않는다(자리를 비우는 것은 한 번이면 끝이다) — 미룸 키는 언제나 1~4.
 */
export const MAX_LANE_POS = LANE_SLOTS * 5;

/** 키의 `pos` → 그 교시의 실제 차수 자리(1~4). */
export function physicalPos(pos: number): number {
  return ((pos - 1) % LANE_SLOTS) + 1;
}

/** 그 자리에 쌓인 당김 키들(앞 → 뒤). 미룸 키는 안 담는다. */
export function advanceStackAt(
  shifts: Readonly<Record<string, ShiftKind>>,
  date: string,
  slot: string,
  lane: string,
  pos: number,
): string[] {
  const out: string[] = [];
  for (let p = pos; p <= MAX_LANE_POS; p += LANE_SLOTS) {
    const key = laneMarkerKey(date, slot, lane, p);
    if (shifts[key] === "advance") out.push(key);
  }
  return out;
}

/** 그 자리에 당김을 하나 더 쌓을 빈 키 — 꽉 찼으면 null. */
export function nextAdvanceStackKey(
  shifts: Readonly<Record<string, ShiftKind>>,
  date: string,
  slot: string,
  lane: string,
  pos: number,
): string | null {
  for (let p = pos; p <= MAX_LANE_POS; p += LANE_SLOTS) {
    const key = laneMarkerKey(date, slot, lane, p);
    if (!shifts[key]) return key;
  }
  return null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^[0-2]\d:[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MarkerKeyParts = { date: string; slot: string; lane: string; pos: number };

export function cellMarkerKey(date: string, slot: string): string {
  return `${date}|${slot}`;
}

export function laneMarkerKey(date: string, slot: string, lane: string, pos: number): string {
  return `${date}|${slot}|${lane}|${pos}`;
}

/** 키 → 부분. 칸 표식은 `lane: ''`·`pos: 0`. 모양이 틀리면 null(클라가 들고 온 되돌리기 기록도 이걸로 거른다). */
export function parseMarkerKey(key: string): MarkerKeyParts | null {
  const parts = String(key ?? "").split("|");
  if (parts.length !== 2 && parts.length !== 4) return null;
  const [date, slot, lane, posRaw] = parts as [string, string, string?, string?];
  if (!YMD.test(date) || !HHMM.test(slot)) return null;
  if (parts.length === 2) return { date, slot, lane: "", pos: 0 };
  const pos = Number(posRaw);
  if (!UUID.test(lane!) || !Number.isInteger(pos) || pos < 1 || pos > MAX_LANE_POS || String(pos) !== posRaw) return null;
  return { date, slot, lane: lane!.toLowerCase(), pos };
}

/** DB 행 → 키. 0381a 전 행(또는 그 전 조회)은 `lane`·`pos`가 없어 칸 표식이다. */
export function markerKeyOfRow(r: Readonly<Record<string, unknown>>): string {
  const date = String(r.plan_date).slice(0, 10);
  const slot = String(r.slot_start).slice(0, 5);
  const lane = String(r.lane ?? "");
  const pos = Number(r.pos ?? 0);
  return lane !== "" && pos > 0 ? laneMarkerKey(date, slot, lane, pos) : cellMarkerKey(date, slot);
}

/** 그 칸(날짜·교시)의 표식인가 — 칸 표식이든 줄 표식이든. */
export function isMarkerAtCell(key: string, date: string, slot: string): boolean {
  return key === cellMarkerKey(date, slot) || key.startsWith(`${date}|${slot}|`);
}

/**
 * 화면 표시용 **칸 단위** 요약 — 그 칸에 **미룸이 하나라도 있으면 미룸**, 아니면 당김. 계산엔 쓰지 않는다
 * (계산은 키 그대로 — `buildLessonSchedule`). 🔑 미룸이 이기는 이유: 이 값이 "미뤄 비운 칸의 [당김]"을 세우는
 * 문이다 — 한 칸에 당김·미룸이 섞여 있을 때 당김으로 접으면 걷을 미룸이 있는데 버튼이 사라진다(적대적 리뷰 2026-10-20).
 */
export function cellShiftSummary(markers: Readonly<Record<string, ShiftKind>>): Record<string, ShiftKind> {
  const out: Record<string, ShiftKind> = {};
  for (const [key, kind] of Object.entries(markers)) {
    const p = parseMarkerKey(key);
    if (!p) continue;
    const cell = cellMarkerKey(p.date, p.slot);
    if (kind === "skip" || !out[cell]) out[cell] = kind;
  }
  return out;
}
