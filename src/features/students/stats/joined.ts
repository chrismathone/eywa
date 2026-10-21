import type { HistoryMonth } from "./history";
import type { FlowRow, HistoryPoints, Point } from "./model";

/**
 * **전체 추이 잇기**(원장 2026-10-21 *"추이를 전체 추이를 보고 싶은거기때문에 이어질 수 있는 데이터는 다 이어서 추이그래프 만들어야지"*) —
 * 재원생 추이·등록·퇴원 추이가 에이와로 정확히 셀 수 있는 달(`countFrom` — 2026-10-20 '2026년 4월부터') **앞**을 '지난 기록'(0385a
 * `student_history_monthly` — 메이크에듀 2020-01~ · 에이와 청구 2026-01~)으로 메운다. 순수 함수(Vitest).
 *
 * 🔑 메우는 값의 뜻은 에이와 점과 **다르다**(화면이 '지난 기록'으로 가려 보인다 · 점에 `source: "history"`):
 *   · 재원생 = 메이크에듀 **재원생 기록**(`enrolledRecord` · 2025-03~ · 휴원·시작 전 포함) → 없는 달은 **수업료가 청구된 학생**
 *     (`payingTotal` · 2020-01~ · 미납 포함 · 휴원·시작 전 제외 · 수납 권한이 없으면 실리지 않는다 — `withoutPaying`).
 *   · 등록 = 수업을 시작한 등록(`newReal` — 에이와 등록 칸과 같은 판정) · 퇴원 칸 = **청구가 끊긴 학생**(`stoppedPaying` — 다음 두 달 청구
 *     없음 · 퇴원일이 아니다 · 아직 두 달이 안 지난 달은 null).
 * 겹치는 달은 에이와가 이긴다(`joinPoints`). 2026-10-20에 '그 전은 지난 기록 카드가 맡는다'로 잘랐던 것을 원장이 같은 날 저녁 뒤집었다 —
 * 잘라 둔 이유(옮겨 온 학생의 시작일이 옮긴 날로 잡혀 낮게 나온다)는 그대로라 **에이와로 센 낮은 값 대신** 지난 기록을 쓴다.
 */

