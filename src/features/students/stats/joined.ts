import type { HistoryMonth } from "./history";
import type { FlowRow, HistoryPoints, Point } from "./model";

/**
 * **전체 추이 잇기**(원장 2026-10-21 *"추이를 전체 추이를 보고 싶은거기때문에 이어질 수 있는 데이터는 다 이어서 추이그래프 만들어야지"*) —
 * 재원생 추이·등록·퇴원 추이가 에이와로 정확히 셀 수 있는 달(`countFrom` — 2026-10-20 '2026년 4월부터') **앞**을 '지난 기록'(0385a
 * `student_history_monthly` — 메이크에듀 2020-01~ · 에이와 청구 2026-01~)으로 메운다. 순수 함수(Vitest).
 *
 * 🔑 메우는 값의 뜻은 에이와 점과 **다르다**(점에 `source: "history"` · 화면은 같은 선으로 잇고 기준이 바뀌는 달에 세로 점선 — 원장 2026-10-29
 *    '같은 선 + 경계 세로선' · '지난 기록' 카드는 없앴다 · 과목 선·강좌수도 과목 묶음 청구 기준 추정으로 잇는다 `historyGroupPoints`·`historyCoursePoints`):
 *   · 재원생 = 메이크에듀 **재원생 기록**(`enrolledRecord` · 2025-03~ · 휴원·시작 전 포함) → 없는 달은 **수업료가 청구된 학생**
 *     (`payingTotal` → 옛 집계는 `payingGeneral`(EiE 제외) · 2020-01~ · 미납 포함 · 수납 권한이 없으면 실리지 않는다 — `withoutPaying`).
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

/** 메이크에듀 옛 집계는 payingTotal 없이 payingGeneral만 있다(EiE 제외). 프로그램별 수는 중복 학생이 있어 더하지 않는다. */
const payingCount = (m: HistoryMonth): number | null => m.payingTotal ?? m.payingGeneral ?? null;

/** 그달의 재원생으로 쓸 지난 기록 값 — 재원생 기록 → 청구 학생(옛 집계는 EiE 제외 추정) → null. */
export function historyCount(m: HistoryMonth): number | null {
  return m.enrolledRecord ?? payingCount(m);
}

/**
 * 지난 기록 → 재원생 추이에 이을 월별·연도별 점. `before` = 에이와로 정확히 셀 수 있는 첫 달(YYYY-MM) — 그 **전** 달만(없으면 전부 —
 * 에이와 점이 없을 때 `joinPoints`가 겹침을 정리한다). 연도별 = 해마다 **그해 마지막 기록 달**의 값(12월이 보통 · 연말 점과 같은 뜻).
 */
export function historyTrendPoints(months: readonly HistoryMonth[], before: string | null): HistoryPoints {
  // `basis` = 재원생 기록인지 청구 학생인지 — 둘 사이 경계(침산 2025-02→03)의 증감도 비우게(재리뷰 2026-10-21).
  return historyPoints(months, before, (m) => {
    const count = historyCount(m);
    return count === null ? null : { count, basis: m.enrolledRecord !== undefined ? "record" : "paying" };
  });
}

