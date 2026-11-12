/**
 * 학원 비서 AI 루프 — Claude가 `describe_table`·`run_sql`로 이 지점 DB를 확인하고 `render_report`로 보고서를 낸다.
 * DB·Claude 클라이언트·이벤트는 밖에서 받는다(시험이 가짜를 넣는다). 권한·라이선스·저장·사용량 장부는 부르는 쪽(`ask.ts`) 몫.
 *
 * - 진행 단계(`step` 이벤트)를 실시간으로 내보낸다 — 원장 *"진짜 Ai 대화하는것처럼 어떤 db를 조회중이고 어떤 프로그레스중인지 단계가 표시"*.
 *   AI가 도구 입력을 쓰기 시작하는 순간(스트림의 content_block_start) 단계를 열고, 입력이 들어오는 대로(inputJson) 목적을 붙인다.
 * - 대화 기록은 덧붙이기만 한다(이전 차례의 응답 블록을 고치거나 빼지 않는다 — 생각 블록이 그 대화에 묶여 있다).
 * - 도구 입력은 즉시 스트리밍(`eager_input_streaming`)이라 서버가 검증하지 않는다 → 여기서 zod로 검증하고, 틀리면 오류 결과로 돌려준다.
 * - 조회는 한 연결에서 차례로(병렬 도구 호출도 순서대로 실행).
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { REPORT_TOOL_SCHEMA, settleReport, type QueryResult, type ReportBlock, type SettledReport } from "../report";
import { baselineWindow, fillWindow, formatCheckValue, readCheckRow, type AdviceCheck, type AdviceCheckResult } from "../advice";
import { fillTargets } from "../advice-targets";
import type { AskStep, StepKind, StepTable } from "../protocol";
import type { AssistantTableDoc } from "../catalog/types";
import { clipText } from "../text";
import { checkAssistantSql } from "./sql-gate";
import { hiddenColumnsUsed } from "../scope";
import { buildSystemPrompt, catalogLines, pastAnswerText, questionMessage, type PastTurn } from "./prompt";
import {
  addDays,
  coverageOf,
  isRealYmd,
  kstYmd,
  runSurvey,
  SURVEY_TARGET_LABEL,
  surveyForModel,
  surveyPlan,
  taughtClassesSql,
  type SurveyRecord,
  type SurveyTarget,
} from "./survey";

/**
 * 🔴 조회 횟수·차례 수 한도는 두지 않는다(원장 2026-11-06 *"한도 두지마" · "굳이 한도를 두면 알 수 없는 분석이 나올 확률이 더 높지 않나?
 *    … 분석이 정확하지않으면 하나도 의미가 없어"* — 12번 한도에 막혀 PS3A 반 분석이 영상 숙제를 못 봤다). 추론 강도는 모델·생각 깊이로 나뉜다.
 * 남는 것은 물리적 한계 둘뿐 — ① 실행 시간: 이 시각(`softDeadlineMs`, 기본값 아래)이 지나면 더 조회하지 말고 보고서를 내라고 한다
 * (고정 기한은 부르는 쪽이 signal로 끊는다 · protocol.ts ASSISTANT_HARD_DEADLINE_MS) ② AI가 한 번에 읽는 분량: 직전 차례 입력이
 * `CONTEXT_WRAP_TOKENS`를 넘으면 같은 마무리. 마무리를 부탁한 뒤에도 `WRAP_ROUNDS` 차례 안에 보고서가 없으면 멈춘다(끝없이 돌지 않게).
 * 🔴 마무리 시각이 차례 **도중**에 오면 그 응답(다음 조회를 쓰는 중)을 끊고 기록에 넣지 않은 채 곧장 보고서를 부탁한다 — 차례가 끝나기를 기다리면
 *    600초에 시작한 차례가 100초를 써 보고서 쓸 시간이 모자라 고정 기한에 모은 결과가 통째로 사라졌다(적대 리뷰 2026-11-09). 보고서를 쓰기
 *    시작한 응답은 끊지 않는다(그게 곧 결과다).
 * ③ 원장이 누른 '여기서 끝내고 결과 보기'(`wrapSignal` · 원장 2026-11-06 *"조회 멈추고, 지금까지 조회한 내용으로만 결과 출력"*) —
 *    같은 마무리를 바로 한다(쓰던 응답을 끊는 것도 같다). 보고서에는 `cutShort`로 일찍 끝낸 까닭이 붙는다.
 */
export const SOFT_DEADLINE_MS = 560_000;
export const CONTEXT_WRAP_TOKENS = 150_000;
const WRAP_ROUNDS = 3;
/** 전수 조회 한 번에 쓸 시간 상한 — 넘으면 남은 표는 '세지 못함'(조회 오류가 이어질 때 8초씩 수십 번 기다리지 않게 · 적대 리뷰 2026-11-09). */
const SURVEY_MAX_MS = 120_000;
const AI_ROWS = 200;
const AI_CELL_CHARS = 1000;
const AI_RESULT_CHARS = 20_000;

export class AssistantError extends Error {}

/** 마지막 사람 차례(질문 글 · 조회 결과 묶음)에 글 한 덩이를 붙인다 — 끊어 버린 AI 응답 대신 바로 다음 부탁을 보낼 때(앞 블록은 그대로라 캐시 접두가 같다). */
function appendToLastUser(messages: Anthropic.MessageParam[], text: string): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    messages.push({ role: "user", content: text });
    return;
  }
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  messages[messages.length - 1] = { role: "user", content: [...blocks, { type: "text", text }] };
}
/** 조회 실패 — `message`는 화면(한국어), `detail`은 AI에게 줄 원문(칸 이름 등 고칠 단서). */
export class AssistantQueryError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    /**
     * `query` = 그 조회(표·칸·형식·비용·8초) 탓 — 고치거나 표를 나눠 다시 해 볼 만하다.
     * `connection` = 연결·서버 쪽(끊김·연결 시간 초과·연결 수) — 같은 조회를 다시 해도 같다(전수 조회는 쪼개지 않고 멈춘다 · 재리뷰 2026-11-09).
     */
    readonly kind: "query" | "connection" = "query",
  ) {
    super(message);
  }
}

