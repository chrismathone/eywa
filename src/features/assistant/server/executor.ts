import "server-only";
/**
 * 학원 비서 DB 실행기 — 전용 로그인 역할 `aywa_assistant`(env `ASSISTANT_DATABASE_URL`)로 붙는다. 이 역할은 `assistant.*` 보기만 읽는다.
 * 조회 한 번 = 거래 하나(SQL s2_0031 §3):
 *   서버 키로 지점 증표 발급(DB 서명 · 5분) → begin read only → 증표 · 8초 · search_path → 증표가 이 지점인지 확인 →
 *   EXPLAIN VERBOSE(함수 · 비용 확인) → 세이브포인트 안에서 조회(확장 질의 방식) → 잠금 모두 풀기 → rollback.
 * 🔴 비서 역할은 쓰기 함수가 하나도 없고 증표를 만들 수 없다 — 증표는 service_role만 발급한다(적대 리뷰 2026-11-06).
 * 질문마다 연결 하나를 열고 닫는다(서버리스 · 거래 방식 풀러). 보기는 질문 시작에 '바뀌었을 때만' 다시 만든다(service_role RPC).
 */
import postgres from "postgres";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportWarning } from "@/lib/observability/report-error";
import { clipText } from "../text";
import { AssistantError, AssistantQueryError, type AssistantDb, type Row } from "./agent";
import { wrapAssistantSql } from "./sql-gate";

/** 저장·화면용 행 상한(+1을 읽어 잘렸는지 안다). */
export const ASSISTANT_ROW_LIMIT = 2000;
/** EXPLAIN 총비용 상한 — 넘으면 돌리지 않고 AI에게 좁히라고 돌려준다. 운영 실측(2026-11-06): 월별 집계 100 · 6개월 출결 2천 · 활동 기록 전체 1만 · 원생×출결 교차 조인 40만. */
export const ASSISTANT_COST_LIMIT = 5_000_000;
const STATEMENT_TIMEOUT = "8s";
/**
 * 확장 질의 방식(한 문장만) — postgres.js는 인자 없는 `unsafe()`를 단순 질의(여러 문장 허용)로 보낸다
 * (`src/index.js` unsafe: `simple: 'simple' in options ? options.simple : args.length === 0`). 타입 정의에는 `simple`이 없어 형변환한다.
 */
const EXTENDED = { simple: false } as unknown as postgres.UnsafeQueryOptions;

type Sql = ReturnType<typeof postgres>;
class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super("rollback");
  }
}

/** Postgres 오류 → 화면 한국어 + AI용 원문. */
export function queryError(error: unknown): AssistantQueryError {
  const e = error as { code?: string; message?: string };
  const raw = e?.message ?? String(error);
  const ko: Record<string, string> = {
    "57014": "8초 안에 끝나지 않았습니다 — 기간·조건을 좁히거나 집계해 주세요",
    "42703": "없는 칸을 썼습니다",
    "42P01": "없는 표를 썼습니다",
    "42883": "쓸 수 없는 함수나 연산자입니다",
    "42804": "값의 타입이 맞지 않습니다",
    "22P02": "값의 형식이 맞지 않습니다",
    "22007": "날짜 형식이 맞지 않습니다",
    "22008": "날짜 범위가 맞지 않습니다",
    "22012": "0으로 나눴습니다 — nullif로 감싸 주세요",
    "42501": "볼 수 없는 자료입니다",
    "25006": "조회만 할 수 있습니다",
    "42601": "문법이 맞지 않습니다",
    "42803": "GROUP BY가 맞지 않습니다",
    "21000": "하위 조회가 여러 줄을 돌려줍니다",
    "53200": "조회가 너무 큽니다 — 집계하거나 조건을 좁혀 주세요",
    "54000": "조회가 너무 큽니다 — 집계하거나 조건을 좁혀 주세요",
  };
  return new AssistantQueryError(ko[e?.code ?? ""] ?? "조회하지 못했습니다", clipText(raw, 500));
}

// postgres.js 타입 oid → 화면에 옮길 값(셀은 문자·숫자·참거짓·null만).
const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;
const TIMESTAMP = 1114;
const pad = (n: number) => String(n).padStart(2, "0");
/**
 * 셀 값 → JSON으로 옮길 값. 시각은 **시간대를 붙인 ISO**(`2026-11-06T14:30:00+09:00`)로 — 시간대 없는 글자는 브라우저가 현지 시각으로
 * 읽어(사파리는 아예 못 읽어) 한국 밖에서 시각이 밀린다(적대 리뷰 2026-11-06). timestamp(시간대 없음)는 적힌 벽시계 시각을 한국 시각으로 본다 —
 * 조회 거래의 TimeZone을 Asia/Seoul로 두므로(`inTenant`) `created_at::timestamp`·`localtimestamp`도 한국 벽시계다.
 */
