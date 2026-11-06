/**
 * 학원 비서 보고서 화면의 **순수 계산**(서식·정렬·합계·CSV·차트 재료) — 그리는 일은 `report-*.tsx`가 한다(Vitest).
 *
 * 🔴 값은 DB에서 온다 — 여기서 만드는 것은 전부 **글자**다(HTML·마크다운으로 읽지 않는다). CSV는 엑셀이 수식으로 읽는
 *    첫 글자(`=`·`+`·`-`·`@`)를 막는다(학부모 글 같은 칸이 엑셀에서 수식으로 돌지 않게).
 * 날짜는 KST(Asia/Seoul) — `YYYY-MM-DD` 달력 날짜는 시간대 변환 없이 그대로, 시각이 붙은 값만 KST로 옮긴다.
 */
import type { ColumnFormat, ReportBlock, SettledReport } from "@/features/assistant/report";
import { formatKoreanDate, isValidYmd, kstDateOf, kstTimeOf, monthDayLabel } from "@/lib/date-kst";

export type Cell = string | number | boolean | null | undefined;
export type Row = Readonly<Record<string, Cell>>;
export type SortDir = "asc" | "desc";
export type Align = "left" | "center" | "right";
type Dataset = SettledReport["datasets"][string];

/** 값이 없는 칸 — 0과 구별한다(0은 0으로 적는다). */
export const EMPTY_CELL = "—";

const NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
/** 날짜 뒤에 시각이 붙은 값(`2026-11-06T05:00:00Z` · `2026-11-06 14:00:00+09`). */
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** 셀 → 숫자. DB numeric이 글자로 오는 경우(`"12345.00"`·`"1,234"`)도 받는다. 그 밖은 null. */
export function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/,/g, "");
  if (!t || !NUMERIC.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const isBlank = (v: Cell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
/** `-0`을 `0`으로 — `toLocaleString`이 "-0"을 적지 않게. */
const unsign = (n: number) => (Object.is(n, -0) ? 0 : n);

export function formatNumber(n: number, maxFraction = 2): string {
  return unsign(n).toLocaleString("ko-KR", { maximumFractionDigits: maxFraction });
}

/** 원 — 정수로 반올림 · `12,000원`. */
export function formatWon(n: number): string {
  return `${unsign(Math.round(n)).toLocaleString("ko-KR")}원`;
}

/** 백분율 — 값은 이미 0~100 단위다(`12.3` → `12.3%`). 소수 한 자리까지. */
export function formatPercent(n: number): string {
  return `${formatNumber(n, 1)}%`;
}

/** 날짜 칸의 KST 달력 날짜(`YYYY-MM-DD`). 해석할 수 없으면 null. */
export function dateKey(v: Cell): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (YMD.test(t)) return isValidYmd(t) ? t : null;
  if (STAMP.test(t)) return kstDateOf(t);
  return null;
}

/** 날짜 → `26.11.06`(원장 지정 짧은 표기 · `kstShortStamp`와 같은 꼴). 해석 불가면 원문. */
export function formatDate(v: Cell): string {
  const key = dateKey(v);
  return key ? key.slice(2).replaceAll("-", ".") : String(v);
}

/** 날짜·시각 → `26.11.06 14:30`(KST). 시각이 없는 달력 날짜는 날짜만. 해석 불가면 원문. */
export function formatDateTime(v: Cell): string {
  if (typeof v !== "string") return String(v);
  const t = v.trim();
  if (!STAMP.test(t)) return formatDate(t);
  const time = kstTimeOf(t);
  const key = kstDateOf(t);
  return key && time ? `${key.slice(2).replaceAll("-", ".")} ${time}` : t;
}

/**
 * 칸 서식이 비었거나 `text`인데 값이 **전부 숫자**면 숫자로 본다 — AI가 `format`을 빠뜨려도 정렬·합계·오른쪽 정렬이 맞게.
 * (숫자 모양 글자 — 전화번호·학번 — 는 `typeof === "number"`가 아니라 글자로 오므로 여기 걸리지 않는다.)
 */
export function effectiveFormat(format: ColumnFormat | undefined, values: readonly Cell[]): ColumnFormat {
  if (format && format !== "text") return format;
  const present = values.filter((v) => !isBlank(v));
  if (present.length > 0 && present.every((v) => typeof v === "number")) return "number";
  return "text";
}

/**
 * 차트를 표로 볼 때의 칸 서식 — 차트는 칸 서식을 안 갖는다. 가로축 값이 전부 날짜면 날짜, 시각이 붙어 있으면 날짜·시각, 그 밖은
 * `effectiveFormat`. 시리즈 값은 단위로 정한다(원 → 원, % → 백분율, 그 밖 → 숫자).
 */
export function chartColumnFormat(values: readonly Cell[], unit?: string, axis = false): ColumnFormat {
  if (!axis) return unit === "원" ? "won" : unit === "%" ? "percent" : "number";
  const present = values.filter((v) => !isBlank(v));
  if (present.length > 0 && present.every((v) => dateKey(v) !== null)) {
    return present.some((v) => typeof v === "string" && STAMP.test(v.trim())) ? "datetime" : "date";
  }
  return effectiveFormat(undefined, values);
}

/** 칸 하나를 화면 글자로. 빈 값은 `—`(0과 다르다). */
export function formatCell(v: Cell, format: ColumnFormat = "text"): string {
  if (isBlank(v)) return EMPTY_CELL;
  if (typeof v === "boolean") return v ? "예" : "아니오";
  switch (format) {
    case "number": {
      const n = toNumber(v);
      return n === null ? String(v) : formatNumber(n);
    }
    case "won": {
      const n = toNumber(v);
      return n === null ? String(v) : formatWon(n);
    }
    case "percent": {
      const n = toNumber(v);
      return n === null ? String(v) : formatPercent(n);
    }
    case "date":
      return formatDate(v);
    case "datetime":
      return formatDateTime(v);
    default:
      return typeof v === "number" ? formatNumber(v) : String(v);
  }
}

/**
 * 열 정렬 — 제목과 값은 같은 축(design-conventions '데이터 표'): 금액·숫자 = 오른쪽 · 날짜 = 가운데 ·
 * 글은 짧으면(10자 이하 — 이름·과목·상태) 가운데, 길면 왼쪽.
 */
export function columnAlign(format: ColumnFormat, values: readonly Cell[]): Align {
  if (format === "number" || format === "won" || format === "percent") return "right";
  if (format === "date" || format === "datetime") return "center";
  let longest = 0;
  for (const v of values) if (!isBlank(v)) longest = Math.max(longest, [...String(v)].length);
  return longest <= 10 ? "center" : "left";
}

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

function sortValue(v: Cell, format: ColumnFormat): number | string | null {
  if (isBlank(v)) return null;
  if (format === "number" || format === "won" || format === "percent") return toNumber(v);
  if (format === "date") return dateKey(v);
  if (format === "datetime") {
    const ms = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isNaN(ms) ? String(v) : ms;
  }
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v);
}

/** 정렬(안정) — 빈 값은 방향과 상관없이 맨 뒤. 글자는 한국어 순서 + 숫자는 크기대로(`2반` < `10반`). */
export function sortRows<T extends Row>(rows: readonly T[], column: string, dir: SortDir, format: ColumnFormat): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, key: sortValue(row[column], format) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === b.key ? a.i - b.i : a.key === null ? 1 : -1;
      const c =
        typeof a.key === "number" && typeof b.key === "number"
          ? a.key - b.key
          : collator.compare(String(a.key), String(b.key));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}

/** 처음 누를 때의 방향 — 숫자·금액은 큰 것부터, 그 밖은 가나다·오래된 순. */
export function firstSortDir(format: ColumnFormat): SortDir {
  return format === "number" || format === "won" || format === "percent" ? "desc" : "asc";
}