export type Row = Record<string, string | number | boolean | null>;
export type AssistantDb = {
  /** 비서가 읽을 수 있는 보기 이름(이 지점 · 비밀 칸을 뺀). */
  views(): Promise<ReadonlySet<string>>;
  describe(tables: string[]): Promise<Array<{ table: string; columns: Array<{ name: string; type: string }> }>>;
  /**
   * 묻는 사람의 권한 범위 밖 보기 → 거절 안내('○○ 권한이 있어야 볼 수 있는 자료입니다' · s2_0096). 없으면(시험) 범위 제한 없음.
   * 검사기가 이 이름을 '없는 표' 대신 권한 안내로 돌려보낸다 — 0건으로 답하지 않게(Codex 합의 7).
   */
  denied?(): Promise<ReadonlyMap<string, string>>;
  /** 이 표에서 묻는 사람에게 가린 칸(값은 DB가 null로 준다 · 표 구조에서도 숨긴다). */
  hiddenColumns?(table: string): ReadonlySet<string>;
  /** 볼 수 있는 보기 → 칸 이름(가린 칸 포함) — 검사기가 `별칭.이름`이 진짜 칸인지 가른다(함수를 칸처럼 부르는 꼴 막기). */
  viewColumns?(): Promise<ReadonlyMap<string, ReadonlySet<string>>>;
  /** 검사를 통과한 SQL을 읽기 전용으로 돌린다. 실패는 `AssistantQueryError`(또는 한국어 Error)로 던진다. */
  run(sql: string): Promise<{ columns: string[]; rows: Row[]; rowCount: number; truncated: boolean; ms: number }>;
};

export type AgentEvent = { type: "step"; step: AskStep };
export type AgentUsage = { model: string; usage: Anthropic.Usage };

export type AgentInput = {
  client: Pick<Anthropic, "messages">;
  model: string;
  effort: "low" | "medium" | "high";
  db: AssistantDb;
  docs: readonly AssistantTableDoc[];
  question: string;
  /** 묻는 사람의 화면 표시 역할(원장 · 관리자 …) — 질문 메시지에 붙인다(prompt.ts questionMessage · 멘트 시험 2026-11-11). */
  asker?: string;
  history: readonly PastTurn[];
  emit: (event: AgentEvent) => void;
  onUsage: (entry: AgentUsage) => Promise<void> | void;
  signal?: AbortSignal;
  now?: () => number;
  /** 마무리 시각(질문 시작부터 ms) — 부르는 쪽이 고정 기한에서 보고서 쓸 시간을 빼서 준다. 없으면 SOFT_DEADLINE_MS. */
  softDeadlineMs?: number;
  /**
   * 이 분량(직전 차례 입력 토큰)을 넘으면 마무리 — 없으면 CONTEXT_WRAP_TOKENS. '적음'(Haiku)은 입력 10만 토큰을 넘으면 단가가 5배라
   * 부르는 쪽이 더 낮게 준다(적대 리뷰 2026-11-09).
   */
  contextWrapTokens?: number;
  /** 원장이 누른 '여기서 끝내고 결과 보기' — 끊기면 더 조회하지 않고 지금까지의 결과로 보고서를 쓴다(`signal`은 질문을 버리는 멈춤). */
  wrapSignal?: AbortSignal;
  /** 읽은 보기·칸 이름 누적기(부르는 쪽이 들고 있다) — 루프가 던져도(멈춤·오류) 저장 표지에 남는다(적대 리뷰 2026-11-12). */
  used?: { tables: Set<string>; columns: Set<string> };
};

type WrapReason = "user" | "time" | "context";
/** 마무리 부탁(AI에게) — 못 본 자료는 보고서에 밝히게 한다. */
const WRAP_TEXT: Record<WrapReason, string> = {
  user: "질문한 분이 '여기서 끝내고 결과 보기'를 눌렀습니다. 더 조회하지 말고 지금까지 조회한 결과만으로 바로 render_report를 호출하세요. 요약(summary) 첫머리에 '조회를 여기서 끝내고 정리한 답'임을 밝히고, 확인하지 못한 자료는 callout info '이번에 깊이 보지 않은 자료'에 적으세요.",
  time: "시간이 다 됐습니다. 더 조회하지 말고 지금까지의 결과로 render_report를 호출하세요. 못 본 자료는 callout info '이번에 깊이 보지 않은 자료'에 적으세요.",
  context: "읽은 자료가 많아 이제 정리할 때입니다. 더 조회하지 말고 지금까지의 결과로 render_report를 호출하세요. 못 본 자료는 callout info '이번에 깊이 보지 않은 자료'에 적으세요.",
};
/** 마무리 뒤 들어온 조회를 돌려보낼 때 단계에 적는 까닭. */
const WRAP_DETAIL: Record<WrapReason, string> = {
  user: "여기서 조회를 끝냈습니다",
  time: "시간이 다 돼 여기까지 봤습니다",
  context: "읽은 자료가 많아 여기까지 봤습니다",
};

/**
 * `checks` = 비서 의견의 확인 지표(조회문 원문 포함 · 의견 순번 `itemNo` = advice 블록 items의 자리)와 기준값 — 의견 표에만 저장한다
 * (보고서 블록에서는 뺐다 — 조회문을 화면·대화 저장본으로 보내지 않는다). `askedOn` = 질문일(한국 날짜) — 기준값 기간·다시 잴 날의 기준.
 */
/** `tables`·`columns` = 이 답이 읽은 보기와 조회문에 이름으로 나온 칸(조회 · 전수 조회 · 확인 지표) — 저장 표지(필요 묶음 키 · s2_0096)의 재료. */
export type AgentResult = { report: SettledReport; queries: QueryResult[]; checks: AdviceCheckResult[]; askedOn: string; tables: string[]; columns: string[] };
/** 확인 지표 기준값 재기 전체의 상한 — 보고서가 이미 나온 뒤라 답을 늦추지 않는다(넘으면 남은 지표는 재지 않고 뺀다). */
const CHECK_BUDGET_MS = 30_000;

