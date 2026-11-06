/**
 * 학원 비서 — AI가 쓴 SQL의 앱 쪽 검사(두 번째 겹). 첫 번째 겹은 DB다(전용 역할 `aywa_assistant` · `assistant.*` 보기만 ·
 * 읽기 전용 거래 · 지점 묶기 — docs/features/academy-assistant.md §2). 여기서 막지 못해도 DB가 막아야 하고, DB가 막는 것도 여기서 먼저 막는다.
 *
 * 방식 = 실제 Postgres 17 파서(`libpg-query`)로 읽고 **허용한 노드만 통과**(모르는 노드는 막는다 — 닫히는 쪽).
 * - 문장 하나 · SELECT만(데이터를 바꾸는 CTE · SELECT INTO · FOR UPDATE · 재귀 CTE · TABLESAMPLE 거절).
 * - 표 = `assistant` 보기 이름 또는 그 쿼리의 CTE 이름. 🔴 `pg_`로 시작하는 이름은 무조건 거절 — 스키마를 안 붙여도
 *   Postgres는 `pg_catalog`를 search_path보다 먼저 찾는다(`pg_stat_activity`가 다른 세션의 쿼리 글을 보여 준다).
 * - 함수 = 허용 목록만(스키마는 없거나 `pg_catalog`). `set_config`·`current_setting`·`pg_sleep`·`dblink`·`net.http_*` 등은 목록에 없다.
 *   메모리를 한 번에 크게 잡는 `repeat`·`lpad`·`rpad`·`format`도 뺐다(작은 운영 DB 한 대를 같이 쓴다).
 * - `generate_series`는 상수 날짜 범위 + 하루 이상 간격만(함수 스캔은 결과를 통째로 쌓는다 — 숫자·열 값 범위는 수억 행이 될 수 있다).
 * - 형변환은 허용한 타입만(`::regclass` 같은 카탈로그 타입 거절).
 */
import { loadModule, parseSync } from "libpg-query";

export type SqlGateResult = { ok: true; sql: string; tables: string[] } | { ok: false; reason: string };

/** 비서 SQL 한 편의 최대 길이 — 이보다 길면 질문을 나누라고 돌려보낸다. */
export const ASSISTANT_SQL_MAX_CHARS = 8000;
const MAX_NODES = 20000;

const ALLOWED_NODES = new Set([
  "SelectStmt", "ResTarget", "FuncCall", "String", "Integer", "Float", "Boolean", "A_Const", "ColumnRef", "A_Star",
  "A_Expr", "SQLValueFunction", "TypeCast", "TypeName", "CoalesceExpr", "MinMaxExpr", "CaseExpr", "CaseWhen", "NullTest",
  "BooleanTest", "BoolExpr", "List", "SubLink", "A_ArrayExpr", "A_Indirection", "A_Indices", "RowExpr", "SortBy",
  "RangeVar", "RangeSubselect", "RangeFunction", "JoinExpr", "CommonTableExpr", "WindowDef", "GroupingSet", "GroupingFunc",
  "NamedArgExpr", "CollateClause",
]);

/** 펼쳐진(감싸지 않은) 필드로 오는 것 중 막을 것. */
const FORBIDDEN_FIELDS: Record<string, string> = {
  intoClause: "SELECT INTO는 쓸 수 없습니다(조회만 됩니다)",
  lockingClause: "FOR UPDATE/SHARE는 쓸 수 없습니다(조회만 됩니다)",
};

const SET_RETURNING = new Set([
  "generate_series", "unnest", "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_each", "jsonb_each_text",
  "json_array_elements", "json_array_elements_text", "json_each", "json_each_text", "jsonb_object_keys", "json_object_keys",
  "regexp_split_to_table", "string_to_table", "regexp_matches",
]);