/**
 * 합계 줄 — 칸마다 숫자 합(숫자가 하나도 없으면 null). 🔴 백분율은 더하지 않는다(더한 % 는 뜻이 없다 → null).
 */
export function columnTotals(
  rows: readonly Row[],
  columns: readonly { column: string; format: ColumnFormat }[],
  totals: readonly string[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const { column, format } of columns) {
    if (!totals.includes(column) || format === "percent" || format === "date" || format === "datetime") continue;
    let sum: number | null = null;
    for (const row of rows) {
      const n = toNumber(row[column]);
      if (n !== null) sum = (sum ?? 0) + n;
    }
    out[column] = sum;
  }
  return out;
}

/** 엑셀이 수식으로 읽는 첫 글자 — 글자 칸 앞에 `'`를 붙여 그냥 글자로 남긴다(CSV 수식 주입 차단). */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvRaw(v: Cell, format: ColumnFormat): string {
  if (isBlank(v)) return "";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (format === "number" || format === "won" || format === "percent") {
    const n = toNumber(v);
    if (n !== null) return String(unsign(n));
  }
  if (format === "date") {
    const key = dateKey(v);
    if (key) return key;
  }
  if (format === "datetime" && typeof v === "string" && STAMP.test(v.trim())) {
    const key = kstDateOf(v);
    const time = kstTimeOf(v);
    if (key && time) return `${key} ${time}`;
  }
  if (typeof v === "number") return String(unsign(v));
  const s = String(v);
  return FORMULA_START.test(s) ? `'${s}` : s;
}

const csvQuote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * CSV(엑셀용) — UTF-8 BOM + CRLF. 머리는 화면 열 이름, 숫자·금액은 **꾸밈 없는 숫자**(엑셀에서 더하고 정렬할 수 있게),
 * 날짜는 `YYYY-MM-DD`(KST). 합계 줄은 넣지 않는다(정렬하면 데이터와 섞인다).
 */
export function toCsv(columns: readonly { column: string; label: string; format: ColumnFormat }[], rows: readonly Row[]): string {
  const head = columns.map((c) => csvQuote(FORMULA_START.test(c.label) ? `'${c.label}` : c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => csvQuote(csvRaw(row[c.column], c.format))).join(","));
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

/** 내려받을 파일 이름 — 파일 시스템이 거절하는 글자를 지운다. `학원비서_미납 현황_2026-11-06.csv`. */
export function csvFileName(title: string, today: string): string {
  // 파일 이름에 못 쓰는 글자(제어 문자 포함)를 지운다.
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "표";
  return `학원비서_${safe}_${today}.csv`;
}

// ───────────────────────────── KPI ─────────────────────────────

export type DeltaTone = "good" | "bad" | "neutral";

/** 델타 색 — 오르면 좋은 값(신규·출석률)은 오를 때 초록, 내리면 좋은 값(미납·퇴원)은 내릴 때 초록. 방향 모름·0은 중립. */
export function deltaTone(delta: number, goodWhen: "up" | "down" | "none" | undefined): DeltaTone {
  if (!goodWhen || goodWhen === "none" || delta === 0 || !Number.isFinite(delta)) return "neutral";
  const up = delta > 0;
  return (goodWhen === "up") === up ? "good" : "bad";
}

/** KPI 값 글자(단위는 따로 붙인다). 원은 정수, %는 한 자리, 그 밖은 두 자리까지. 글자 값은 그대로. */
export function formatKpiValue(value: string | number, unit?: string): string {
  const n = typeof value === "number" ? value : null;
  if (n === null) return value as string;
  if (unit === "원") return unsign(Math.round(n)).toLocaleString("ko-KR");
  return formatNumber(n, unit === "%" ? 1 : 2);
}

/** 델타 크기 글자(부호는 화살표가 말한다) — `3명` · `120,000원` · `%` 단위는 퍼센트포인트 `2.5%p`. */
export function formatDelta(delta: number, unit?: string): string {
  const abs = Math.abs(delta);
  if (unit === "원") return formatWon(abs);
  if (unit === "%") return `${formatNumber(abs, 1)}%p`;
  return `${formatNumber(abs)}${unit ?? ""}`;
}

// ───────────────────────────── 차트 ─────────────────────────────

/**
 * 범주 색 — 순서 고정(시리즈 순번 = 색, 돌려 쓰지 않는다). 파랑·주황·보라·초록·장미는 dataviz 검증기로 흰 바탕에서
 * 색각 이상 구분(ΔE ≥ 8)·명도·채도·대비를 모두 통과한 순서다. 6번째 금색은 채도가 기준에 조금 못 미쳐 범례·툴팁이 이름을 함께 나른다.
 * 🔴 빨강(`--danger`)은 넣지 않는다 — 의미색 캐논에서 '위험'이라 아무 시리즈에나 칠하면 경고로 읽힌다.
 */
export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-purple)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-gold)",
] as const;
/** 원그래프 '기타' 조각 — 중립 회색 면(글자 토큰이 아니라 `--neutral-fill`). */
export const OTHER_COLOR = "var(--color-neutral-fill)";