const DescribeInput = z.object({ tables: z.array(z.string().min(1)).min(1).max(6) });
const RunSqlInput = z.object({ purpose: z.string().trim().min(1).max(80), sql: z.string().min(1) });
// 있는 날짜만('2026-02-29'는 형식이 맞아도 없는 날 — 22008로 전수 조회 전체가 막혔다 · 적대 리뷰 2026-11-09).
const YMD = z.string().refine(isRealYmd, "있는 날짜(YYYY-MM-DD)");
const SurveyInput = z.object({
  target: z.enum(["student", "class", "teacher"]),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  from: YMD.optional(),
  to: YMD.optional(),
});

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "describe_table",
    description: "보기(표)의 칸 이름·타입과 읽는 법을 본다. SQL을 쓰기 전에 쓸 표마다 먼저 확인한다. 한 번에 6개까지.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { tables: { type: "array", items: { type: "string" }, description: "보기 이름(예: students)" } },
      required: ["tables"],
    },
  },
  {
    name: "run_sql",
    description:
      "이 지점 DB를 SELECT 한 문장으로 조회한다(읽기 전용 · 8초 · 2,000행까지 저장, 200행까지 보임). 결과에는 조회 번호(q1, q2…)가 붙는다 — 보고서의 차트·표가 이 번호를 가리킨다. purpose를 sql보다 먼저 쓴다(원장 화면의 진행 단계에 바로 뜬다).",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "이 조회로 알고 싶은 것 — 짧은 한국어(원장 화면의 진행 단계와 근거에 보인다)" },
        sql: { type: "string", description: "SELECT 문 하나" },
      },
      required: ["purpose", "sql"],
    },
  },
  {
    name: "survey_entity",
    description:
      "전수 조회 — 원생·반·강사 한 명(한 반)과 이어진 보기를 서버가 하나도 빠짐없이 찾아 전체·기간 건수와 최근 날짜를 센다(조회 번호는 붙지 않는다). 특정 대상을 분석·점검하는 질문이면 대상 id를 찾은 뒤 맨 먼저 부른다. 기간은 질문의 뜻에 맞게(시스템 '기간' 규칙) — 안 주면 원생은 전체 기간, 반·강사는 최근 6개월.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["student", "class", "teacher"], description: "student=원생 · class=반 · teacher=강사(users)" },
        id: { type: "string", description: "대상 id(uuid) — students.id · classes.id · users.id" },
        name: { type: "string", description: "대상 이름(원장 화면의 진행 단계에 보인다)" },
        from: { type: "string", description: "기간 시작 YYYY-MM-DD(포함)" },
        to: { type: "string", description: "기간 끝 YYYY-MM-DD(포함)" },
      },
      required: ["target", "id", "name"],
    },
  },
  {
    name: "render_report",
    description: "최종 답을 보고서 블록으로 낸다(한 번만 · 비서 의견 advice 블록 하나 포함). 차트·표는 query에 조회 번호를 쓰고 칸 이름으로 가리킨다.",
    eager_input_streaming: true,
    input_schema: REPORT_TOOL_SCHEMA as Anthropic.Tool.InputSchema,
  },
];

function clip(value: unknown): unknown {
  return typeof value === "string" ? clipText(value, AI_CELL_CHARS, "…(잘림)") : value;
}

/** AI에게 보낼 조회 결과(행·셀·전체 길이를 줄인다). */
export function resultForModel(r: QueryResult): string {
  let rows = r.rows.slice(0, AI_ROWS).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, clip(v)])));
  const note = () =>
    rows.length < r.rowCount || r.truncated
      ? `전체 ${r.truncated ? `${r.rowCount}행 이상` : `${r.rowCount}행`} 중 ${rows.length}행만 보입니다 — 필요하면 집계하거나 조건을 좁히세요. 표·차트는 저장된 전체(최대 2,000행)로 그립니다.`
      : undefined;
  let body = JSON.stringify({ query: r.id, columns: r.columns, rows, row_count: r.rowCount, note: note() });
  while (body.length > AI_RESULT_CHARS && rows.length > 1) {
    rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
    body = JSON.stringify({ query: r.id, columns: r.columns, rows, row_count: r.rowCount, note: note() });
  }
  return body;
}

function describeText(
  docs: readonly AssistantTableDoc[],
  found: Awaited<ReturnType<AssistantDb["describe"]>>,
  asked: string[],
  views: ReadonlySet<string>,
  denied: ReadonlyMap<string, string> = new Map(),
) {
  const out = asked.map((name) => {
    const live = found.find((f) => f.table === name);
    // 권한 범위 밖 보기 — 칸·설명을 주지 않고 필요한 권한만 알린다(숨긴 표의 내용·건수는 말하지 않는다 · Codex 합의 7).
    const blocked = denied.get(name);
    if (blocked && !views.has(name)) return { table: name, error: `${blocked} — 묻는 분의 권한 밖이라 조회할 수 없습니다` };
    if (!live || !views.has(name)) {
      const near = [...views].filter((v) => v.includes(name) || name.includes(v)).slice(0, 8);
      return { table: name, error: `없는 보기입니다${near.length ? ` — 비슷한 이름: ${near.join(", ")}` : ""}` };
    }
    const doc = docs.find((d) => d.name === name);
    return {
      table: name,
      ko: doc?.ko,
      notes: doc?.notes,
      columns: live.columns.map((c) => ({ name: c.name, type: c.type, ...(doc?.columns?.[c.name] ? { ko: doc.columns[c.name] } : {}) })),
    };
  });
  return JSON.stringify(out);
}

/**
 * 조회가 묻는 사람에게 가린 칸(DB가 null로 준다 · s2_0096)을 이름으로 썼으면 AI에게 한 줄 알린다 — 비어 나온 값을 '없음'으로 쓰지 않게.
 * 별칭·표 구분 없이 칸 이름으로만 본다(넉넉하게 — 다른 표의 같은 이름 칸이어도 알린다).
 */
export function hiddenColumnNote(db: Pick<AssistantDb, "hiddenColumns">, tables: readonly string[], columns: readonly string[]): string | null {
  if (!db.hiddenColumns) return null;
  const hits = hiddenColumnsUsed(tables, columns, db.hiddenColumns);
  if (!hits.length) return null;
  return `⚠️ 권한 밖 칸(${hits.join(", ")})은 묻는 분에게 값이 비어 나옵니다 — 실제로 비어 있는 것이 아닙니다. 이 칸 값은 답에 쓰지 말고, 필요하면 '권한이 있어야 볼 수 있어 확인하지 않았습니다'로 밝히세요.`;
}

/** 보고서 블록에서 확인 지표(조회문 원문)를 뺀다 — 의견 표에만 둔다(화면·대화 저장본·지난 대화로 보내지 않는다 · 적대 리뷰 2026-11-09). */
function withoutChecks(report: SettledReport): SettledReport {
  return {
    ...report,
    blocks: report.blocks.map((b): ReportBlock =>
      b.type === "advice" && b.items.some((item) => item.check || item.doneCheck || item.targets) ? { ...b, items: b.items.map(stripCheck) } : b,
    ),
  };
}

/** 의견 항목에서 확인 지표(결과·실행)와 대상 명단만 뺀다(나머지 칸은 그대로 — 둘 다 의견 표에만 둔다). */
function stripCheck<T extends { check?: unknown; doneCheck?: unknown; targets?: unknown }>(item: T): Omit<T, "check" | "doneCheck" | "targets"> {
  const rest = { ...item };
  delete rest.check;
  delete rest.doneCheck;
  delete rest.targets;
  return rest;
}

