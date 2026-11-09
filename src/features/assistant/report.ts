/**
 * 학원 비서 보고서 — AI가 `render_report` 도구로 내는 블록과 그 검증(서버·화면 공용 · 순수 모듈).
 *
 * 🔴 차트·표의 숫자는 **조회 결과를 가리킨다**(`query` = 이번 답에서 돌린 조회 번호 q1·q2…). 화면은 서버가 보관한 실제 결과로
 * 그리므로 AI가 숫자를 다시 타이핑하지 않는다 — 지어낸 숫자가 차트·표에 들어갈 길이 없다. KPI는 값을 글로 쓰되 `ref`를
 * 달면 서버가 그 칸의 실제 값으로 맞춘다(`settleReport`). 보고서 글에는 링크·이미지를 두지 않는다(화면은 글자로만 그린다 —
 * DB에 들어 있던 학부모 글이 지시처럼 읽혀 바깥 주소를 불러오게 하는 길을 막는다).
 * 읽는 글 칸(요약·주의·목록 항목·비서 의견)만 강조 표시(굵게·뜻 색 — rich-text.ts)를 받는다. 제목·이름 칸은 표시를 벗긴다(`settleReport`).
 */
import { z } from "zod";
import { labelCodeColumns } from "./code-labels";
import { plainRich } from "./rich-text";
import { ADVICE_METHODS, ADVICE_TOPICS, AdviceCheckSchema, AdviceTargetsSchema, CHECK_FAILED, checkIntegrityProblem, checkTemplateProblem, type AdviceView } from "./advice";

const text = (max: number) => z.string().trim().min(1).max(max);
/**
 * 강조 표시를 받는 글 칸 — 원장 2026-11-06 *"중요한 문구에는 색상이나 볼드 등 서식을 자유롭게"*.
 * 글자 수는 **표시를 뺀 글**로 잰다(표시 때문에 쓸 말이 모자라지 않게) · 표시까지 넣은 원문은 1.3배까지.
 */