/** 축 눈금 — 돈은 만·억으로 줄인다(`1,200만` · `3.5억`). %는 `40%`, 그 밖은 `1,234명`(큰 수는 `1.2만명`). */
export function formatAxisTick(n: number, unit?: string): string {
  const abs = Math.abs(n);
  const short = (v: number, d: number, s: string) => `${formatNumber(v / d, 1)}${s}`;
  if (unit === "원") {
    if (abs >= 1e8) return short(n, 1e8, "억");
    if (abs >= 1e4) return short(n, 1e4, "만");
    return formatNumber(n, 0);
  }
  if (unit === "%") return `${formatNumber(n, 1)}%`;
  const u = unit ?? "";
  if (abs >= 1e8) return short(n, 1e8, `억${u}`);
  if (abs >= 1e5) return short(n, 1e4, `만${u}`);
  return `${formatNumber(n)}${u}`;
}

/** 툴팁·범례의 값 — 줄이지 않는다(`12,345,000원` · `12.3%` · `1,234명`). */
export function formatChartValue(n: number, unit?: string): string {
  if (unit === "원") return formatWon(n);
  if (unit === "%") return formatPercent(n);
  return `${formatNumber(n)}${unit ?? ""}`;
}

/** 축 글자 폭 어림(14px) — 한글 14 · 그 밖 8. 세로축 폭을 정한다. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[가-힣]/.test(ch) ? 14 : 8;
  return w;
}

/**
 * 가로축 라벨(짧게)과 툴팁 머리(길게). 축 전체를 보고 정한다 —
 * 모두 `YYYY-MM`이고 한 해 안이면 `3월`, 해가 섞이면 `26.03` · 날짜는 `11/6` · 시각이 붙은 값은 KST 날짜 · 그 밖은 원문.
 */
export function axisLabels(values: readonly Cell[]): { label: string; tip: string }[] {
  const strings = values.map((v) => (typeof v === "string" ? v.trim() : v));
  const allYm = strings.length > 0 && strings.every((v) => typeof v === "string" && YM.test(v));
  const years = new Set(allYm ? strings.map((v) => (v as string).slice(0, 4)) : []);
  return strings.map((v) => {
    if (isBlank(v)) return { label: "(없음)", tip: "(없음)" };
    if (typeof v === "string" && YM.test(v)) {
      const [y, m] = v.split("-");
      const tip = `${y}년 ${Number(m)}월`;
      return { label: allYm && years.size === 1 ? `${Number(m)}월` : `${y!.slice(2)}.${m}`, tip };
    }
    const key = dateKey(v);
    if (key) {
      const time = typeof v === "string" && STAMP.test(v) ? kstTimeOf(v) : null;
      return { label: monthDayLabel(key), tip: time ? `${formatKoreanDate(key)} ${time}` : formatKoreanDate(key) };
    }
    const s = typeof v === "number" ? formatNumber(v) : String(v);
    return { label: s, tip: s };
  });
}

