/**
 * 학원 비서 보고서 — AI가 `render_report` 도구로 내는 블록과 그 검증(서버·화면 공용 · 순수 모듈).
 *
 * 🔴 차트·표의 숫자는 **조회 결과를 가리킨다**(`query` = 이번 답에서 돌린 조회 번호 q1·q2…). 화면은 서버가 보관한 실제 결과로
 * 그리므로 AI가 숫자를 다시 타이핑하지 않는다 — 지어낸 숫자가 차트·표에 들어갈 길이 없다. KPI는 값을 글로 쓰되 `ref`를
 * 달면 서버가 그 칸의 실제 값으로 맞춘다(`settleReport`). 보고서 글에는 링크·이미지를 두지 않는다(화면은 글자로만 그린다 —
 * DB에 들어 있던 학부모 글이 지시처럼 읽혀 바깥 주소를 불러오게 하는 길을 막는다).
 */
import { z } from "zod";
import { labelCodeColumns } from "./code-labels";

const text = (max: number) => z.string().trim().min(1).max(max);

export const QueryRefSchema = z.object({ query: z.string(), row: z.number().int().min(0), column: z.string() });

export const KpiItemSchema = z.object({
  label: text(30),
  value: z.union([z.string().trim().min(1).max(40), z.number()]),
  unit: z.string().trim().max(10).optional(),
  /** 비교 값(지난달 대비 등) — 숫자면 화면이 ▲▼로 그린다. */
  delta: z.number().optional(),
  deltaLabel: z.string().trim().max(30).optional(),
  /** 오르면 좋은 값인가(신규·출석률) / 나쁜 값인가(미납·퇴원) — 색만 바꾼다. */
  goodWhen: z.enum(["up", "down", "none"]).optional(),
  ref: QueryRefSchema.optional(),
});

export const ColumnFormatSchema = z.enum(["text", "number", "won", "percent", "date", "datetime"]);

export const ReportBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("summary"), text: text(800) }),
  z.object({ type: z.literal("kpi"), items: z.array(KpiItemSchema).min(1).max(6) }),
  z.object({
    type: z.literal("chart"),
    kind: z.enum(["bar", "stacked_bar", "line", "area", "pie"]),
    title: text(60),
    query: z.string(),
    x: z.string(),
    series: z.array(z.object({ column: z.string(), label: text(30) })).min(1).max(6),
    unit: z.string().trim().max(10).optional(),
  }),
  z.object({
    type: z.literal("table"),
    title: text(60),
    query: z.string(),
    columns: z.array(z.object({ column: z.string(), label: text(30), format: ColumnFormatSchema.optional() })).min(1).max(12),
    /** 합계 줄을 낼 칸(숫자 칸만). */
    totals: z.array(z.string()).max(12).optional(),
  }),
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "warn", "good"]), title: text(60), text: text(600) }),
  z.object({ type: z.literal("list"), title: z.string().trim().max(60).optional(), items: z.array(text(200)).min(1).max(12) }),
  /**
   * 비서 의견 — 원장 2026-11-06 *"형식적인 답변이 아닌 비서답게 어떻게 처리하면 좋겠다 같은 의견 제시도 같이"*.
   * 보고서마다 하나 꼭 넣는다(`settleReport`가 없으면 돌려보낸다). 할 일 · 까닭(데이터 근거) · 언제 · 누가.
   */
  z.object({
    type: z.literal("advice"),
    items: z
      .array(
        z.object({
          action: text(160),
          why: text(300),
          when: z.enum(["today", "this_week", "this_month", "watch"]).optional(),
          who: z.string().trim().max(30).optional(),
        }),
      )
      .min(1)
      .max(5),
  }),
]);

export const ADVICE_WHEN_LABEL = { today: "오늘", this_week: "이번 주", this_month: "이번 달", watch: "지켜보기" } as const;

export const ReportSchema = z.object({
  title: text(80),
  blocks: z.array(ReportBlockSchema).min(1).max(20),
});

export type ReportBlock = z.infer<typeof ReportBlockSchema>;
export type AssistantReport = z.infer<typeof ReportSchema>;
export type ColumnFormat = z.infer<typeof ColumnFormatSchema>;

/** 한 번의 조회 결과(화면·저장용). 셀은 JSON으로 옮길 수 있는 값으로 바꿔 둔다. */
export type QueryResult = {
  id: string;
  /** AI가 붙인 이 조회의 목적(진행 줄·근거에 보인다). */
  purpose: string;
  sql: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
  ms: number;
};

/**
 * 화면이 그리는 완성본 — 보고서 + 그 보고서가 가리키는 조회 결과.
 * `datasetsOmitted` — 대화를 다시 읽을 때 응답이 너무 커져 오래된 답의 표·차트 자료를 뺐다(store.ts threadDetail).
 */
export type SettledReport = AssistantReport & {
  datasets: Record<string, Pick<QueryResult, "columns" | "rows" | "truncated" | "purpose">>;
  datasetsOmitted?: boolean;
  /** 확인한 자료 범위 — 전수 조회(server/survey.ts)를 했으면 서버가 붙인다(AI가 쓰지 않는다). */
  coverage?: ReportCoverage;
};