export const ASSISTANT_SQL_FUNCTIONS: ReadonlySet<string> = new Set([
  // 집계
  "count", "sum", "avg", "min", "max", "string_agg", "array_agg", "json_agg", "jsonb_agg", "json_object_agg", "jsonb_object_agg",
  "bool_and", "bool_or", "every", "stddev", "stddev_samp", "stddev_pop", "variance", "var_samp", "var_pop", "corr",
  "percentile_cont", "percentile_disc", "mode",
  // 창
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile", "lag", "lead", "first_value", "last_value", "nth_value",
  // 수
  "abs", "round", "ceil", "ceiling", "floor", "trunc", "mod", "power", "sqrt", "sign", "div", "exp", "ln", "log", "width_bucket",
  "num_nonnulls", "num_nulls",
  // 글자
  "lower", "upper", "initcap", "length", "char_length", "character_length", "octet_length", "substr", "substring", "left", "right",
  "btrim", "ltrim", "rtrim", "replace", "translate", "concat", "concat_ws", "split_part", "position", "strpos", "reverse",
  "starts_with", "regexp_replace", "regexp_match", "regexp_like", "regexp_count", "regexp_substr", "similar_to_escape",
  "array_to_string", "string_to_array", "array_length", "cardinality", "array_position", "array_remove",
  "to_char", "to_date", "to_timestamp", "to_number",
  // 날짜
  "now", "date_trunc", "date_part", "extract", "age", "make_date", "make_time", "make_timestamp", "make_timestamptz",
  "make_interval", "justify_days", "justify_hours", "justify_interval", "isfinite", "timezone", "date_bin", "overlaps",
  "statement_timestamp", "transaction_timestamp", "clock_timestamp",
  // json
  "to_json", "to_jsonb", "row_to_json", "json_build_object", "jsonb_build_object", "json_build_array", "jsonb_build_array",
  "jsonb_extract_path", "jsonb_extract_path_text", "json_extract_path", "json_extract_path_text", "jsonb_array_length",
  "json_array_length", "jsonb_typeof", "json_typeof", "jsonb_strip_nulls", "jsonb_path_exists", "jsonb_path_query_first",
  ...SET_RETURNING,
]);

const ALLOWED_TYPES = new Set([
  "int2", "int4", "int8", "smallint", "integer", "int", "bigint", "numeric", "decimal", "float4", "float8", "real",
  "text", "varchar", "bpchar", "char", "date", "timestamp", "timestamptz", "interval", "time", "timetz", "bool", "boolean",
  "json", "jsonb", "uuid",
]);

const ALLOWED_SVF = new Set([
  "SVFOP_CURRENT_DATE", "SVFOP_CURRENT_TIME", "SVFOP_CURRENT_TIME_N", "SVFOP_CURRENT_TIMESTAMP", "SVFOP_CURRENT_TIMESTAMP_N",
  "SVFOP_LOCALTIME", "SVFOP_LOCALTIME_N", "SVFOP_LOCALTIMESTAMP", "SVFOP_LOCALTIMESTAMP_N",
]);

const DAY_OR_LONGER_STEP = /^\s*([1-9]\d*)\s*(days?|weeks?|mons?|months?|years?)\s*$/i;

class Reject extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function strings(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((n) => (isObj(n) && isObj(n.String) && typeof n.String.sval === "string" ? n.String.sval : "\u0000"));
}