export type ChartPoint = { key: string; label: string; tip: string } & Record<`s${number}`, number | null>;

/**
 * 차트 재료 — 행마다 가로축 글자 + 시리즈 값(`s0`·`s1`… — 칸 이름에 점 같은 글자가 있어도 recharts 키가 깨지지 않게).
 * 숫자가 아닌 값은 null(그 칸은 그리지 않는다 — 0으로 세우지 않는다).
 */
export function chartPoints(dataset: Dataset, x: string, series: readonly { column: string }[]): ChartPoint[] {
  const labels = axisLabels(dataset.rows.map((r) => r[x]));
  return dataset.rows.map((row, i) => {
    const point: Record<string, string | number | null> = { key: String(i), label: labels[i]!.label, tip: labels[i]!.tip };
    series.forEach((s, j) => {
      point[`s${j}`] = toNumber(row[s.column]);
    });
    return point as ChartPoint;
  });
}

export type PieSlice = { name: string; value: number; share: number; color: string };

/**
 * 원그래프 조각 — 0보다 큰 값만, 큰 순. 일곱 개 이상이면 상위 다섯 + '기타'(나머지 합 · 회색)로 접는다
 * (범주 색을 새로 만들지 않는다). `share`는 0~1.
 */
export function pieSlices(dataset: Dataset, x: string, column: string, maxSlices = 6): PieSlice[] {
  const labels = axisLabels(dataset.rows.map((r) => r[x]));
  const items = dataset.rows
    .map((row, i) => ({ name: labels[i]!.tip, value: toNumber(row[column]) ?? 0 }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return [];
  const head = items.length > maxSlices ? items.slice(0, maxSlices - 1) : items;
  const rest = items.length > maxSlices ? items.slice(maxSlices - 1) : [];
  const slices: PieSlice[] = head.map((s, i) => ({ ...s, share: s.value / total, color: CHART_COLORS[i % CHART_COLORS.length]! }));
  if (rest.length) {
    const value = rest.reduce((a, s) => a + s.value, 0);
    slices.push({ name: `기타 ${rest.length}개`, value, share: value / total, color: OTHER_COLOR });
  }
  return slices;
}

// ───────────────────────────── 보고서 묶음 ─────────────────────────────

export type BlockGroup =
  | { kind: "single"; index: number; block: ReportBlock }
  | { kind: "charts"; index: number; blocks: Extract<ReportBlock, { type: "chart" }>[] };

/** 이어진 차트 블록은 한 묶음으로(넓은 화면에서 나란히 선다). 그 밖은 한 블록씩. */
export function groupBlocks(blocks: readonly ReportBlock[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  blocks.forEach((block, index) => {
    const last = out[out.length - 1];
    if (block.type === "chart") {
      if (last?.kind === "charts") last.blocks.push(block);
      else out.push({ kind: "charts", index, blocks: [block] });
      return;
    }
    out.push({ kind: "single", index, block });
  });
  return out;
}

export type ReportSource = { id: string; purpose: string; rowCount: number; truncated: boolean };

/** 근거 목록 — 보고서가 가리킨 조회를 블록에 처음 나온 순서로(가리키지 않은 조회는 뒤에). SQL은 싣지 않는다. */
export function reportSources(report: SettledReport): ReportSource[] {
  const order: string[] = [];
  const push = (id: string) => {
    if (!order.includes(id) && report.datasets[id]) order.push(id);
  };
  for (const b of report.blocks) {
    if (b.type === "chart" || b.type === "table") push(b.query);
    if (b.type === "kpi") for (const item of b.items) if (item.ref) push(item.ref.query);
  }
  for (const id of Object.keys(report.datasets)) push(id);
  return order.map((id) => {
    const d = report.datasets[id]!;
    return { id, purpose: d.purpose, rowCount: d.rows.length, truncated: d.truncated };
  });
}
