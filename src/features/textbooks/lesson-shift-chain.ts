/**
 * **회차 미룸·당김이 실제 진도를 옮기는 규칙** — 순수(Vitest).
 *
 * 원장 2026-10-15: *"미룰때 미루는 거기 복사하고 한주씩 쭉 밀기로 했자나"*. 표식(0282a)만 남기고 실제 줄은
 * 그대로 두던 1차 구현은 [월간계획 전체 가져오기]로 이미 채워진 칸에선 **아무것도 안 움직였다**(가져오기는
 * 빈 칸만 채운다) — 얼럿만 뜨고 진도는 그대로였다.
 *
 * 🔑 **줄(chain) = 같은 반 · 같은 요일 · 같은 교시**. 그 요일 그 교시가 다음에 돌아오는 날이 "한 주 뒤"다
 *    (휴일·시간표가 없는 주는 건너뛴다 — 계획 가져오기가 휴일에 차수를 안 넣은 것과 같은 규칙).
 *    요일이 다르면 같은 시각이어도 다른 수업이다(`slotPickKey`가 요일을 붙이는 이유와 같다).
 * · **미룸**: 누른 칸부터 뒤의 칸 내용이 전부 한 칸씩 뒤로 가고 **누른 칸은 비는다**(원장 2026-10-19
 *   *"미루면 해당영역 날리고"* — 2026-10-15의 "누른 칸은 복사해 두기"를 뒤집었다). 실수로 눌렀으면 되돌리기.
 * · **당김**: 누른 칸 내용을 지우고, 뒤의 칸 내용이 전부 한 칸씩 앞으로 온다(미룸의 반대).
 * ⚠️ 빈 칸도 "내용"이다 — 사이에 빈 칸이 있으면 그 빈 칸도 함께 한 칸 움직인다(줄 전체가 평행 이동).
 */

export type ShiftOp =
  /** `from` 칸의 줄을 `to`(비어 있는 칸)로 옮긴다. */
  | { op: "move"; from: string; to: string }
  /** 그 칸의 줄을 지운다 — 당김의 누른 칸. */
  | { op: "clear"; at: string };

export type ShiftPlan =
  | { ok: true; ops: ShiftOp[]; chain: string[] }
  | { ok: false; reason: "no-content" | "no-next-day" | "nothing-after" };

/**
 * @param fromDate   누른 칸의 날짜.
 * @param liveDates  그 요일·교시에 **수업이 있는 날**(휴일 제외, fromDate 이후) — 순서 무관.
 * @param filledDates 그 요일·교시에 **실제 줄이 있는 날**(fromDate 이후) — 순서 무관.
 * 🔴 실제 줄이 있는 날은 수업일 목록에 없어도 줄에 넣는다(휴일에 적은 칸·시간표가 끝난 칸) — 빼면
 *    그 칸을 건너뛰고 옮겨 **같은 칸에 두 벌**이 생기거나 내용이 사라진다.
 */
export function planLessonShift(input: {
  kind: "skip" | "advance";
  fromDate: string;
  liveDates: readonly string[];
  filledDates: readonly string[];
}): ShiftPlan {
  const { kind, fromDate } = input;
  const filled = new Set(input.filledDates.filter((d) => d >= fromDate));
  const chain = [...new Set([fromDate, ...input.liveDates, ...filled])].filter((d) => d >= fromDate).sort();

  let last = -1;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (filled.has(chain[i]!)) {
      last = i;
      break;
    }
  }
  if (last < 0) return { ok: false, reason: "no-content" };

  const ops: ShiftOp[] = [];
  if (kind === "skip") {
    // 마지막 내용이 갈 다음 수업일이 있어야 한다 — 없으면 밀다가 내용 하나가 사라진다.
    if (last + 1 >= chain.length) return { ok: false, reason: "no-next-day" };
    // 🔑 뒤에서부터 옮긴다 — 그래야 옮겨 갈 칸이 언제나 비어 있다(위치 유니크와 안 부딪친다).
    for (let i = last; i >= 0; i -= 1) {
      if (filled.has(chain[i]!)) ops.push({ op: "move", from: chain[i]!, to: chain[i + 1]! });
    }
    return { ok: true, ops, chain: chain.slice(0, last + 2) };
  }

  // 당김 — 누른 칸 뒤에 당겨 올 내용이 없으면 누른 칸만 지워지는 꼴이라 거절한다.
  if (last === 0) return { ok: false, reason: "nothing-after" };
  if (filled.has(chain[0]!)) ops.push({ op: "clear", at: chain[0]! });
  // 앞에서부터 옮긴다 — 앞 칸은 방금 비워졌거나 원래 비어 있다.
  for (let i = 1; i <= last; i += 1) {
    if (filled.has(chain[i]!)) ops.push({ op: "move", from: chain[i]!, to: chain[i - 1]! });
  }
  return { ok: true, ops, chain: chain.slice(0, last + 1) };
}