let loading: Promise<void> | null = null;
function ready(): Promise<void> {
  loading ??= loadModule().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** 줄 끝 세미콜론·공백을 떼어 낸다(검사·감싸기 전에). */
export function normalizeAssistantSql(input: string): string {
  return input.replace(/[\s;]+$/u, "").trim();
}

/**
 * 실행 모양 — 검사를 통과한 SQL을 행 수 상한과 함께 감싼다. 줄바꿈으로 감싸 끝의 `--` 주석이 닫는 괄호를 먹지 않게 한다.
 * 감싼 결과도 `checkWrapped`로 다시 파싱해 한 문장 · 서브쿼리 하나인지 본다.
 */
export function wrapAssistantSql(sql: string, limit: number): string {
  return `select * from (\n${sql}\n) as assistant_q limit ${Math.max(1, Math.floor(limit))}`;
}

function checkTypeName(t: unknown): void {
  if (!isObj(t)) throw new Reject("형변환 모양을 읽지 못했습니다");
  const names = strings(t.names);
  const name = names.at(-1) ?? "";
  if (names.length > 2 || (names.length === 2 && names[0] !== "pg_catalog") || !ALLOWED_TYPES.has(name)) {
    throw new Reject(`형변환 ${names.join(".")}은(는) 쓸 수 없습니다 — 숫자·글자·날짜·json·uuid 타입만 됩니다`);
  }
}

function hasNode(node: unknown, keys: ReadonlySet<string>): boolean {
  if (Array.isArray(node)) return node.some((n) => hasNode(n, keys));
  if (!isObj(node)) return false;
  return Object.entries(node).some(([k, v]) => keys.has(k) || hasNode(v, keys));
}

const VARYING = new Set(["ColumnRef", "SubLink", "ParamRef", "FuncCall"]);

function checkGenerateSeries(args: unknown): void {
  const list = Array.isArray(args) ? args : [];
  const fail = () => {
    throw new Reject(
      "generate_series는 고정된 날짜 범위와 하루 이상 간격만 됩니다(예: generate_series('2026-01-01'::date, current_date, interval '1 month'))",
    );
  };
  if (list.length !== 3) fail();
  if (hasNode(list[0], VARYING) || hasNode(list[1], VARYING)) fail();
  const step = list[2];
  const cast = isObj(step) && isObj(step.TypeCast) ? step.TypeCast : null;
  const typeName = cast && isObj(cast.typeName) ? strings(cast.typeName.names).at(-1) : null;
  const literal = cast && isObj(cast.arg) && isObj(cast.arg.A_Const) && isObj(cast.arg.A_Const.sval) ? cast.arg.A_Const.sval.sval : null;
  if (typeName !== "interval" || typeof literal !== "string" || !DAY_OR_LONGER_STEP.test(literal)) fail();
}

function checkFunction(fn: Obj): void {
  const names = strings(fn.funcname);
  const name = names.at(-1) ?? "";
  if (names.length > 2 || (names.length === 2 && names[0] !== "pg_catalog")) {
    throw new Reject(`함수 ${names.join(".")}은(는) 쓸 수 없습니다`);
  }
  if (!ASSISTANT_SQL_FUNCTIONS.has(name)) throw new Reject(`함수 ${name}은(는) 쓸 수 없습니다 — 집계·날짜·글자·수·json 함수만 됩니다`);
  if (name === "generate_series") checkGenerateSeries(fn.args);
}

function collectCteNames(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((n) => collectCteNames(n, into));
  if (!isObj(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === "CommonTableExpr" && isObj(v) && typeof v.ctename === "string") into.add(v.ctename);
    collectCteNames(v, into);
  }
}

type WalkCtx = { views: ReadonlySet<string>; ctes: ReadonlySet<string>; tables: Set<string>; nodes: number };

function walk(node: unknown, ctx: WalkCtx): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, ctx);
    return;
  }
  if (!isObj(node)) return;
  if (++ctx.nodes > MAX_NODES) throw new Reject("SQL이 너무 복잡합니다 — 나눠서 조회해 주세요");
  for (const [key, value] of Object.entries(node)) {
    if (key in FORBIDDEN_FIELDS && value) throw new Reject(FORBIDDEN_FIELDS[key]!);
    if (key === "withClause" && isObj(value) && value.recursive) throw new Reject("재귀 CTE(WITH RECURSIVE)는 쓸 수 없습니다");
    if (key === "typeName") checkTypeName(value);
    if (/^[A-Z]/.test(key)) {
      if (!ALLOWED_NODES.has(key)) throw new Reject(`쓸 수 없는 구문입니다(${key}) — SELECT 조회만 됩니다`);
      if (!isObj(value)) continue;
      if (key === "TypeName") {
        checkTypeName(value);
      } else if (key === "RangeVar") {
        const rel = typeof value.relname === "string" ? value.relname : "";
        if (value.catalogname || (value.schemaname && value.schemaname !== "assistant")) {
          throw new Reject(`${String(value.schemaname)}.${rel} — assistant 보기만 조회할 수 있습니다`);
        }
        if (rel.startsWith("pg_")) throw new Reject(`${rel} — 시스템 표는 조회할 수 없습니다`);
        if (!ctx.views.has(rel) && !ctx.ctes.has(rel)) throw new Reject(`없는 표입니다: ${rel} — describe_table로 표 이름을 확인해 주세요`);
        if (ctx.views.has(rel)) ctx.tables.add(rel);
      } else if (key === "FuncCall") {
        checkFunction(value);
      } else if (key === "SQLValueFunction") {
        if (!ALLOWED_SVF.has(String(value.op))) throw new Reject("current_date·current_timestamp 말고는 쓸 수 없습니다");
      } else if (key === "A_Expr") {
        const op = strings(value.name);
        if (op.length > 2 || (op.length === 2 && op[0] !== "pg_catalog")) throw new Reject("스키마를 붙인 연산자는 쓸 수 없습니다");
      } else if (key === "CommonTableExpr") {
        if (!isObj(value.ctequery) || !("SelectStmt" in value.ctequery)) throw new Reject("WITH 안에는 SELECT만 쓸 수 있습니다");
        if (typeof value.ctename === "string" && value.ctename.startsWith("pg_")) throw new Reject("pg_로 시작하는 이름은 쓸 수 없습니다");
      } else if (key === "RangeFunction") {
        const fns = hasOnlySetReturning(value.functions);
        if (!fns) throw new Reject("FROM 자리 함수는 unnest·jsonb_array_elements 같은 펼치기 함수와 날짜 generate_series만 됩니다");
      }
    }
    walk(value, ctx);
  }
}

