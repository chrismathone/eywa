/**
 * 통합뷰 교시축 접기 — **긴 교시를 짧은 교시 여러 칸에 걸쳐** 그린다(원장 2026-09-07).
 *
 * *"40분씩 수업하는게 수요일이고, 1시간씩 수업하는게 화금인데, 둘이 한교시당 시간이 달라서 저렇게 되는데,
 *  그러면 1시간수업을 40분 단위 수업이랑 맞추기 위해서 1.5칸에 표시해줄 수 없나? … 1500-1600과 1600-1700
 *  행을 좌측 시간대에 따로 표시 안해도 될거같은데"*
 *
 * 영어 교시표엔 두 체계가 섞여 있다(EiE 40분 · 인재원 60분, [[#106]]). 한 줄에 두 체계의 반이 서면 축이
 * 두 벌 서고(6행) 각 반은 자기 것이 아닌 행에서 빈 칸이 되어, 화면에 **가운데가 텅 빈 줄**이 남는다.
 *
 * 규칙:
 *  ① **다른 행들로 덮이는 행은 축에서 감춘다** — 긴 것부터 본다(안 그러면 40분 행이 60분 행에 덮여 사라진다).
 *  ② 감춘 행의 칸은 **남은 눈금 위 제자리**에 놓는다 — 시작 위치(offset)와 길이(span)를 남은 행 단위로 계산.
 *     15:00~16:00은 40분 눈금에서 15:00 행 **처음부터 1.5칸**이고, 16:00~17:00은 15:40 행의 **절반부터 1.5칸**이다.
 *
 * 🔴 이 계획은 **화면 전용**이다 — `periodRows` 자체는 건드리지 않는다. 엑셀 내보내기가 같은 배열을 축으로
 *    쓰는데(injaewon-integrated-sheet), 행을 지우면 그 시각의 수업이 **에러 없이 통째로 빠진다**(칸은
 *    `${order}:${day}`로 찾으므로 축에 없는 order는 아무 데도 안 그려진다).
 * 🔴 덮이지 않는 행은 그대로 둔다 — "혼자 도는 60분 반"은 접을 근거가 없다(접으면 그 반이 사라진다).
 * ⚠️ 시각이 없는 행(주말 섹션은 `time`을 비운다)은 판정에서 빠진다 — 범위를 모르면 접지 않는다.
 */

export type SpanRow = { order: number; time: string };

/** 감춘 행이 놓일 자리 — `order`=놓일 행, `offset`·`span`=그 행 높이 기준(1 = 한 칸). */
export type MovedSpan = { order: number; offset: number; span: number };

export type RowSpanPlan = {
  /** 축에서 감출 행 order. */
  hidden: number[];
  /**
   * 감춘 행 order(문자열 키) → 놓일 자리.
   * ⚠️ Map이 아니라 **평범한 객체** — 서버 컴포넌트가 클라 컴포넌트로 넘기는 값이라 직렬화돼야 한다.
   */
  moved: Record<string, MovedSpan>;
};

const EMPTY: RowSpanPlan = { hidden: [], moved: {} };

type Range = { start: number; end: number };

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return Number.isFinite(h) && Number.isFinite(mi) ? h * 60 + mi : null;
}

/** `"15:00~16:00"` → 분 범위. 시각이 없거나 한쪽만 있으면 null(판정 대상 아님). */
function rangeOf(time: string): Range | null {
  const [a, b] = (time ?? "").split("~");
  if (!a || !b) return null;
  const start = toMin(a);
  const end = toMin(b);
  return start != null && end != null && end > start ? { start, end } : null;
}

/** `[start,end)`가 다른 범위들의 합집합에 **완전히** 들어가나. */
function coveredBy(target: Range, others: Range[]): boolean {
  const sorted = [...others].sort((a, b) => a.start - b.start);
  let at = target.start;
  for (const r of sorted) {
    if (r.start > at) break; // 틈 — 여기서 끊긴다
    at = Math.max(at, r.end);
    if (at >= target.end) return true;
  }
  return at >= target.end;
}

/**
 * 남은 눈금에서의 위치(칸 단위, 소수 가능).
 * 행 안이면 비례, 행과 행 **사이(틈)** 면 다음 행의 시작으로 올린다 — 틈에 칸을 반쯤 걸치면 어느 교시인지
 * 읽을 수 없다. 마지막 행 끝은 눈금 끝(`rows.length`).
 */
function coordOf(t: number, rows: Range[]): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (t < r.start) return i; // 앞선 틈 → 이 행 시작
    if (t < r.end) return i + (t - r.start) / (r.end - r.start);
    if (t === r.end) {
      // 행 끝 = 다음 행 시작(붙어 있으면 같은 자리) — 경계는 늘 정수로.
      return i + 1;
    }
  }
  return rows.length;
}

/**
 * 축에서 접을 행과 그 칸이 놓일 자리를 정한다.
 * @param rows 이 줄이 실제로 쓰는 교시 행(축 순서 = order 오름차순이어야 한다).
 */