/** 보고서 대신 글로 끝났을 때 — 글을 요약 블록 하나로. */
function textOnlyReport(text: string): SettledReport {
  return { title: "답변", blocks: [{ type: "summary", text: clipText(text, 800) }], datasets: {} };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}초`;

/** 전수 조회 대상의 자기 표(이 id가 그 종류인지 확인한다). */
const TARGET_TABLE: Record<SurveyTarget, string> = { student: "students", class: "classes", teacher: "users" };
/** 대상 확인 + DB 이름(강사는 이름이 같은 사용자 수도 — 수업보고서 teacher_name 글자로 세도 되는지). id는 zod uuid를 거쳤다. */
const TARGET_LOOKUP: Record<SurveyTarget, (id: string) => string> = {
  student: (id) => `select name as 이름 from students where id = '${id}'::uuid`,
  class: (id) => `select class_name as 이름 from classes where id = '${id}'::uuid`,
  teacher: (id) => `select u.display_name as 이름, (select count(*) from users v where v.display_name = u.display_name)::int as 같은이름 from users u where u.id = '${id}'::uuid`,
};
const TOOL_STEP: Record<string, { kind: StepKind; label: string }> = {
  describe_table: { kind: "schema", label: "쓸 표를 고르는 중" },
  run_sql: { kind: "write_sql", label: "조회문을 쓰는 중" },
  // 제 종류(survey) — '조회 N번'(run_sql)에 세지 않고(근거의 '조회 N건'과 맞게) 표 구조 확인과 묶여 '다시 시도'로 읽히지도 않게(적대 리뷰 · 재리뷰 2026-11-09).
  survey_entity: { kind: "survey", label: "이어진 자료를 빠짐없이 세는 중" },
  render_report: { kind: "report", label: "보고서와 비서 의견을 쓰는 중" },
};

export async function runAssistantAgent(input: AgentInput): Promise<AgentResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const docByName = new Map(input.docs.map((d) => [d.name, d]));
  const tableChip = (name: string): StepTable => ({ name, label: docByName.get(name)?.label ?? name });

  // ── 진행 단계 ──
  let seq = 0;
  const steps = new Map<string, AskStep>();
  const put = (step: AskStep) => {
    steps.set(step.id, step);
    input.emit({ type: "step", step });
  };
  const open = (kind: StepKind, label: string, extra: Partial<AskStep> = {}): string => {
    const id = `s${++seq}`;
    put({ id, kind, label, state: "running", at: now() - started, ...extra });
    return id;
  };
  const update = (id: string, patch: Partial<AskStep>) => {
    const prev = steps.get(id);
    if (prev && prev.state === "running") put({ ...prev, ...patch });
  };
  const close = (id: string, patch: Partial<AskStep> = {}) => {
    const prev = steps.get(id);
    if (!prev || prev.state !== "running") return;
    put({ ...prev, state: "done", ms: now() - started - prev.at, ...patch });
  };

  const views = await input.db.views();
  if (views.size === 0) throw new AssistantError("조회할 수 있는 자료가 없습니다. 비서 DB 설정을 확인해 주세요");
  // 권한 범위 밖 보기(s2_0096) — 검사기가 '없는 표' 대신 '○○ 권한이 있어야 볼 수 있는 자료'로 돌려보낸다.
  const denied = (await input.db.denied?.()) ?? new Map<string, string>();
  /** 이 답이 읽은 보기·칸 이름 — 저장 표지(필요 묶음 키 · s2_0096)의 재료(조회 · 전수 조회 · 확인 지표). 부르는 쪽이 넘긴 누적기에도 쌓는다(답이 실패해도 남게). */
  const usedTables = input.used?.tables ?? new Set<string>();
  const usedColumns = input.used?.columns ?? new Set<string>();
  const note = (gate: { tables: readonly string[]; columns: readonly string[] }) => {
    for (const x of gate.tables) usedTables.add(x);
    for (const x of gate.columns) usedColumns.add(x);
  };
  // 보기 칸 목록 — 못 읽으면 검사기의 대비책(이름 목록)으로 간다(질문을 멈추지 않는다).
  const viewColumns = await input.db.viewColumns?.().catch(() => undefined);
  const gateSql = (sql: string) => checkAssistantSql(sql, views, denied, viewColumns);
  /** 전수 조회처럼 검사기를 넘겨주는 자리 — 통과한 조회문의 보기를 저장 표지에 넣는다(실행이 실패해도 넣는다 — 넉넉한 쪽). */
  const gateAndNote = async (sql: string) => {
    const gate = await gateSql(sql);
    if (gate.ok) note(gate);
    return gate;
  };
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt(catalogLines(input.docs, views), { limited: denied.size > 0 }), cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of input.history) {
    messages.push({ role: "user", content: turn.question }, { role: "assistant", content: pastAnswerText(turn) });
  }
  messages.push({ role: "user", content: questionMessage(input.question, new Date(now()), input.asker) });

  const queries: QueryResult[] = [];
  const byId = new Map<string, QueryResult>();
  let jsonRetries = 0;
  let askedForReport = false;
  let reportFailed = false;
  const softDeadline = input.softDeadlineMs ?? SOFT_DEADLINE_MS;
  /** 직전 차례에 AI가 읽은 분량(입력 + 캐시 읽기·쓰기 토큰). */
  let lastInputTokens = 0;
  const contextWrap = input.contextWrapTokens ?? CONTEXT_WRAP_TOKENS;
  /** 마무리 까닭 — 한 번 정해지면 그대로(그 뒤 조회·표 구조·전수 조회는 실행하지 않는다). */
  let wrapping: WrapReason | null = null;
  let wrapRounds = 0;
  /** 마무리 부탁을 AI에게 이미 보냈나. */
  let wrapAsked = false;
  const wrapReason = (): WrapReason | null => {
    if (!wrapping) {
      // 원장 마무리는 자료(조회 · 전수 조회)를 하나라도 읽은 뒤에 든다 — 그 전에 누른 것은 첫 자료를 읽자마자 든다(다른 탭의 버튼은 조건을 모른다 · 재리뷰 2026-11-09).
      const userWrap = !!input.wrapSignal?.aborted && (queries.length > 0 || surveys.length > 0);
      wrapping = userWrap ? "user" : now() - started > softDeadline ? "time" : lastInputTokens > contextWrap ? "context" : null;
      if (wrapping === "user") noteUserWrap();
    }
    return wrapping;
  };
  /** 원장이 누른 마무리는 진행 줄에 한 번 알린다(그 뒤 '보고서를 쓰는 중'이 이어진다). */
  const noteUserWrap = () =>
    close(open("analyze", "요청에 따라 여기서 조회를 끝냈습니다 — 지금까지 조회한 내용으로 정리합니다"), { detail: `조회 ${queries.length}번까지` });
  /** 전수 조회 기록 — 그 뒤 성공한 조회가 읽은 보기를 각 기록의 `examined`에 쌓는다(확인한 자료 범위의 '내용 조회'). */
  const surveys: SurveyRecord[] = [];
  const askedOn = kstYmd(started);
  const finish = (report: SettledReport, checks: AdviceCheckResult[] = []): AgentResult => ({
    report: {
      ...withoutChecks(report),
      ...(surveys.length ? { coverage: coverageOf(surveys) } : {}),
      // 조회를 일찍 끝내고 정리한 답 — 화면이 보고서 위에 한 줄로 알린다.
      ...(wrapping ? { cutShort: wrapping } : {}),
    },
    queries,
    checks,
    askedOn,
    tables: [...usedTables].sort(),
    columns: [...usedColumns].sort(),
  });

  /**
   * 비서 의견의 확인 지표 기준값(제안 → 결과 → 학습 1단계 · 2026-11-09) — 조회문 틀을 [질문일 − 2일 − 기간, 질문일 − 2일)로 채워
   * 같은 검사기·읽기 전용 실행기로 잰다(advice.ts baselineWindow).
   * 🔴 보고서는 이미 나왔다 — 여기서는 답을 버리지 않는다(적대 리뷰 2026-11-09): AI에게 보고서를 다시 쓰게 하지 않고(1~3분 · 그 차례가
   *    실패하면 맞던 답까지 잃는다) 틀리거나 못 잰 지표는 기준값 없이 넘겨 '확인 지표를 만들지 못했습니다'로 남긴다(advice.ts adviceDrafts).
   *    멈춤·고정 기한 신호가 왔거나 상한(30초)을 넘으면 남은 지표는 재지 않는다. 단계 종류는 '보고서' — '조회 N번'에 세지 않는다.
   */
  const measureOne = async (check: AdviceCheck, label: string, targets: readonly string[] | undefined): Promise<{ from: string; to: string; value: number; sample: number | null } | null> => {
    const { from, to } = baselineWindow(askedOn, check.windowDays);
    const stepId = open("report", `${label} 기준값 · ${clipText(check.label, 40)}`);
    const measured = await (async (): Promise<{ value: number; sample: number | null } | string> => {
      let gate: Awaited<ReturnType<typeof checkAssistantSql>>;
      try {
        // 대상 자리는 굳힌 명단으로 채운다(s2_0039 · 저장은 틀 그대로 — 다시 잴 때도 같은 명단으로 채운다).
        gate = await gateSql(fillTargets(fillWindow(check.sql, from, to), targets));
      } catch {
        return "조회문을 검사하지 못했습니다(일시 오류)";
      }
      if (!gate.ok) return `쓸 수 없는 조회입니다 — ${gate.reason}`;
      // 묻는 분에게 가린 칸(값이 null로 온다)으로는 재지 않는다 — null을 0으로 세어 기준값이 틀린다(적대 리뷰 2026-11-12).
      const masked = input.db.hiddenColumns ? hiddenColumnsUsed(gate.tables, gate.columns, input.db.hiddenColumns) : [];
      if (masked.length) return `권한 밖 칸(${masked.join(", ")})을 써서 잴 수 없습니다`;
      note(gate); // 실행이 실패해도 오류 원문이 그 자료를 담을 수 있다 — 검사를 지난 때 표지에 남긴다
      try {
        const ran = await input.db.run(gate.sql);
        const read = readCheckRow(ran, check.unit);
        return read.ok ? { value: read.value, sample: read.sample } : read.error;
      } catch (error) {
        // 화면·저장본에 남는 단계 설명이라 한국어 요약만(DB 원문 detail은 싣지 않는다 — 일반 조회 단계와 같다 · 재리뷰 2026-11-09).
        return error instanceof Error ? error.message : "조회 오류";
      }
    })();
    if (typeof measured === "string") {
      close(stepId, { detail: `재지 못해 ${label} 없이 둡니다 — ${clipText(measured, 80)}` });
      return null;
    }
    close(stepId, { detail: `기준값 ${formatCheckValue(measured.value, check.unit)}` });
    return { from, to, ...measured };
  };
  const measureChecks = async (report: SettledReport): Promise<AdviceCheckResult[]> => {
    const out: AdviceCheckResult[] = [];
    const block = report.blocks.find((b) => b.type === "advice");
    const items = block?.type === "advice" ? block.items : [];
    const begun = now();
    const outOfTime = () => !!input.signal?.aborted || wrapping === "user" || now() - begun > CHECK_BUDGET_MS;
    for (const [i, item] of items.entries()) {
      const check = item.check;
      if (!check) continue;
      // 원장이 '바로 결과 보기'를 눌렀으면 재지 않는다(답을 더 늦추지 않는다 · 재리뷰 2026-11-09).
      if (outOfTime()) {
        out.push({ itemNo: i, check, baseline: null, skipped: true, ...(item.targets ? { targets: item.targets } : {}) });
        continue;
      }
      const baseline = await measureOne(check, "확인 지표", item.targets?.ids);
      // 실행 지표(s2_0039) — 결과 지표를 잰 의견만 · 시간이 남으면 잰다(못 재도 지표는 남긴다 — 처음 값만 없다).
      const done = item.doneCheck;
      const doneCheck = done ? { check: done, baseline: outOfTime() ? null : await measureOne(done, "실행 지표", item.targets?.ids) } : undefined;
      out.push({ itemNo: i, check, baseline, ...(doneCheck ? { doneCheck } : {}), ...(item.targets ? { targets: item.targets } : {}) });
    }
    return out;
  };

  for (let round = 0; ; round++) {
    if (input.signal?.aborted) throw new AssistantError("질문을 멈췄습니다");
    const wrapNow = wrapReason();
    // 마무리가 정해졌는데 아직 부탁하지 않았다(차례 사이에 시각이 됨 · 끊은 응답 뒤) — 마지막 사람 차례에 붙여 이번 응답부터 보고서를 쓰게 한다.
    if (wrapNow && !wrapAsked) {
      appendToLastUser(messages, WRAP_TEXT[wrapNow]);
      wrapAsked = true;
    }
    const thinking = open(
      round === 0 && !wrapNow ? "understand" : "analyze",
      wrapNow ? "지금까지 조회한 내용으로 보고서를 쓰는 중" : round === 0 ? "질문을 이해하는 중" : "결과를 살펴보는 중",
    );
    /** 이번 차례에 열린 도구 단계(content_block 순서 = 응답의 tool_use 순서). */
    const toolSteps: Array<{ name: string; stepId: string }> = [];
    let currentTool: { name: string; stepId: string } | null = null;
    // 이 차례의 응답만 끊는 손잡이 — 멈춤(signal)은 질문째, 마무리 시각·'바로 결과 보기'(wrapSignal)는 이 응답만 버리고 보고서를 부탁한다
    // (이미 마무리 중이거나 보고서를 쓰기 시작한 응답은 끊지 않는다).
    const roundCut = new AbortController();
    /** 이 응답을 끊은 까닭(마무리) — 없으면 끊지 않았다. */
    let cutFor: "time" | "user" | null = null;
    const cut = (why: "time" | "user") => {
      if (wrapNow || cutFor || toolSteps.some((t) => t.name === "render_report")) return;
      cutFor = why;
      roundCut.abort();
    };
    const onStop = () => roundCut.abort();
    // 자료를 읽기 전이면 끊지 않는다 — 첫 자료를 읽은 뒤 차례에서 마무리가 든다.
    const onWrap = () => {
      if (queries.length > 0 || surveys.length > 0) cut("user");
    };
    input.signal?.addEventListener("abort", onStop, { once: true });
    input.wrapSignal?.addEventListener("abort", onWrap, { once: true });
    const msLeft = softDeadline - (now() - started);
    const wrapTimer = wrapNow || msLeft <= 0 ? null : setTimeout(() => cut("time"), msLeft);

    let message: Anthropic.Message;
    /** 끝까지 못 받은 응답의 사용량을 읽을 곳 — 흐름은 try 안에서 만든다(동기로 던져도 타이머·리스너가 finally에서 풀린다 · 재리뷰 2026-11-09). */
    let partialOf: { readonly currentMessage?: Anthropic.Message | undefined } | undefined;
    try {
      const stream = input.client.messages.stream(
        {
          model: input.model,
          max_tokens: 32_000,
          thinking: { type: "adaptive" },
          output_config: { effort: input.effort },
          // 대화 기록(앞 차례의 조회 결과 — 각 최대 2만 자) 캐시 — 마지막 블록에 표시가 자동으로 붙는다. 시스템 앞부분은 위에서 따로 캐시.
          cache_control: { type: "ephemeral" },
          system,
          tools: ASSISTANT_TOOLS,
          messages,
        },
        { signal: roundCut.signal },
      );
      partialOf = stream;
      if (typeof stream.on === "function") {
        stream.on("streamEvent", (event) => {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            close(thinking);
            const name = event.content_block.name;
            const spec = name === "render_report" && reportFailed ? { kind: "fix" as const, label: "보고서를 고쳐 다시 쓰는 중" } : TOOL_STEP[name];
            if (!spec) return;
            currentTool = { name, stepId: open(spec.kind, spec.label) };
            toolSteps.push(currentTool);
          } else if (event.type === "content_block_stop") {
            currentTool = null;
          }
        });
        stream.on("inputJson", (_partial, snapshot) => {
          const tool = currentTool;
          if (!tool || !snapshot || typeof snapshot !== "object") return;
          const s = snapshot as { purpose?: unknown; tables?: unknown };
          if (tool.name === "run_sql" && typeof s.purpose === "string" && s.purpose.trim()) {
            update(tool.stepId, { label: `조회문을 쓰는 중 · ${clipText(s.purpose.trim(), 80)}` });
          } else if (tool.name === "describe_table" && Array.isArray(s.tables)) {
            const names = s.tables.filter((t): t is string => typeof t === "string" && views.has(t));
            if (names.length) update(tool.stepId, { tables: names.map(tableChip) });
          }
        });
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      const forWrap: "time" | "user" | null = input.signal?.aborted ? null : cutFor;
      for (const t of toolSteps) {
        close(
          t.stepId,
          forWrap ? { state: "error", cause: forWrap === "user" ? "user" : "limit", detail: WRAP_DETAIL[forWrap] } : { state: "error", detail: "AI 응답을 끝까지 받지 못했습니다" },
        );
      }
      close(thinking);
      // 끝까지 못 받은 차례도 쓴 토큰은 적는다(멈춤·끊김·도구 입력 JSON 재시도 — 적대 리뷰 2026-11-06).
      const partial = partialOf?.currentMessage;
      if (partial?.usage) await input.onUsage({ model: partial.model || input.model, usage: partial.usage });
      if (forWrap) {
        // 끊은 응답은 기록에 넣지 않는다(덧붙이기만 — 생각 블록이 어긋나지 않는다). 다음 차례 시작에서 마지막 사람 차례에 마무리 부탁을 붙인다.
        // 까닭은 여기서 정한다 — 타이머가 1ms 일찍 울면 '시각이 지났나' 판정이 아직 거짓이라 다음 차례가 보통 차례로 돌았다(재리뷰 2026-11-09).
        if (!wrapping) {
          wrapping = forWrap;
          if (forWrap === "user") noteUserWrap();
        }
        if (wrapRounds++ >= WRAP_ROUNDS) throw new AssistantError("자료를 다 모았지만 보고서를 정리하지 못했습니다. 다시 물어봐 주세요");
        continue;
      }
      if (error instanceof Anthropic.APIError || jsonRetries++ >= 2) throw error;
      continue; // 도구 입력 JSON을 끝까지 읽지 못한 차례 — 다시 묻는다
    } finally {
      if (wrapTimer) clearTimeout(wrapTimer);
      input.signal?.removeEventListener("abort", onStop);
      input.wrapSignal?.removeEventListener("abort", onWrap);
    }
    close(thinking);
    await input.onUsage({ model: message.model || input.model, usage: message.usage });
    lastInputTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);

    if (message.stop_reason === "refusal") throw new AssistantError("AI가 이 질문에는 답하지 않았습니다. 질문을 바꿔 다시 물어봐 주세요");
    if (message.stop_reason === "max_tokens") throw new AssistantError("답이 너무 길어 끊겼습니다. 질문을 나눠서 물어봐 주세요");

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!askedForReport) {
        askedForReport = true;
        messages.push({ role: "assistant", content: message.content }, { role: "user", content: "render_report 도구로 답을 보고서로 내 주세요." });
        continue;
      }
      if (text) return finish(textOnlyReport(text));
      throw new AssistantError("AI가 답을 내지 못했습니다. 잠시 뒤 다시 물어봐 주세요");
    }

    // 스트림 이벤트가 없던 경우(시험 · 끊긴 스트림)에도 도구마다 단계 하나.
    const stepFor = toolUses.map((call, i) => {
      const seen = toolSteps[i];
      if (seen && seen.name === call.name) return seen.stepId;
      const spec = call.name === "render_report" && reportFailed ? { kind: "fix" as const, label: "보고서를 고쳐 다시 쓰는 중" } : (TOOL_STEP[call.name] ?? { kind: "analyze" as const, label: call.name });
      return open(spec.kind, spec.label);
    });

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    const reportCalls: Array<{ call: Anthropic.ToolUseBlock; stepId: string }> = [];
    for (const [i, call] of toolUses.entries()) {
      if (call.name === "render_report") {
        reportCalls.push({ call, stepId: stepFor[i]! });
        continue;
      }
      results.push(await runTool(call, stepFor[i]!));
    }
    for (const { call, stepId } of reportCalls) {
      // 마무리 중(조회가 막힘)이면 돌려보내는 검사를 끈다 — 고칠 길이 없어 답을 잃는다(report-checks.ts · 재리뷰 2026-11-11).
      // 🔴 wrapReason()을 부르지 않는다 — 그 함수는 마무리 상태를 정해 버려 스스로 끝낸 답에 '일찍 끝낸 답' 띠가 붙는다(최종 리뷰 2026-11-11).
      const settled = settleReport(call.input, byId, { lenient: wrapping !== null });
      if (settled.ok) {
        close(stepId, { label: "보고서 · 비서 의견 작성", detail: `블록 ${settled.report.blocks.length}개` });
        return finish(settled.report, await measureChecks(settled.report));
      }
      reportFailed = true;
      close(stepId, { state: "error", label: "보고서 확인", detail: "조회 결과와 맞지 않는 곳이 있어 고칩니다" });
      results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `보고서를 고쳐 다시 내 주세요:\n${settled.errors.join("\n")}` });
    }
    const reason = wrapReason();
    if (reason && wrapRounds++ >= WRAP_ROUNDS) {
      throw new AssistantError("자료를 다 모았지만 보고서를 정리하지 못했습니다. 다시 물어봐 주세요");
    }
    messages.push({ role: "user", content: reason ? [...results, { type: "text", text: WRAP_TEXT[reason] }] : results });
    if (reason) wrapAsked = true;
  }

  async function runTool(call: Anthropic.ToolUseBlock, stepId: string): Promise<Anthropic.ToolResultBlockParam> {
    const fail = (content: string): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: call.id, is_error: true, content });
    if (call.name === "describe_table" || call.name === "run_sql" || call.name === "survey_entity") {
      const reason = wrapReason();
      if (reason) {
        close(stepId, { state: "error", cause: reason === "user" ? "user" : "limit", detail: WRAP_DETAIL[reason] });
        return fail("더 조회하지 말고 지금까지의 결과로 render_report를 호출하세요. 못 본 자료는 callout info '이번에 깊이 보지 않은 자료'에 적으세요.");
      }
    }
    if (call.name === "survey_entity") {
      const parsed = SurveyInput.safeParse(call.input);
      if (!parsed.success) {
        close(stepId, { state: "error", detail: "전수 조회 대상을 읽지 못했습니다" });
        return fail(`INVALID_INPUT: target(student·class·teacher)·id(uuid)·name이 필요하고 from·to는 있는 날짜(YYYY-MM-DD)입니다 — ${clipText(JSON.stringify(call.input), 300)}`);
      }
      const { target, id } = parsed.data;
      // 대상 표(원생·반·직원)가 묻는 분의 권한 밖이면 시작하지 않는다 — 대상 확인 없이 '자료 없음'으로 보고되지 않게(재리뷰 2026-11-12).
      const targetBlocked = denied.get(TARGET_TABLE[target]);
      if (targetBlocked && !views.has(TARGET_TABLE[target])) {
        close(stepId, { state: "error", detail: "권한 밖 대상입니다" });
        return fail(`${targetBlocked} — 이 대상의 전수 조회는 묻는 분의 권한 밖이라 할 수 없습니다. 볼 수 있는 자료로만 답하고, 보지 못한 부분은 이 권한이 필요하다고 밝히세요.`);
      }
      const to = parsed.data.to ?? kstYmd(now());
      // 기본 기간 — 원생은 전체(첫 상담부터의 흐름을 본다 · 원장 11-06), 반·강사는 최근 6개월.
      const from = parsed.data.from ?? (target === "student" ? "2000-01-01" : addDays(to, -180));
      if (from > to) {
        close(stepId, { state: "error", detail: "기간 시작이 끝보다 늦습니다" });
        return fail(`INVALID_INPUT: from(${from})이 to(${to})보다 늦습니다.`);
      }
      let name = parsed.data.name;
      const label = () => `전수 조회 · ${SURVEY_TARGET_LABEL[target]} ${clipText(name, 40)}과 이어진 표 전부`;
      update(stepId, { label: label() });
      // 한 줄짜리 확인 조회(검사기 → 실행기). 일시 오류면 null — 전수 조회 전체를 버리지 않는다(적대 리뷰 2026-11-09).
      const one = async (sql: string) => {
        try {
          const gate = await gateAndNote(sql);
          return gate.ok ? (await input.db.run(gate.sql)).rows : null;
        } catch {
          return null;
        }
      };
      // 🔴 대상 확인 — 다른 종류의 id(반 대상에 수강 id 등)면 모든 표가 0건이 돼 '자료 없음'으로 보고된다. 자기 표에 없으면 돌려보낸다.
      // 이름은 DB의 이름으로(AI가 준 이름이 id와 달라도 확인한 자료 범위에 맞는 이름이 남게).
      const self = await one(TARGET_LOOKUP[target](id));
      if (self && self.length === 0) {
        close(stepId, { state: "error", detail: `${SURVEY_TARGET_LABEL[target]}을(를) 찾지 못했습니다` });
        return fail(`대상을 찾지 못했습니다 — ${target} id ${id}가 ${TARGET_TABLE[target]}.id에 없습니다. 대상 종류와 id(원생 students.id · 반 classes.id · 강사 users.id)를 확인하세요.`);
      }
      const found = self?.[0]?.["이름"];
      if (typeof found === "string" && found.trim()) name = found.trim();
      update(stepId, { label: label() });
      const notes: string[] = [];
      let teacherName: string | null = null;
      let taughtClasses = 0;
      if (target === "teacher") {
        // 수업보고서는 강사를 이름 글자로 적는다 — 이름이 같은 사람이 있으면 섞이므로 세지 않는다.
        const same = self?.[0]?.["같은이름"];
        if (typeof found === "string" && found.trim() && same === 1) teacherName = found.trim();
        else if (typeof same === "number" && same > 1) notes.push(`이름이 같은 사용자가 ${same}명이라 이름 글자로 적힌 기록(수업보고서 teacher_name)은 세지 않았다 — run_sql로 이 강사의 반·날짜로 직접 확인한다.`);
        else if (self === null) notes.push("강사 확인 조회가 잠시 실패해 이름 글자로 적힌 기록(수업보고서 teacher_name)은 세지 않았다 — run_sql로 직접 확인한다.");
        // 이 기간에 맡은(맡았던) 반 — 담임·교시 담당·임시 위임(taughtClassesSql: 맡은 기간이 겹치는 것 · 폐지·보강용 반 제외).
        // 그 반들의 자료(영상 숙제 검사·반 출결 등)도 '맡은 반을 거쳐'로 센다(전수 조회 SQL이 같은 조건으로 반을 다시 고른다).
        const classes = await one(`select count(*)::int as 반수 from (${taughtClassesSql(id, from, to)}) x`);
        const n = classes?.[0]?.["반수"];
        taughtClasses = typeof n === "number" ? n : 0;
        notes.push(
          classes === null
            ? "맡은 반을 읽지 못해 강사와 직접 이어진 표만 셌다 — 맡은 반 자료는 반 전수 조회로 확인한다."
            : `이 기간에 맡은(맡았던) 반 ${taughtClasses}개를 거친 자료도 셌다(담임·교시 담당·임시 위임 · 맡은 기간이 이 기간과 겹치는 반 · 폐지·보강용 반 제외). 그 반의 이 기간 자료 전체라 다른 강사 몫·맡기 전후 자료도 섞인다 — 강사 몫은 run_sql로 가린다.`,
        );
      }
      try {
        const described = await input.db.describe([...views]);
        const plan = surveyPlan(target, described, input.docs, { teacherName, withTaughtClasses: taughtClasses > 0 });
        const record: SurveyRecord = { target, id, name, from, to, rows: [], examined: new Set() };
        const surveyStarted = now();
        record.rows = await runSurvey(input.db, gateAndNote, plan.tables, {
          id,
          from,
          to,
          teacherName,
          isQueryError: (e) => e instanceof AssistantQueryError && e.kind === "query",
          // 멈춤 · 마무리 시각 · 이 전수 조회가 2분을 넘으면 남은 묶음은 세지 않는다(센 데까지만 — '세지 못함'으로 남긴다).
          shouldStop: () => {
            if (input.signal?.aborted) return "질문을 멈췄습니다";
            const reason = wrapReason();
            if (reason) return WRAP_DETAIL[reason];
            return now() - surveyStarted > SURVEY_MAX_MS ? "세는 데 시간이 많이 들어 여기서 멈췄습니다 — run_sql로 직접 확인" : null;
          },
        });
        surveys.push(record);
        const withData = record.rows.filter((r) => (r.inPeriod ?? r.total ?? 0) > 0).length;
        close(stepId, { label: label(), detail: `표 ${record.rows.length}개 · 자료 있는 표 ${withData}개` });
        return { type: "tool_result", tool_use_id: call.id, content: surveyForModel(target, name, from, to, record.rows, { internal: plan.internal, notes }) };
      } catch (error) {
        close(stepId, { state: "error", label: label(), detail: "전수 조회를 하지 못했습니다" });
        return fail(`전수 조회 오류: ${clipText(error instanceof Error ? error.message : String(error), 300)} — run_sql로 직접 확인하세요.`);
      }
    }
    if (call.name === "describe_table") {
      const parsed = DescribeInput.safeParse(call.input);
      if (!parsed.success) {
        close(stepId, { state: "error", detail: "표 이름을 읽지 못했습니다" });
        return fail(`INVALID_INPUT: tables는 보기 이름 1~6개입니다 — ${clipText(JSON.stringify(call.input), 300)}`);
      }
      const asked = [...new Set(parsed.data.tables)];
      const known = asked.filter((t) => views.has(t));
      let found: Awaited<ReturnType<AssistantDb["describe"]>>;
      try {
        found = await input.db.describe(known);
      } catch {
        // 일시적인 DB 오류로 질문 전체를 버리지 않는다 — 이 도구만 실패로 돌려준다(적대 리뷰 2026-11-06).
        close(stepId, { state: "error", detail: "표 구조를 읽지 못했습니다" });
        return fail("표 구조를 읽지 못했습니다(일시 오류). 한 번 더 시도하거나, 이미 아는 칸으로 조회하세요.");
      }
      close(stepId, { label: "표 구조 확인", tables: known.map(tableChip), detail: `${known.length}개` });
      return { type: "tool_result", tool_use_id: call.id, content: describeText(input.docs, found, asked, views, denied) };
    }
    if (call.name === "run_sql") {
      const parsed = RunSqlInput.safeParse(call.input);
      if (!parsed.success) {
        close(stepId, { state: "error", detail: "조회문을 읽지 못했습니다" });
        return fail(`INVALID_INPUT: purpose·sql이 필요합니다 — ${clipText(JSON.stringify(call.input), 300)}`);
      }
      const purpose = parsed.data.purpose;
      let gate: Awaited<ReturnType<typeof checkAssistantSql>>;
      try {
        gate = await gateSql(parsed.data.sql);
      } catch {
        // 검사기(wasm) 로드 실패 등 — 검사하지 못한 조회는 돌리지 않고 이 도구만 실패로 돌려준다.
        close(stepId, { state: "error", label: `조회문 작성 · ${purpose}`, detail: "조회문을 검사하지 못했습니다" });
        return fail("조회문을 검사하지 못했습니다(일시 오류). 같은 조회를 한 번 더 시도하세요.");
      }
      if (!gate.ok) {
        close(stepId, { state: "error", label: `조회문 작성 · ${purpose}`, detail: `쓸 수 없는 조회라 고칩니다 — ${gate.reason}` });
        return fail(`조회를 실행하지 않았습니다: ${gate.reason}`);
      }
      close(stepId, { label: `조회문 작성 · ${purpose}` });
      const id = `q${queries.length + 1}`;
      const queryStep = open("query", `조회 ${queries.length + 1} · ${purpose}`, { tables: gate.tables.map(tableChip) });
      try {
        note(gate); // 실행이 실패해도 오류 원문(값이 실린다)이 AI로 간다 — 검사를 지난 때 표지에 남긴다
        const out = await input.db.run(gate.sql);
        const result: QueryResult = { id, purpose, sql: gate.sql, ...out };
        queries.push(result);
        byId.set(id, result);
        // 확인한 자료 범위 — 이 조회 전에 한 전수 조회에 '그 뒤에 본 표'로 쌓는다(대상 id를 찾던 앞 조회는 세지 않는다).
        // 대상이 여럿이면 SQL에 그 대상 id가 든 전수 조회에만, 아무 id도 없으면 가장 최근 전수 조회에(뒤 대상의 조회가 앞 대상까지 ✓로 만들지 않게 · 재리뷰 2026-11-09).
        const named = surveys.filter((sv) => gate.sql.includes(sv.id));
        for (const sv of named.length ? named : surveys.slice(-1)) for (const t of gate.tables) sv.examined.add(t);
        close(queryStep, { detail: `${out.truncated ? `${out.rowCount}행 이상` : `${out.rowCount}행`} · ${seconds(out.ms)}` });
        const masked = hiddenColumnNote(input.db, gate.tables, gate.columns);
        return { type: "tool_result", tool_use_id: call.id, content: masked ? `${resultForModel(result)}\n\n${masked}` : resultForModel(result) };
      } catch (error) {
        const shown = error instanceof Error ? error.message : "조회 오류";
        const forModel = error instanceof AssistantQueryError ? `${error.message} — ${error.detail}` : shown;
        close(queryStep, { state: "error", detail: shown });
        return fail(`조회 오류: ${forModel}`);
      }
    }
    close(stepId, { state: "error", detail: "모르는 도구" });
    return fail(`모르는 도구입니다: ${call.name}`);
  }
}