function hasOnlySetReturning(functions: unknown): boolean {
  const calls: Obj[] = [];
  (function find(n: unknown) {
    if (Array.isArray(n)) return n.forEach(find);
    if (!isObj(n)) return;
    if (isObj(n.FuncCall)) {
      calls.push(n.FuncCall);
      return;
    }
    Object.values(n).forEach(find);
  })(functions);
  return calls.length > 0 && calls.every((c) => SET_RETURNING.has(strings(c.funcname).at(-1) ?? ""));
}

function parse(sql: string): { stmts?: Array<{ stmt?: Obj }> } {
  return parseSync(sql) as { stmts?: Array<{ stmt?: Obj }> };
}

/**
 * AI가 쓴 SQL을 검사한다. 통과하면 정리한 SQL(끝 세미콜론 제거)과 읽는 보기 이름을, 아니면 AI에게 돌려줄 한국어 이유를 준다.
 * `views` = 이 지점 비서가 읽을 수 있는 `assistant` 보기 이름(카탈로그).
 */
export async function checkAssistantSql(input: string, views: ReadonlySet<string>): Promise<SqlGateResult> {
  const sql = normalizeAssistantSql(input);
  if (!sql) return { ok: false, reason: "SQL이 비어 있습니다" };
  if (sql.length > ASSISTANT_SQL_MAX_CHARS) return { ok: false, reason: `SQL이 너무 깁니다(${ASSISTANT_SQL_MAX_CHARS}자까지) — 나눠서 조회해 주세요` };
  await ready();
  let tree: ReturnType<typeof parse>;
  try {
    tree = parse(sql);
  } catch (error) {
    return { ok: false, reason: `SQL 문법 오류: ${error instanceof Error ? error.message : String(error)}` };
  }
  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1) return { ok: false, reason: "SELECT 문 하나만 보낼 수 있습니다" };
  const stmt = stmts[0]?.stmt;
  if (!isObj(stmt) || Object.keys(stmt).length !== 1 || !isObj(stmt.SelectStmt)) {
    return { ok: false, reason: "SELECT 조회만 됩니다(쓰기·설정 변경·EXPLAIN 등은 쓸 수 없습니다)" };
  }
  const ctes = new Set<string>();
  collectCteNames(stmt, ctes);
  const ctx: WalkCtx = { views, ctes, tables: new Set(), nodes: 0 };
  try {
    walk(stmt, ctx);
    checkWrapped(wrapAssistantSql(sql, 1));
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: error.message };
    throw error;
  }
  return { ok: true, sql, tables: [...ctx.tables].sort() };
}

/** 감싼 실행 SQL이 '서브쿼리 하나를 읽는 SELECT 한 문장'인지 — 감싸기로 문장이 쪼개지거나 바뀌지 않았는지 다시 본다. */
function checkWrapped(wrapped: string): void {
  let tree: ReturnType<typeof parse>;
  try {
    tree = parse(wrapped);
  } catch {
    throw new Reject("SQL을 감싸 실행할 수 없습니다 — 끝에 남은 주석이나 괄호를 확인해 주세요");
  }
  const stmts = tree.stmts ?? [];
  const select = stmts.length === 1 && isObj(stmts[0]?.stmt) ? stmts[0]!.stmt!.SelectStmt : null;
  const from = isObj(select) && Array.isArray(select.fromClause) ? select.fromClause : [];
  if (from.length !== 1 || !isObj(from[0]) || !isObj(from[0].RangeSubselect)) {
    throw new Reject("SQL을 감싸 실행할 수 없습니다 — SELECT 하나만 보내 주세요");
  }
}