export function cell(value: unknown, type: number): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // postgres.js는 date('2026-11-06')를 UTC 0시로 준다 — 날짜 글자로.
    if (type === DATE) return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    // timestamp(시간대 없음)는 postgres.js가 `new Date("2026-11-06 14:30:00")` — 서버 현지 시각으로 읽는다 → 현지 값으로 적힌 벽시계를 되살린다.
    if (type === TIMESTAMP) {
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}+09:00`;
    }
    const k = new Date(value.getTime() + 9 * 3_600_000);
    return `${k.toISOString().slice(0, 19)}+09:00`;
  }
  if (typeof value === "string") {
    if ((type === INT8 || type === NUMERIC) && /^-?\d+(\.\d+)?$/.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n) && (type === NUMERIC || Number.isSafeInteger(n))) return n;
    }
    return value;
  }
  return JSON.stringify(value);
}

function planCost(plan: unknown): number {
  const first = Array.isArray(plan) ? (plan[0] as { "QUERY PLAN"?: unknown }) : null;
  const doc = first?.["QUERY PLAN"];
  const root = Array.isArray(doc) ? (doc[0] as { Plan?: { "Total Cost"?: number } }) : null;
  return typeof root?.Plan?.["Total Cost"] === "number" ? root.Plan["Total Cost"] : 0;
}

async function refreshViewsIfStale(tenantId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("assistant_refresh_views_if_stale");
    if (error) throw new Error(error.message);
  } catch (error) {
    // 갱신이 실패해도(잠금 대기 등) 있던 보기로 답한다 — 새 표·칸이 이번 질문에 안 보일 뿐이다.
    reportWarning("학원 비서 보기 갱신 실패", { scope: "assistant.refresh_views", tenantId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** 실행 계획(EXPLAIN VERBOSE)에 나타난 함수 — 앱 검사(sql-gate)와 따로, 플래너가 실제로 해석한 것을 다시 본다(적대 리뷰 1·3·5번). */
const PLAN_DENY =
  /\b(set_config|current_setting|pg_sleep\w*|pg_(?:try_)?advisory\w*|pg_cancel_backend|pg_terminate_backend|query_to_xml\w*|table_to_xml\w*|cursor_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|ts_stat|ts_rewrite|dblink\w*|lo_\w+|pg_read_\w+|pg_ls_\w+|pg_stat_\w+|pg_reload_conf|pg_notify|pg_logical_\w+|http_\w+|worker_restart|wake)\s*\(/i;
const PLAN_QUALIFIED = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/gi;
export function planProblem(plan: unknown): string | null {
  const text = JSON.stringify(plan);
  const deny = PLAN_DENY.exec(text);
  if (deny) return `실행 계획에 쓸 수 없는 함수가 있습니다(${deny[1]})`;
  for (const m of text.matchAll(PLAN_QUALIFIED)) {
    const schema = m[1]!.toLowerCase();
    if (schema === "pg_catalog") continue;
    if (schema === "assistant_private" && m[2]!.toLowerCase() === "bound_tenant") continue;
    return `실행 계획에 다른 스키마의 함수가 있습니다(${m[1]}.${m[2]})`;
  }
  return null;
}

/** 지점 증표 — service_role만 발급한다(DB가 서명 · 5분). 비서 역할은 만들 수 없다. */
async function issueBinding(tenantId: string): Promise<string> {
  const { data, error } = await createAdminClient().rpc("assistant_issue_binding", { p_tenant: tenantId });
  if (error || typeof data !== "string") throw new AssistantError("지점 확인 증표를 받지 못했습니다. 잠시 뒤 다시 물어봐 주세요");
  return data;
}

export async function openAssistantDb(tenantId: string): Promise<AssistantDb & { close(): Promise<void> }> {
  const url = process.env.ASSISTANT_DATABASE_URL;
  if (!url) throw new AssistantError("학원 비서 DB 연결이 아직 설정되지 않았습니다. 관리자에게 알려 주세요");
  await refreshViewsIfStale(tenantId);
  const sql: Sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, max_lifetime: 600, onnotice: () => undefined });
  let viewSet: ReadonlySet<string> | null = null;

  /**
   * 지점 증표를 단 읽기 전용 거래에서 `fn`을 돌리고 늘 되돌린다(rollback — 거래 안에서 바뀐 설정도 함께 사라진다).
   * 끝에 `pg_advisory_unlock_all()` — 세션 잠금은 rollback으로도 안 풀리고 풀러를 따라 다음 요청으로 넘어간다(적대 리뷰 3번).
   */
  async function inTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    const token = await issueBinding(tenantId);
    try {
      await sql.begin("read only", async (tx) => {
        // 시간대 = 한국 — `::date`·`date_trunc`·`::timestamp`가 한국 날짜·벽시계로 묶이고, 시간대 없는 결과(timestamp)에 붙이는 +09:00이 맞는다(재리뷰 2026-11-06).
        await tx`select set_config('assistant.binding', ${token}, true), set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true), set_config('search_path', 'assistant', true), set_config('TimeZone', 'Asia/Seoul', true)`;
        const [check] = await tx<{ ok: boolean | null }[]>`select (select assistant_private.bound_tenant()) = ${tenantId}::uuid as ok`;
        // 증표가 안 맞으면 모든 보기가 0행이다 — '0명'으로 답하지 않게 여기서 멈춘다(적대 리뷰 7번).
        if (!check?.ok) throw new AssistantError("지점 확인에 실패했습니다. 잠시 뒤 다시 물어봐 주세요");
        let outcome: { value: T } | { error: unknown };
        try {
          outcome = { value: (await tx.savepoint((sp) => fn(sp))) as T };
        } catch (error) {
          outcome = { error };
        }
        await tx`select pg_advisory_unlock_all()`;
        throw new Rollback(outcome);
      });
    } catch (error) {
      if (error instanceof Rollback) {
        const outcome = error.value as { value: T } | { error: unknown };
        if ("error" in outcome) throw outcome.error;
        return outcome.value;
      }
      throw error;
    }
    throw new Error("unreachable");
  }

  return {
    async views() {
      if (viewSet) return viewSet;
      const rows = await sql<{ name: string }[]>`
        select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'assistant' and c.relkind = 'v' order by 1`;
      viewSet = new Set(rows.map((r) => r.name));
      return viewSet;
    },
    async describe(tables) {
      if (!tables.length) return [];
      const rows = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
        select table_name, column_name, data_type from information_schema.columns
         where table_schema = 'assistant' and table_name = any(${tables}::text[])
         order by table_name, ordinal_position`;
      return tables.map((table) => ({
        table,
        columns: rows.filter((r) => r.table_name === table).map((r) => ({ name: r.column_name, type: r.data_type })),
      }));
    },
    async run(gated) {
      const started = Date.now();
      try {
        return await inTenant(async (tx) => {
          const wrapped = wrapAssistantSql(gated, ASSISTANT_ROW_LIMIT + 1);
          // 🔴 확장 질의 방식(simple: false) — 인자 없는 unsafe()는 단순 질의라 여러 문장이 한 번에 실행될 수 있다(적대 리뷰 2번).
          const plan = await tx.unsafe(`explain (verbose, format json) ${wrapped}`, [], EXTENDED);
          const problem = planProblem(plan);
          if (problem) throw new AssistantQueryError("쓸 수 없는 조회입니다", problem);
          const cost = planCost(plan);
          if (cost > ASSISTANT_COST_LIMIT) {
            throw new AssistantQueryError("조회가 너무 무겁습니다 — 기간·조건을 좁히거나 집계해 주세요", `EXPLAIN total cost ${Math.round(cost)} > ${ASSISTANT_COST_LIMIT}`);
          }
          const result = await tx.unsafe(wrapped, [], EXTENDED);
          const columns = result.columns.map((c) => c.name);
          // 칸 이름이 겹치면(`select s.name, c.name`) 행 객체에 값이 하나만 남아 다른 칸 값이 보인다 — 별칭을 붙이게 돌려보낸다.
          const dup = columns.find((c, i) => columns.indexOf(c) !== i);
          if (dup !== undefined) {
            throw new AssistantQueryError("결과 칸 이름이 겹칩니다 — 칸마다 다른 별칭을 붙여 주세요", `duplicate output column name "${dup}" — give each output column a distinct alias (e.g. s.name as 학생, c.name as 반)`);
          }
          const types = new Map(result.columns.map((c) => [c.name, c.type]));
          const all = [...result] as Array<Record<string, unknown>>;
          const rows: Row[] = all.slice(0, ASSISTANT_ROW_LIMIT).map((r) => Object.fromEntries(columns.map((c) => [c, cell(r[c], types.get(c) ?? 0)])));
          return { columns, rows, rowCount: Math.min(all.length, ASSISTANT_ROW_LIMIT), truncated: all.length > ASSISTANT_ROW_LIMIT, ms: Date.now() - started };
        });
      } catch (error) {
        if (error instanceof AssistantQueryError || error instanceof AssistantError) throw error;
        throw queryError(error);
      }
    },
    async close() {
      await sql.end({ timeout: 2 });
    },
  };
}