const richText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(Math.ceil(max * 1.3))
    .refine((v) => {
      // 원문 상한을 넘었으면 표시를 풀지 않는다 — zod는 .max가 실패해도 refine을 돌리고, 닫히지 않은 표시가 많은 아주 긴 글은
      // 푸는 데 오래 걸린다(28만 자 요약 38초 · 적대 리뷰 2026-11-09). 원문 상한 오류만으로 충분하다.
      if (v.length > Math.ceil(max * 1.3)) return true;
      const plain = plainRich(v);
      return plain.trim().length > 0 && plain.length <= max;
    }, `강조 표시를 뺀 글이 1~${max}자여야 합니다`)
    .describe(`강조 표시 가능(**굵게** · [[good:…]] · [[bad:…]] · [[warn:…]]) — 표시를 뺀 글 ${max}자까지`);

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
  z.object({ type: z.literal("summary"), text: richText(800) }),
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
  z.object({ type: z.literal("callout"), tone: z.enum(["info", "warn", "good"]), title: richText(60), text: richText(600) }),
  z.object({ type: z.literal("list"), title: z.string().trim().max(60).optional(), items: z.array(richText(200)).min(1).max(12) }),
  /**
   * 비서 의견 — 원장 2026-11-06 *"형식적인 답변이 아닌 비서답게 어떻게 처리하면 좋겠다 같은 의견 제시도 같이"*.
   * 보고서마다 하나 꼭 넣는다(`settleReport`가 없으면 돌려보낸다). 할 일 · 까닭(데이터 근거) · 언제 · 누가.
   */
  z.object({
    type: z.literal("advice"),
    items: z
      .array(
        z.object({
          action: richText(160),
          why: richText(300),
          when: z.enum(["today", "this_week", "this_month", "watch"]).optional(),
          who: z.string().trim().max(30).optional(),
          /** 제안 → 결과 → 학습(2026-11-09) — 주제 · 방법 · 확인 지표(나중에 다시 잴 숫자) 또는 잴 수 없는 까닭(advice.ts). */
          topic: z.enum(ADVICE_TOPICS).optional(),
          method: z.enum(ADVICE_METHODS).optional(),
          check: AdviceCheckSchema.optional().describe("결과 지표 — 이 일을 해서 바라는 결과가 났나"),
          /** 실행 지표 · 대상 명단(s2_0038 · 2026-11-09 답 검토 — 일을 했는지와 결과가 났는지를 나눠 보고, 다시 잴 대상을 굳힌다). */
          doneCheck: AdviceCheckSchema.optional().describe("실행 지표 — 할 일을 했는지(형식은 check와 같다)"),
          targets: AdviceTargetsSchema.optional(),
          noCheck: z.string().trim().min(1).max(80).optional().describe("숫자로 다시 재기 어려운 의견이면 그 까닭(확인 지표 대신)"),
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
  /**
   * 조회를 일찍 끝내고 지금까지 본 자료로 정리한 답 — 서버가 붙인다(AI가 쓰지 않는다). 화면은 보고서 위에 한 줄로 알린다.
   * `user` = 원장이 누른 '여기서 끝내고 결과 보기'(2026-11-06) · `time` = 시간이 다 됨 · `context` = 읽은 자료가 많아 정리.
   */
  cutShort?: "user" | "time" | "context";
  /**
   * 비서 의견의 처리 상태 · 확인 지표 기준값 — 서버가 의견 표(assistant_advice)에서 붙인다(보고서 JSON에 저장하지 않는다 · AI가 쓰지 않는다).
   * 없으면(의견 줄 저장 실패 · 옛 답) 화면은 처리 단추 없이 의견만 그린다.
   */
  advice?: AdviceView[];
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
  const parsed = ReportSchema.safeParse(looseAdvice(input));
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
  const blocks = parsed.data.blocks.map((raw, i): ReportBlock => {
    const block = plainTitles(raw);
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
  return { ok: true, report: { title: plainRich(parsed.data.title), blocks, datasets } };
}

/**
 * 비서 의견의 확인 지표 칸은 **느슨하게** 받는다(적대 리뷰 2026-11-09) — 지표 하나가 틀렸다고 보고서 전체(1~3분)를 다시 쓰게 하면
 * 느리고, 마무리 중에는 답 전체를 잃을 수 있다. 틀린 지표(형식 · 기간 자리 · 다시 잴 날)는 빼고 '확인 지표를 만들지 못했습니다'로,
 * 목록 밖 주제·방법은 빼고, 긴 까닭은 자른다. 확인 지표와 까닭이 둘 다 있으면 지표를 쓴다. 나머지 보고서 검사는 그대로.
 */
function looseAdvice(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.blocks)) return input;
  return {
    ...input,
    blocks: input.blocks.map((block: unknown) => {
      if (!isRecord(block) || block.type !== "advice" || !Array.isArray(block.items)) return block;
      return {
        ...block,
        items: block.items.map((raw: unknown) => {
          if (!isRecord(raw)) return raw;
          const item: Record<string, unknown> = { ...raw };
          if (!(ADVICE_TOPICS as readonly unknown[]).includes(item.topic)) delete item.topic;
          if (!(ADVICE_METHODS as readonly unknown[]).includes(item.method)) delete item.method;
          if (typeof item.noCheck === "string") {
            const reason = item.noCheck.trim().slice(0, 80);
            if (reason) item.noCheck = reason;
            else delete item.noCheck;
          } else delete item.noCheck;
          // 대상 명단 — 틀리면 명단만 뺀다(지표 검사는 명단 없이).
          const targets = item.targets === null || item.targets === undefined ? null : AdviceTargetsSchema.safeParse(item.targets);
          if (targets?.success) item.targets = targets.data;
          else delete item.targets;
          const fixed = targets?.success ? targets.data : null;
          // 실행 지표 — 틀리면 그 지표만 뺀다(의견·결과 지표는 그대로).
          if (item.doneCheck !== null && item.doneCheck !== undefined) {
            const done = AdviceCheckSchema.safeParse(item.doneCheck);
            if (done.success && !checkTemplateProblem(done.data) && !checkIntegrityProblem(done.data, { targets: fixed, outcome: false })) item.doneCheck = done.data;
            else delete item.doneCheck;
          } else delete item.doneCheck;
          // 모델은 선택 칸을 null로 채우곤 한다 — 지표가 없다는 뜻일 뿐, 적어 둔 까닭을 지우지 않는다(재리뷰 2026-11-09).
          if (item.check === null || item.check === undefined) delete item.check;
          else {
            const check = AdviceCheckSchema.safeParse(item.check);
            if (check.success && !checkTemplateProblem(check.data) && !checkIntegrityProblem(check.data, { targets: fixed, outcome: true })) {
              item.check = check.data;
              delete item.noCheck;
            } else {
              delete item.check;
              item.noCheck = CHECK_FAILED;
            }
          }
          return item;
        }),
      };
    }),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 제목·이름 칸(보고서·차트·표 제목 · 계열·칸 이름 · KPI 이름·값·단위 · 목록 제목 · 담당)은 강조 표시를 벗긴다 —
 * 화면이 이미 굵게 그리거나 낭독·파일 이름·알림 글로 쓰이는 칸이라 `**`가 글자로 보이지 않게. 글 칸(rich)은 그대로.
 * KPI `ref` 값은 settleReport가 DB 값으로 바꾼다(DB 값은 건드리지 않는다).
 */
function plainTitles(block: ReportBlock): ReportBlock {
  switch (block.type) {
    case "chart":
      return { ...block, title: plainRich(block.title), series: block.series.map((s) => ({ ...s, label: plainRich(s.label) })), ...(block.unit ? { unit: plainRich(block.unit) } : {}) };
    case "table":
      return { ...block, title: plainRich(block.title), columns: block.columns.map((c) => ({ ...c, label: plainRich(c.label) })) };
    case "kpi":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          label: plainRich(item.label),
          ...(typeof item.value === "string" ? { value: plainRich(item.value) } : {}),
          ...(item.unit ? { unit: plainRich(item.unit) } : {}),
          ...(item.deltaLabel ? { deltaLabel: plainRich(item.deltaLabel) } : {}),
        })),
      };
    case "list":
      return block.title ? { ...block, title: plainRich(block.title) } : block;
    case "advice":
      return { ...block, items: block.items.map((item) => (item.who ? { ...item, who: plainRich(item.who) } : item)) };
    default:
      return block;
  }
}