export function planRowSpans(rows: SpanRow[]): RowSpanPlan {
  if (rows.length < 2) return EMPTY;
  const ranged = rows
    .map((r) => ({ row: r, range: rangeOf(r.time) }))
    .filter((x): x is { row: SpanRow; range: Range } => x.range !== null);
  if (ranged.length < 2) return EMPTY;

  // ① 긴 행부터 — 짧은 행이 먼저 접히면(긴 행에 덮여) 정작 촘촘한 눈금이 사라진다.
  const byLongest = [...ranged].sort(
    (a, b) => b.range.end - b.range.start - (a.range.end - a.range.start) || a.row.order - b.row.order,
  );
  const hidden = new Set<number>();
  for (const cand of byLongest) {
    const others = ranged.filter((x) => x.row.order !== cand.row.order && !hidden.has(x.row.order)).map((x) => x.range);
    if (others.length > 0 && coveredBy(cand.range, others)) hidden.add(cand.row.order);
  }
  if (hidden.size === 0) return EMPTY;

  // ② 남은 눈금 위에 접힌 칸을 앉힌다.
  const ladder = ranged.filter((x) => !hidden.has(x.row.order)).sort((a, b) => a.row.order - b.row.order);
  const ladderRanges = ladder.map((x) => x.range);
  const moved: Record<string, MovedSpan> = {};
  for (const h of ranged) {
    if (!hidden.has(h.row.order)) continue;
    const a = coordOf(h.range.start, ladderRanges);
    const b = coordOf(h.range.end, ladderRanges);
    const idx = Math.floor(a + 1e-9);
    const span = b - a;
    // 앉힐 자리가 없거나 길이가 0이면 접지 않는다(정보를 잃느니 축이 한 줄 더 서는 게 낫다).
    if (idx >= ladder.length || span <= 0) {
      hidden.delete(h.row.order);
      continue;
    }
    moved[String(h.row.order)] = {
      order: ladder[idx]!.row.order,
      offset: a - idx,
      span,
    };
  }
  return hidden.size === 0 ? EMPTY : { hidden: [...hidden], moved };
}

/** 화면이 실제로 그릴 행 — 접힌 행을 뺀 축. */
export function visibleSpanRows<T extends { order: number }>(rows: T[], plan?: RowSpanPlan | null): T[] {
  if (!plan || plan.hidden.length === 0) return rows;
  const hidden = new Set(plan.hidden);
  return rows.filter((r) => !hidden.has(r.order));
}

/** 놓일 행 order → 그 위에 앉는 접힌 칸들(그리는 쪽이 한 번만 만든다). */
export function movedByTarget(plan?: RowSpanPlan | null): Map<number, (MovedSpan & { from: number })[]> {
  const out = new Map<number, (MovedSpan & { from: number })[]>();
  for (const [from, m] of Object.entries(plan?.moved ?? {})) {
    const list = out.get(m.order) ?? [];
    list.push({ ...m, from: Number(from) });
    out.set(m.order, list);
  }
  return out;
}

/**
 * 접힌 칸이 놓일 **픽셀 상자** — 칸을 절대배치할 때 그리는 쪽이 쓴다.
 *
 * 🔴 **행 경계에 딱 맞게 끝나는 칸은 1px 짧게 그린다** — 행 높이(`rowH`)는 구분선(border-b)을 **포함한**
 *    피치라, `span * rowH`를 그대로 쓰면 칸의 마지막 1px이 그 행의 구분선 자리를 덮어 **그 줄만 가로선이
 *    사라진다**(원장 2026-09-09: *"JJ / 전양원 사이에 줄 생기도록"*). 접힌 칸은 위에 겹쳐 그려지므로
 *    (`z-index`) 아래 행이 그린 선을 가린다 — 자리를 비워 줘야 다시 보인다.
 * 🔑 **span 안쪽 경계는 그대로 덮는다**(1.5칸짜리 60분 수업 가운데를 선이 가로지르면 안 된다) — 돌려주는
 *    건 **끝나는 자리** 한 곳뿐이다. 그래서 판정이 `offset + span`이 정수냐다(실측: 15:00~16:00은
 *    `0 + 1.5`라 행 중간에서 끝나 해당 없음 / 16:00~17:00은 `0.5 + 1.5 = 2`라 경계에서 끝난다).
 * 🔴 **"덮는다"는 칸이 불투명할 때만 성립한다** — 그리는 쪽이 접힌 칸에 불투명 바탕을 깔아야 한다
 *    (자리 칸 JJ·LAB은 `bg-*-soft` = 알파 0.12라 아래 선이 그대로 비쳤다, 2026-09-10).
 * ⚠️ 소수 누적오차가 있어 정수 판정은 반올림 거리로 본다(`0.5 + 1.5`가 `1.9999…`로 떨어질 수 있다).
 */
export function movedCellBox(
  m: Pick<MovedSpan, "offset" | "span">,
  rowH: number,
  borderPx = 1,
): { top: number; height: number } {
  const end = m.offset + m.span;
  const endsOnRowLine = Math.abs(end - Math.round(end)) < 1e-6;
  return {
    top: m.offset * rowH,
    height: m.span * rowH - (endsOnRowLine ? borderPx : 0),
  };
}

/**
 * 접힌 칸의 **위 모서리가 교시 구분선과 겹치나**.
 *
 * 겹치면(=`offset`이 정수) 격자가 이미 그 자리에 선을 그렸으니 칸은 아무것도 안 그린다. 겹치지 않으면
 * (행 한가운데서 시작하면) 그 자리엔 **어떤 선도 없다** — 바로 위 칸과 맞닿아 있어도 경계가 안 보인다
 * (원장 2026-09-10: *"초등 브릿지 B JJ에서는 가로선이 보이는데, 왜 전양원 위로는 안보이지?"* — 실측:
 * JJ는 행 머리에서 시작해 위 선이 있고, 전양원은 16:00에 시작해 행 한가운데라 위 선이 없었다).
 * 그래서 이 경우에만 칸이 **제 위 테두리를 직접 그린다** — 아래 모서리는 안 그린다(다음 칸이 제 위
 * 테두리를 그리므로 둘 다 그리면 2px이 된다. 아래가 비어 있으면 흰 바탕과 색 블록의 경계가 이미 보인다).
 */
export function movedCellStartsOnRowLine(m: Pick<MovedSpan, "offset">): boolean {
  return Math.abs(m.offset - Math.round(m.offset)) < 1e-6;
}