/**
 * 확인한 자료 범위 — 원장 2026-11-06 *"DB 전체 조회하고 답변하는거 맞아? … 하나도 빠짐없이"*. 전수 조회로 센 표 중 자료가 있는 표(또는 세지 못한 표)와,
 * 그 표를 이번 답에서 조회로 자세히 봤는지(`examined`). 원장이 '빠진 것'을 직접 확인한다.
 */
export type ReportCoverage = {
  surveys: Array<{
    target: string;
    name: string;
    from: string;
    to: string;
    /** 센 표 수(자료 없는 표 포함). */
    checked: number;
    /** `key` = 표 하나를 강사와 직접 · 맡은 반을 거쳐 두 번 셀 때 줄을 가르는 이름(옛 저장본엔 없다 — 그때는 table). */
    tables: Array<{ key?: string; table: string; label: string; via?: "class"; total: number | null; inPeriod: number | null; latest: string | null; examined: boolean; failed?: boolean }>;
  }>;
};

/** `render_report` 도구 설명용 JSON 스키마(strict는 쓰지 않는다 — 서버가 zod로 검증하고 틀리면 이유를 돌려준다). */
export const REPORT_TOOL_SCHEMA = z.toJSONSchema(ReportSchema, { target: "draft-7" }) as Record<string, unknown>;

/**
 * AI가 낸 보고서를 검증하고 조회 결과와 맞춘다. 틀리면 AI에게 돌려줄 이유 목록.
 * - 차트·표: 가리킨 조회가 있고, 칸이 그 결과에 있어야 한다.
 * - KPI `ref`: 그 칸 값으로 `value`를 바꾼다(AI가 옮겨 적다 틀려도 화면엔 DB 값).
 */
export function settleReport(
  input: unknown,
  results: ReadonlyMap<string, QueryResult>,
): { ok: true; report: SettledReport } | { ok: false; errors: string[] } {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(전체)"}: ${i.message}`) };
  }
  const errors: string[] = [];
  const used = new Set<string>();
  // 화면·저장용 자료 — 코드 칸(present·math 등)은 한국어 이름으로(code-labels.ts). AI가 본 원래 결과(results)는 그대로.
  const labeled = new Map<string, QueryResult["rows"]>();
  const rowsOf = (r: QueryResult) => {
    let rows = labeled.get(r.id);
    if (!rows) labeled.set(r.id, (rows = labelCodeColumns(r.columns, r.rows)));
    return rows;
  };
  const need = (where: string, query: string, columns: string[]) => {
    const r = results.get(query);
    if (!r) return void errors.push(`${where}: 조회 ${query}가 없습니다(이번 답에서 돌린 조회: ${[...results.keys()].join(", ") || "없음"})`);
    used.add(query);
    for (const c of columns) if (!r.columns.includes(c)) errors.push(`${where}: ${query}에 칸 ${c}가 없습니다(칸: ${r.columns.join(", ")})`);
  };
  const blocks = parsed.data.blocks.map((block, i): ReportBlock => {
    const where = `blocks.${i}(${block.type})`;
    if (block.type === "chart") need(where, block.query, [block.x, ...block.series.map((s) => s.column)]);
    if (block.type === "table") need(where, block.query, [...block.columns.map((c) => c.column), ...(block.totals ?? [])]);
    if (block.type === "kpi") {
      return {
        ...block,
        items: block.items.map((item, j) => {
          if (!item.ref) return item;
          const r = results.get(item.ref.query);
          const row = r ? rowsOf(r)[item.ref.row] : undefined;
          // Object.hasOwn — `in`은 `constructor` 같은 프로토타입 이름도 맞춘다(적대 리뷰 2026-11-06).
          if (!r || !row || !Object.hasOwn(row, item.ref.column)) {
            errors.push(`${where}.items.${j}: ref ${item.ref.query}[${item.ref.row}].${item.ref.column}이(가) 없습니다`);
            return item;
          }
          used.add(item.ref.query);
          const actual = row[item.ref.column];
          return actual === null || actual === undefined ? item : { ...item, value: typeof actual === "number" ? actual : String(actual) };
        }),
      };
    }
    return block;
  });
  const advice = blocks.filter((b) => b.type === "advice").length;
  if (advice === 0) errors.push("비서 의견(advice) 블록이 없습니다 — 원장이 무엇을 하면 좋을지 1~5개를 근거와 함께 넣어 주세요");
  if (advice > 1) errors.push("비서 의견(advice) 블록은 하나만 넣어 주세요");
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) };
  const datasets: SettledReport["datasets"] = {};
  for (const id of used) {
    const r = results.get(id)!;
    datasets[id] = { columns: r.columns, rows: rowsOf(r), truncated: r.truncated, purpose: r.purpose };
  }
  return { ok: true, report: { title: parsed.data.title, blocks, datasets } };
}