/** 지난 기록 달 → 점(월별 + 연도별 = 그해 마지막 기록 달) — `value`가 null인 달은 건너뛴다. `before` 규칙은 `historyTrendPoints`와 같다. */
function historyPoints(months: readonly HistoryMonth[], before: string | null, value: (m: HistoryMonth) => { count: number; basis: "record" | "paying" } | null): HistoryPoints {
  const monthly: Point[] = [];
  for (const m of months) {
    if (before && m.month >= before) continue;
    const v = value(m);
    if (v === null) continue;
    monthly.push({ key: m.month, label: monthLabel(m.month), date: lastDay(m.month), count: v.count, source: "history", basis: v.basis });
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
 * 그달 그 **과목 묶음**(`subjectGroupOf` — math · english · 그 밖은 과목 키)의 수업료가 청구된 학생 — 수학 = `payingMath`(심화 포함) ·
 * 영어 = `payingEnglish`(인재원 영어 ∪ EiE) · 그 밖 = 과목마다(`payingSubject:<키>`). 과목을 가를 수 없는 달은 null
 * (과목 묶음이 없는데 그 밖의 과목 학생이 있는 달 · `payingEnglish`를 싣기 전 줄). 원장 2026-10-29 *"지난기록 말고 그냥 재원생과 강좌수 퇴원생에 반영"*.
 */
export function historyGroupCount(m: HistoryMonth, group: string): number | null {
  if (group === "math") return m.payingMath ?? null;
  if (group === "english") return m.payingEnglish ?? null;
  // 영어를 프로그램으로 가른 선(원장 2026-10-29 *"영어를 인재원영어 및 eie"* — `ENGLISH_PROGRAM_KEYS`).
  if (group === "injaewon") return m.payingInjaewon ?? null;
  if (group === "eie") return m.payingEie ?? null;
  if (m.subjects) return m.subjects[group] ?? 0;
  return m.payingOther === 0 ? 0 : null;
}

/**
 * 과목 묶음 → 재원생·강좌수 추이 과목 선에 이을 점(청구 기준 추정). `before` 규칙은 `historyTrendPoints`와 같다.
 * EiE는 **EiE 수납이 시작된 달부터**(원장 2026-10-29 — 그 전 0을 선으로 그리지 않는다 · 메이크에듀 2021-07).
 */
export function historyGroupPoints(months: readonly HistoryMonth[], before: string | null, group: string): HistoryPoints {
  const eieFrom = group === "eie" ? (months.find((m) => (m.payingEie ?? 0) > 0)?.month ?? "9999-99") : null;
  return historyPoints(eieFrom ? months.filter((m) => m.month >= eieFrom) : months, before, (m) => {
    const count = historyGroupCount(m, group);
    return count === null ? null : { count, basis: "paying" };
  });
}

/**
 * 강좌수 추이에 이을 점 — 그달 **과목 묶음마다 청구된 학생의 합**(학생마다 같은 과목은 1개 = 강좌수와 같은 셈). `groups` = 강좌수 추이의 과목 묶음
 * 전부 — 하나라도 셀 수 없는 달은 건너뛴다(합이 낮게 나오지 않게). 과목을 못 가른 수업만 들은 학생은 들지 않는다(강좌수의 '과목 미입력 제외'와 같은 결).
 */
export function historyCoursePoints(months: readonly HistoryMonth[], before: string | null, groups: readonly string[]): HistoryPoints {
  return historyPoints(months, before, (m) => {
    let count = 0;
    for (const g of groups) {
      const n = historyGroupCount(m, g);
      if (n === null) return null;
      count += n;
    }
    return groups.length ? { count, basis: "paying" } : null;
  });
}

/** 강좌수 추이의 이은 구간 안내 — 메운 점이 없으면 null. */
export function courseJoinNote(history: readonly Point[], aywaFrom: string | null, months: readonly HistoryMonth[] = []): string | null {
  if (!history.length) return null;
  const head = aywaFrom ? `${monthText(aywaFrom)}부터 에이와 기록으로 세고, 그 전` : "지금까지";
  return `${head}(${monthText(history[0]!.key)}~${monthText(history.at(-1)!.key)})은 수업료가 청구된 학생을 과목마다 센 값을 더한 추정입니다(학생마다 같은 과목은 1개 · 미납 포함 · 휴원·시작 전 제외 · 과목을 못 가른 수업 제외). 세로 점선이 기준이 바뀌는 달입니다.${bridgedText(history, months)}`;
}

/** 앞뒤 달로 이은 달 안내(그 구간 안에 있을 때만) — 재원생 과목 선·강좌수가 같이 쓴다. */
export function bridgedText(history: readonly Point[], months: readonly HistoryMonth[], what = ""): string {
  const used = new Set(history.map((p) => p.key));
  const bridged = months.filter((m) => m.bridged && (used.has(m.month) || (history.length > 0 && m.month > history[0]!.key && m.month < history.at(-1)!.key))).map((m) => monthText(m.month));
  return bridged.length ? ` ${what}${bridged.join(" · ")}은 청구 방식이 바뀌어(다음 달 수업료를 미리 청구) 그달 청구가 거의 없어, 그달 청구와 앞뒤 달에 모두 청구된 학생으로 이은 추정입니다.` : "";
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

const monthText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/**
 * 이은 선의 안내 문장 — 어느 달부터 에이와 기록이고 그 전은 무엇으로 메웠나(데이터에서 나온다 — 지점마다 다르다). 메운 점이 없으면 null.
 * `recordFrom`/`recordTo` = 메이크에듀 재원생 기록이 쓰인 구간 · `payingFrom` = 수업료가 청구된 학생으로 메운 첫 달.
 */
export function joinNote(history: readonly Point[], months: readonly HistoryMonth[], aywaFrom: string | null): string | null {
  if (!history.length) return null;
  const used = new Set(history.map((p) => p.key));
  const rec = months.filter((m) => used.has(m.month) && m.enrolledRecord !== undefined).map((m) => m.month);
  const paying = months.filter((m) => used.has(m.month) && m.enrolledRecord === undefined && payingCount(m) !== null);
  const pay = paying.map((m) => m.month);
  const parts: string[] = [];
  if (rec.length) parts.push(`${monthText(rec[0]!)}~${monthText(rec.at(-1)!)}은 메이크에듀 재원생 기록(휴원·수업 시작 전 포함)`);
  if (pay.length) parts.push(`${monthText(pay[0]!)}~${monthText(pay.at(-1)!)}은 수업료가 청구된 학생 수로 추정(미납 포함 · 휴원·시작 전 제외${paying.some((m) => m.payingTotal === undefined) ? " · 전체 청구 집계가 없는 달은 EiE 제외" : ""})`);
  const head = aywaFrom ? `${monthText(aywaFrom)}부터 에이와 기록으로 세고, 그 전은 지난 기록으로 이었습니다 — ` : "지난 기록으로 이었습니다 — ";
  // 비운 달(청구가 비정상으로 적어 청구 칸을 비운 달 — 재원생 기록도 없으면 점이 없다)이 구간 안에 있으면 밝힌다 — 축이 그 달을 건너뛰어
  // 앞뒤 달이 바로 이어져 보인다(리뷰 2026-10-28).
  const [first, last] = [history[0]!.key, history.at(-1)!.key];
  const gaps = months.filter((m) => m.skipped && historyCount(m) === null && m.month > first && m.month < last).map((m) => monthText(m.month));
  const gapText = gaps.length ? ` ${gaps.join(" · ")}은 청구가 비정상으로 적어 비운 달이라 점이 없습니다(앞뒤 달이 바로 이어집니다).` : "";
  return `${head}${parts.join(" · ")}. 지난 기록 구간(세로 점선 앞)은 뜻이 조금 달라 에이와 구간과 몇 명 차이가 날 수 있습니다.${gapText}`;
}

/** 구간 경계 표식 — `index` 칸부터 `after` 기준(그 앞은 `before`). 차트가 세로 점선 + 양쪽 짧은 이름으로 그린다. */
export type BasisMarker = { index: number; before: string; after: string };

/** 재원생 점의 기준 이름 — 청구 기준 추정(수업료가 청구된 학생) · 메이크에듀 재원생 기록 · 에이와 기록. */
export function trendBasisName(p: Pick<Point, "source" | "basis">): string {
  if (p.source !== "history") return "에이와 기록";
  return p.basis === "paying" ? "청구 기준 추정" : "메이크에듀 재원생 기록";
}

/**
 * 기준 이름 줄 → 경계 표식(원장 2026-10-21 *"차트에서도 세로선을 그어서 그걸 알려주는 … 보조선 같은? 추측?"*) — 이름이 바뀌는 칸마다 하나.
 * 이름이 없는 칸(null — 값 없음)은 건너뛰고 앞뒤 이름으로 판정한다.
 */
export function basisMarkers(names: readonly (string | null)[]): BasisMarker[] {
  const out: BasisMarker[] = [];
  let prev: string | null = null;
  names.forEach((name, index) => {
    if (name === null) return;
    if (prev !== null && name !== prev) out.push({ index, before: prev, after: name });
    prev = name;
  });
  return out;
}