const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};
/** 월 점 라벨 — `monthlyPoints`와 같은 규칙(1월은 `YY.1월`, 그 밖은 `M월`). 첫 칸 규칙은 범위를 자른 뒤 화면 축 라벨(`axisLabel`)이 정한다. */
const monthLabel = (ym: string) => {
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${ym.slice(2, 4)}.1월` : `${m}월`;
};

/** 그달의 재원생으로 쓸 지난 기록 값 — 메이크에듀 재원생 기록이 먼저, 없으면 수업료가 청구된 학생. 둘 다 없으면 null(점을 세우지 않는다). */
export function historyCount(m: HistoryMonth): number | null {
  return m.enrolledRecord ?? m.payingTotal ?? null;
}

/**
 * 지난 기록 → 재원생 추이에 이을 월별·연도별 점. `before` = 에이와로 정확히 셀 수 있는 첫 달(YYYY-MM) — 그 **전** 달만(없으면 전부 —
 * 에이와 점이 없을 때 `joinPoints`가 겹침을 정리한다). 연도별 = 해마다 **그해 마지막 기록 달**의 값(12월이 보통 · 연말 점과 같은 뜻).
 */
export function historyTrendPoints(months: readonly HistoryMonth[], before: string | null): HistoryPoints {
  const monthly: Point[] = [];
  for (const m of months) {
    if (before && m.month >= before) continue;
    const count = historyCount(m);
    if (count === null) continue;
    // `basis` = 재원생 기록인지 청구 학생인지 — 둘 사이 경계(침산 2025-02→03)의 증감도 비우게(재리뷰 2026-10-21).
    monthly.push({ key: m.month, label: monthLabel(m.month), date: lastDay(m.month), count, source: "history", basis: m.enrolledRecord !== undefined ? "record" : "paying" });
  }
  const yearly: Point[] = [];
  for (const p of monthly) {
    const year = p.key.slice(0, 4);
    const last = yearly.at(-1);
    const point: Point = { key: year, label: `${year}년`, date: p.date, count: p.count, source: "history", basis: p.basis };
    if (last?.key === year) yearly[yearly.length - 1] = point;
    else yearly.push(point);
  }
  // 에이와가 세는 해(`before`가 속한 해)는 에이와 연말 점이 맡는다 — 그해 앞 달만 있는 지난 기록 점을 연말 값처럼 세우지 않는다.
  const beforeYear = before?.slice(0, 4);
  return { monthly, yearly: beforeYear ? yearly.filter((p) => p.key < beforeYear) : yearly };
}

/**
 * 지난 기록 → 등록·퇴원 추이에 이을 달. `before` 전 달 중 등록 값이 있는 달만. 퇴원 칸은 청구가 끊긴 학생(모르면 null).
 * 등록은 늘 '수업을 시작한 등록'이라 `startedOnly`를 켠다(안내 문장이 데이터에서 나오게).
 */
export function historyFlowRows(months: readonly HistoryMonth[], before: string | null): FlowRow[] {
  const out: FlowRow[] = [];
  for (const m of months) {
    if (before && m.month >= before) continue;
    if (m.newReal === undefined) continue;
    out.push({ month: m.month, enrolled: m.newReal, withdrawn: m.stoppedPaying ?? null, startedOnly: true, source: "history" });
  }
  return out;
}

/** 지난 기록 달 + 에이와 달 — 에이와 첫 달보다 앞선 지난 기록 달만 앞에(겹치면 에이와). */
export function joinFlowRows(history: readonly FlowRow[], aywa: readonly FlowRow[]): FlowRow[] {
  const first = aywa[0]?.month;
  return [...(first ? history.filter((r) => r.month < first) : history), ...aywa];
}

/**
 * 한 선을 **두 선으로 가른 값** — 지난 기록 점은 `history`에, 에이와 점은 `aywa`에. 꺾은선이 끊기지 않게 지난 기록 선은 **에이와 첫 점까지**
 * 잇는다(경계 점이 양쪽에 선다 · 막대에선 같은 스택이라 두 번 서지 않게 호출부가 `bridge`를 끈다).
 */
export function splitBySource(points: readonly Point[], bridge: boolean): { history: (number | null)[]; aywa: (number | null)[] } {
  const firstAywa = points.findIndex((p) => p.source !== "history");
  return {
    history: points.map((p, i) => (p.source === "history" || (bridge && i === firstAywa && firstAywa > 0) ? p.count : null)),
    aywa: points.map((p) => (p.source === "history" ? null : p.count)),
  };
}

const monthText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/**
 * 이은 선의 안내 문장 — 어느 달부터 에이와 기록이고 그 전은 무엇으로 메웠나(데이터에서 나온다 — 지점마다 다르다). 메운 점이 없으면 null.
 * `recordFrom`/`recordTo` = 메이크에듀 재원생 기록이 쓰인 구간 · `payingFrom` = 수업료가 청구된 학생으로 메운 첫 달.
 */
export function joinNote(history: readonly Point[], months: readonly HistoryMonth[], aywaFrom: string | null): string | null {
  if (!history.length) return null;
  const used = new Set(history.map((p) => p.key));
  const rec = months.filter((m) => used.has(m.month) && m.enrolledRecord !== undefined).map((m) => m.month);
  const pay = months.filter((m) => used.has(m.month) && m.enrolledRecord === undefined && m.payingTotal !== undefined).map((m) => m.month);
  const parts: string[] = [];
  if (rec.length) parts.push(`${monthText(rec[0]!)}~${monthText(rec.at(-1)!)}은 메이크에듀 재원생 기록(휴원·수업 시작 전 포함)`);
  if (pay.length) parts.push(`${monthText(pay[0]!)}~${monthText(pay.at(-1)!)}은 수업료가 청구된 학생 수(미납 포함 · 휴원·시작 전 제외)`);
  const head = aywaFrom ? `${monthText(aywaFrom)}부터 에이와 기록으로 세고, 그 전은 지난 기록으로 이었습니다 — ` : "지난 기록으로 이었습니다 — ";
  return `${head}${parts.join(" · ")}. 점선 구간은 뜻이 조금 달라 에이와 구간과 몇 명 차이가 날 수 있습니다.`;
}
