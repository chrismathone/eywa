/**
 * 전수 조회 — 원장 2026-11-06 *"실제로 관련있는 모든 데이터를 조회하고 있는것 맞나? DB 전체 조회하고 답변하는거 맞아?" · "하나도 빠짐없이 남김없이"*.
 *
 * 비서가 '볼 만한 표'를 스스로 고르면 빠지는 표가 생긴다(11-06 고등M 중2 PS3A 반 분석 — 영상 숙제·성적을 아예 안 봤다).
 * 그래서 대상(원생·반·강사)이 정해지면 **서버가** 그 대상과 이어진 칸이 있는 보기를 **전부** 찾아(표 목록을 손으로 적지 않는다 —
 * 칸 이름 규칙으로 · 새 표·새 칸이 생기면 저절로 들어간다) 전체 건수 · 기간 건수 · 최근 날짜를 센다.
 * - 조회는 비서 조회와 **같은 길**(SQL 검사기 `checkAssistantSql` → 실행기 `db.run` — 지점 증표 · 읽기 전용 · 8초 · 비용 상한)로 돈다.
 * - 표 여러 개를 UNION ALL 한 문장으로 묶어 세고, 한 묶음이 막히면 반씩 쪼개 다시(끝내 한 표가 막히면 그 표만 '세지 못함').
 * - 결과는 AI에게 지도로 주고(자료 있는 표는 모두 보거나 왜 안 봤는지 밝히게) · 보고서 끝 '확인한 자료 범위'로 원장이 직접 검증한다.
 */
import type { AssistantTableDoc } from "../catalog/types";
import type { ReportCoverage } from "../report";
import type { AssistantDb } from "./agent";

export type SurveyTarget = "student" | "class" | "teacher";
export const SURVEY_TARGET_LABEL: Record<SurveyTarget, string> = { student: "원생", class: "반", teacher: "강사" };

type Column = { name: string; type: string };
/**
 * 셀 표 하나 — `key`는 한 묶음 안에서 결과를 가르는 이름(같은 표를 '직접'과 '맡은 반'으로 두 번 셀 수 있다).
 * `via: "class"` = 강사가 맡은(맡았던) 반을 거쳐 이어진 줄(반 칸이 그 반들 중 하나) — 강사가 직접 쓰지 않은 반 자료(영상 숙제 검사 · 반 출결 등).
 * 날짜: `start`만 있으면 그날로, `end`도 있으면 기간이 겹치는 줄(수강 · 임시 위임 · 시간표처럼 '그때 유효했던' 줄)로 센다.
 */
export type SurveyTable = { key: string; table: string; label: string; links: string[]; via?: "class"; date: { start: string; end: string | null } | null };
export type SurveyRow = {
  key: string;
  table: string;
  label: string;
  links: string[];
  via?: "class";
  total: number | null;
  inPeriod: number | null;
  latest: string | null;
  failed?: string;
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 그 대상 자신의 줄이 있는 표(id 칸으로 잇는다). */
const SELF_TABLES: Record<SurveyTarget, readonly string[]> = {
  student: ["students", "onto_students"],
  class: ["classes"],
  teacher: ["users"],
};

/** 강사와 잇는 `…_by` 칸 중 '고친·풀린 흔적'만 남기는 것(가르친·쓴·맡은 기록이 아니다) — 세지 않는다. */
const BY_BOOKKEEPING = new Set([
  "updated_by", "last_applied_by", "last_action_by", "undone_by", "revoked_by", "consumed_by", "granted_by", "linked_by", "pinned_by",
  // 처리·이동 흔적(재리뷰 2026-11-09 — '꼭 볼 표' 목록만 키운다)
  "moved_by", "ended_by", "cancelled_by", "acked_by", "triggered_by", "started_by", "issued_by", "confirmed_by", "carryover_by", "allocation_carry_by",
]);

/**
 * 대상과 잇는 칸 — 이름 규칙. uuid 칸만(배열·글자 칸은 아래 teacher_name 하나만 예외).
 * - 원생: student_id · …_student_id(mapped_student_id 등) · student_a/student_b(형제)
 * - 반: class_id · …_class_id(from_class_id · to_class_id 등)
 * - 강사: teacher_id · …_teacher_id · user_id · …_user_id(delegate_user_id 등) · `…_by` 전부(taught_by 대신 보강 · created_by · recorded_by ·
 *   handled_by · checked_by · covers_by · decided_by · approved_by …, 고친 흔적 `BY_BOOKKEEPING`만 뺀다) · author_id · counselor_id ·
 *   assignee_id · reviewer_id · owner_id · approver_id — 가르친 기록과 쓴·맡은 기록을 함께 센다(표마다 어느 칸으로 이었는지 함께 돌려준다).
 *   (적대 리뷰 2026-11-09 — taught_by·handled_by 등이 빠져 출결 귀속·후속조치가 강사 전수 조회에 없었다)
 */
export function linkColumns(target: SurveyTarget, columns: readonly Column[]): string[] {
  const uuidCols = columns.filter((c) => c.type === "uuid" && IDENT.test(c.name)).map((c) => c.name);
  if (target === "student") return uuidCols.filter((n) => /(^|_)student_id$/.test(n) || n === "student_a" || n === "student_b");
  if (target === "class") return uuidCols.filter((n) => /(^|_)class_id$/.test(n));
  return uuidCols.filter(
    (n) =>
      /(^|_)(teacher|user)_id$/.test(n) ||
      (/_by$/.test(n) && !BY_BOOKKEEPING.has(n)) ||
      ["author_id", "counselor_id", "assignee_id", "reviewer_id", "owner_id", "approver_id"].includes(n),
  );
}

/**
 * 기간을 셀 날짜 칸 — '일이 일어난 날'(아래 목록) → 기간 칸(`RANGE_PAIRS`) → 입력 시각(created_at · updated_at) 차례. 없으면 기간은 세지 않고 전체만.
 * 🔴 입력·저장 시각은 맨 뒤 — 1학기 성적을 9월에 몰아 넣으면 created_at으로는 '최근 3개월'에 들어간다(적대 리뷰 2026-11-09 · 성적은 taken_on).
 * 🔴 결재·제출·완료 같은 **처리 시각은 쓰지 않는다** — 대기 중인 줄은 비어 있어 기간에서 빠지고 표 전체가 '기간 밖'으로 갔다(재리뷰 2026-11-09).
 * 🔴 학부모 글의 결석 기간(starts_on/ends_on — 출결 글이 아니면 비어 있다)보다 올린 날(posted_at)이 먼저다(재리뷰 2026-11-09).
 * 날짜 하나는 비어 있으면 입력 시각으로 메운다(`coalesce(그 칸, created_at)` — 보낼 예정·처리 전 줄도 센다).
 */
const DATE_PREFERENCE = [
  "session_date", "absence_date", "makeup_date", "original_date", "report_date", "homework_date", "check_date", "checkin_date", "mark_date",
  "exam_date", "test_date", "tested_on", "taken_on", "taken_at", "consultation_date", "consulted_on", "consulted_at", "follow_up_date",
  "occurred_on", "occurred_at", "event_date", "plan_date", "memo_date", "flag_date", "for_date", "on_date", "work_date", "entry_date",
  "payment_date", "paid_on", "paid_at", "expense_date", "spend_date", "income_date", "request_date", "received_date",
  "effective_date", "enrolled_on", "enrolled_at", "withdrawn_on", "withdrawn_at", "exit_date", "sent_at", "posted_on", "posted_at",
];
/** 기간 칸도 '일이 일어난 날'도 없을 때 — 입력 시각. */
const ENTRY_DATES = ["created_at", "updated_at"];
/** 기간이 있는 줄(시작·끝) — 끝이 비면 아직 유효. 날짜 하나보다 먼저 본다(수강·위임·시간표는 '그 기간에 유효했나'가 뜻이다). */
const RANGE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["start_date", "end_date"],
  ["valid_from", "valid_to"],
  ["from_date", "to_date"],
  ["starts_on", "ends_on"],
  ["starts_at", "ends_at"],
  ["period_start", "period_end"],
  ["period_from", "period_to"],
];
const DATE_TYPES = new Set(["date", "timestamp with time zone", "timestamp without time zone"]);
const isDate = (columns: readonly Column[], name: string) => columns.some((c) => c.name === name && DATE_TYPES.has(c.type));

/**
 * 기간을 셀 날짜 **식**(따옴표 친 SQL) — 없으면 null. `end`가 있으면 기간이 겹치는 줄로 센다.
 * 🔴 수업보고서처럼 '실제 수업일' covers_date가 있으면 `coalesce(covers_date, report_date)`(앱 작성률 기준 — covers_date는 대개 비어 있다:
 *    11-06 실측 PS3A 반 보고서 402건이 covers_date만 보면 기간 0건으로 나왔다).
 */
export function dateColumn(columns: readonly Column[]): { start: string; end: string | null } | null {
  if (isDate(columns, "covers_date") && isDate(columns, "report_date")) return { start: `coalesce("covers_date", "report_date")`, end: null };
  const entry = ENTRY_DATES.find((c) => isDate(columns, c)) ?? null;
  for (const want of DATE_PREFERENCE) {
    if (isDate(columns, want)) return { start: entry ? `coalesce("${want}", "${entry}")` : `"${want}"`, end: null };
  }
  for (const [a, b] of RANGE_PAIRS) if (isDate(columns, a) && isDate(columns, b)) return { start: `"${a}"`, end: `"${b}"` };
  return entry ? { start: `"${entry}"`, end: null } : null;
}

/**
 * 보기 칸 목록 → 셀 표 목록(대상 자신의 표 포함 · 잇는 칸이 없는 표는 뺀다).
 * - 🔴 문서에 `internal`로 적힌 표(알림 구독 · 연동 코드 · 숨김 기록 등 — 학원 자료가 아니다)는 세지 않고 `internal`로 돌려준다
 *   (적대 리뷰 2026-11-09 — '하나도 빠짐없이 run_sql' 목록에 들어가 조회를 낭비하고 확인한 자료 범위에 '건수만 셈'으로 쌓였다).
 * - 강사는 직접 이은 표 + **맡은 반을 거친 표**(`withTaughtClasses` — 반 칸이 `taughtClassesSql`의 반 중 하나 · `via: "class"`).
 */
export function surveyPlan(
  target: SurveyTarget,
  described: ReadonlyArray<{ table: string; columns: readonly Column[] }>,
  docs: readonly AssistantTableDoc[],
  opts: { teacherName?: string | null; withTaughtClasses?: boolean } = {},
): { tables: SurveyTable[]; internal: string[] } {
  const doc = (t: string) => docs.find((d) => d.name === t);
  const tables: SurveyTable[] = [];
  const internal: string[] = [];
  const viaClasses = target === "teacher" && !!opts.withTaughtClasses;
  for (const { table, columns } of described) {
    if (!IDENT.test(table)) continue;
    const links = SELF_TABLES[target].includes(table) && columns.some((c) => c.name === "id") ? ["id"] : linkColumns(target, columns);
    // 수업보고서 등은 강사를 이름 글자로 적는다(teacher_name = users.display_name).
    if (target === "teacher" && opts.teacherName && columns.some((c) => c.name === "teacher_name" && c.type === "text")) links.push("teacher_name");
    const classLinks = viaClasses ? linkColumns("class", columns) : [];
    if (!links.length && !classLinks.length) continue;
    if (doc(table)?.internal) {
      internal.push(table);
      continue;
    }
    const label = doc(table)?.label ?? table;
    const date = dateColumn(columns);
    if (links.length) tables.push({ key: table, table, label, links, date });
    if (classLinks.length) tables.push({ key: `${table}@반`, table, label: `${label}(맡은 반)`, links: classLinks, via: "class", date });
  }
  return { tables: tables.sort((a, b) => a.key.localeCompare(b.key)), internal: internal.sort() };
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * 강사가 이 기간에 맡은(맡았던) 반 — 담임·교시 담당·임시 위임(onto_class_teachers) 중 **맡은 기간이 조회 기간과 겹치는 것**만.
 * 폐지 반(is_active 아님)·보강용 반(전 지점 보강이 모인다)·기간 전에 끝난 반은 뺀다(재리뷰 2026-11-09 — 2년 전에 떠난 반 · 하루 위임 ·
 * 보강용 반 교시 한 번으로 그 반 자료 전체가 이 강사 몫으로 들어왔다). 담임 줄은 기간 칸이 비어 있다(= 지금 담임).
 * 반 id를 글자로 늘어놓지 않는다 — 검사기 8,000자 상한에 걸렸다(반 칸 둘인 표는 반 84개에서 거절). id·날짜는 부르는 쪽이 검사했다.
 */
export function taughtClassesSql(id: string, from: string, to: string): string {
  if (!UUID.test(id) || !isRealYmd(from) || !isRealYmd(to)) throw new Error("맡은 반 조회 값이 맞지 않습니다");
  return [
    "select distinct t.class_id from onto_class_teachers t join classes c on c.id = t.class_id",
    `where t.teacher_id = ${lit(id)}::uuid and t.class_id is not null`,
    `and (t.valid_from is null or t.valid_from <= date ${lit(to)}) and (t.valid_to is null or t.valid_to >= date ${lit(from)})`,
    `and c.is_active and not coalesce(c.is_makeup_pool, false) and (c.closed_at is null or c.closed_at >= date ${lit(from)})`,
  ].join(" ");
}

/** 참인 날짜인가('2026-02-29' 같은 없는 날은 아니다 — 22008로 묶음 전체가 막힌다 · 적대 리뷰 2026-11-09). */
export function isRealYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export type SurveyArgs = { id: string; from: string; to: string; teacherName?: string | null };

/** 한 묶음을 세는 SELECT 한 문장(UNION ALL). 날짜는 'YYYY-MM-DD' · 끝 날짜 포함. */
export function surveySql(tables: readonly SurveyTable[], args: SurveyArgs): string {
  const { id, from, to, teacherName } = args;
  if (!UUID.test(id)) throw new Error("대상 id가 uuid가 아닙니다");
  if (!isRealYmd(from) || !isRealYmd(to)) throw new Error("기간은 있는 날짜(YYYY-MM-DD)여야 합니다");
  if (from > to) throw new Error("기간 시작이 끝보다 늦습니다");
  const parts = tables.map((t) => {
    const where =
      t.via === "class"
        ? t.links.map((c) => `"${c}" in (select class_id from taught_classes)`).join(" or ")
        : t.links.map((c) => (c === "teacher_name" ? `"teacher_name" = ${lit(teacherName ?? "")}` : `"${c}" = ${lit(id)}::uuid`)).join(" or ");
    const d = t.date; // dateColumn이 만든 식(따옴표 친 칸 이름 또는 coalesce)
    const period = !d
      ? "null::int"
      : d.end
        ? `count(*) filter (where (${d.start} is null or ${d.start} < date ${lit(to)} + 1) and (${d.end} is null or ${d.end} >= date ${lit(from)}))::int`
        : `count(*) filter (where ${d.start} >= date ${lit(from)} and ${d.start} < date ${lit(to)} + 1)::int`;
    const latest = d ? `max(${d.start})::date::text` : "null::text";
    return `select ${lit(t.key)}::text as 표, count(*)::int as 전체, ${period} as 기간, ${latest} as 최근 from "${t.table}" where ${where}`;
  });
  const body = parts.join("\nunion all\n");
  return tables.some((t) => t.via === "class") ? `with taught_classes as (${taughtClassesSql(id, from, to)})\n${body}` : body;
}

const CHUNK = 12;
/**
 * 묶음 수 × 이만큼까지만 실행기를 부른다 — 반씩 쪼개기가 불어나지 않게(적대 리뷰 2026-11-09 · 강사 104표가 199번 불렀다).
 * 9 = 12개 묶음에서 막힌 표 하나를 찾아내는 데 드는 횟수(1 + 2×4). 대부분 묶음은 한 번에 끝나 남는 몫이 막힌 묶음으로 간다.
 * 시간 상한은 부르는 쪽 shouldStop(agent — 전수 조회 한 번 2분 · 마무리 시각).
 */
const RUNS_PER_CHUNK = 9;

/**
 * 묶음마다 검사기 → 실행기. 막힌 묶음은 반씩 쪼개 다시 — 한 표만 남아도 막히면 그 표는 `failed`(까닭)로 남긴다.
 * `check`는 sql-gate의 checkAssistantSql(시험은 가짜를 넣는다).
 * 🔴 쪼개기는 **그 표 탓일 수 있는 오류**(`isQueryError` — 칸·표·형식·비용 등 Postgres 조회 오류, 검사기 거절)에만 한다. 연결·증표·시간 같은
 *    오류는 쪼개도 같으니 바로 던진다(전수 조회 전체 실패 → AI가 run_sql로 잇는다). 묶음 사이마다 `shouldStop`(멈춤 · 마무리)을 보고, 실행 횟수에
 *    상한을 둔다 — 남은 표는 그 까닭으로 '세지 못함'(빠진 것을 숨기지 않는다).
 */
export async function runSurvey(
  db: Pick<AssistantDb, "run">,
  check: (sql: string) => Promise<{ ok: true; sql: string } | { ok: false; reason: string }>,
  plan: readonly SurveyTable[],
  args: SurveyArgs & { isQueryError?: (error: unknown) => boolean; shouldStop?: () => string | null },
): Promise<SurveyRow[]> {
  const rows: SurveyRow[] = [];
  const isQueryError = args.isQueryError ?? (() => true);
  let budget = Math.ceil(plan.length / CHUNK) * RUNS_PER_CHUNK;
  const skip = (chunk: readonly SurveyTable[], reason: string) => {
    for (const t of chunk) rows.push({ key: t.key, table: t.table, label: t.label, links: t.links, ...(t.via ? { via: t.via } : {}), total: null, inPeriod: null, latest: null, failed: reason });
  };
  const runChunk = async (chunk: readonly SurveyTable[]): Promise<void> => {
    const stop = args.shouldStop?.();
    if (stop) return skip(chunk, stop);
    if (budget <= 0) return skip(chunk, "세는 데 시간이 많이 들어 여기서 멈췄습니다 — run_sql로 직접 확인");
    let reason: string;
    try {
      const gate = await check(surveySql(chunk, args));
      if (gate.ok) {
        budget -= 1;
        const out = await db.run(gate.sql);
        const byKey = new Map(out.rows.map((r) => [String(r["표"]), r]));
        for (const t of chunk) {
          const r = byKey.get(t.key);
          rows.push({
            key: t.key,
            table: t.table,
            label: t.label,
            links: t.links,
            ...(t.via ? { via: t.via } : {}),
            total: typeof r?.["전체"] === "number" ? r["전체"] : null,
            inPeriod: typeof r?.["기간"] === "number" ? r["기간"] : null,
            latest: typeof r?.["최근"] === "string" ? r["최근"] : null,
          });
        }
        return;
      }
      reason = gate.reason;
    } catch (error) {
      if (!isQueryError(error)) throw error;
      reason = error instanceof Error ? error.message : String(error);
    }
    if (chunk.length > 1) {
      const half = Math.ceil(chunk.length / 2);
      await runChunk(chunk.slice(0, half));
      await runChunk(chunk.slice(half));
      return;
    }
    skip(chunk, reason);
  };
  for (let i = 0; i < plan.length; i += CHUNK) await runChunk(plan.slice(i, i + CHUNK));
  return rows.sort((a, b) => (b.inPeriod ?? -1) - (a.inPeriod ?? -1) || (b.total ?? -1) - (a.total ?? -1) || a.key.localeCompare(b.key));
}

/**
 * AI에게 줄 지도 — 자료 있는 표 · 기간 밖에만 있는 표 · 없는 표 · 세지 못한 표 · 세지 않은 내부 표.
 * `notes` — 범위를 정확히 밝히는 덧말(강사의 맡은 반 수 · 이름이 같은 사람 등).
 */
export function surveyForModel(
  target: SurveyTarget,
  name: string,
  from: string,
  to: string,
  rows: readonly SurveyRow[],
  extra: { internal?: readonly string[]; notes?: readonly string[] } = {},
): string {
  const withPeriod = rows.filter((r) => (r.inPeriod ?? 0) > 0 || (r.inPeriod === null && (r.total ?? 0) > 0));
  const onlyBefore = rows.filter((r) => r.inPeriod === 0 && (r.total ?? 0) > 0);
  const empty = rows.filter((r) => !r.failed && (r.total ?? 0) === 0);
  const failed = rows.filter((r) => r.failed);
  const line = (r: SurveyRow) =>
    `- ${r.table}(${r.label})${r.via === "class" ? " · 맡은 반을 거쳐" : ""} · 이은 칸 ${r.links.join("/")} · 전체 ${r.total ?? "?"}${r.inPeriod !== null ? ` · 기간 ${r.inPeriod}` : " · 날짜 칸 없음"}${r.latest ? ` · 최근 ${r.latest}` : ""}`;
  const internal = extra.internal ?? [];
  return [
    `[전수 조회] ${SURVEY_TARGET_LABEL[target]} ${name} · 기간 ${from}~${to} · 이 대상과 이어진 보기 ${rows.length}개를 셌다${internal.length ? `(학원 자료가 아닌 내부 기록 표 ${internal.length}개는 뺐다)` : ""}.`,
    ...(extra.notes ?? []).map((n) => `- ${n}`),
    "🔴 '기간 안 자료 있음'의 표는 하나도 빠짐없이 run_sql로 내용을 확인해 분석에 넣는다. 정말 볼 필요가 없는 표는 보고서 callout info '이번에 깊이 보지 않은 자료'에 표의 한국어 이름과 까닭을 적는다(영문 표 이름을 늘어놓지 않는다). 이은 칸이 여럿이면 어느 칸이 이 대상인지(가르친 것/쓴 것/맡은 것) 가려 읽는다. '맡은 반을 거쳐'는 이 강사가 맡은 반의 자료 전체다(다른 강사가 한 것도 섞인다).",
    `\n기간 안 자료 있음(${withPeriod.length}):`,
    ...withPeriod.map(line),
    `\n기간 밖에만 있음(${onlyBefore.length}):`,
    ...onlyBefore.map(line),
    `\n세지 못함(${failed.length}):`,
    ...failed.map((r) => `- ${r.table}(${r.label}) — ${r.failed}`),
    `\n자료 없음(${empty.length}): ${empty.map((r) => r.table).join(", ") || "없음"}`,
  ].join("\n");
}

/**
 * 전수 조회 한 번의 기록 — `examined`는 **이 전수 조회 뒤에** 성공한 조회가 읽은 보기(agent가 채운다).
 * 대상 id를 찾던 앞 조회(`select id from classes where …`)가 '내용 조회'으로 세지지 않게(적대 리뷰 2026-11-09).
 */
export type SurveyRecord = { target: SurveyTarget; id: string; name: string; from: string; to: string; rows: SurveyRow[]; examined: Set<string> };

/** 온톨로지 보기로 본 것은 그 원본 표도 본 것으로(onto_attendance로 출결을 봤으면 attendance_records도 '내용 조회'). */
const VIEW_SOURCES: Record<string, readonly string[]> = {
  onto_attendance: ["attendance_records"],
  onto_enrollments: ["enrollments", "classes"],
  onto_students: ["students"],
  onto_class_teachers: ["classes", "class_schedules", "class_delegations"],
};
/**
 * 원본을 직접 봤으면 그 보기도 본 것 — 보기가 **원본 하나를 거른 것**일 때만(onto_attendance ← attendance_records 등).
 * 🔴 onto_class_teachers는 여러 원본을 합친 보기라 classes를 봤다고(반 id 찾기) '반 담당 내용 조회'이 되지 않는다(적대 리뷰 2026-11-09).
 */
const VIEW_PRIMARY: Record<string, string> = { onto_attendance: "attendance_records", onto_enrollments: "enrollments", onto_students: "students" };

/** 보고서 끝 '확인한 자료 범위' — 자료 있는 표(또는 세지 못한 표)만 · 이번 답의 조회(그 전수 조회 뒤)가 그 표를 봤는지. */
export function coverageOf(surveys: readonly SurveyRecord[]): ReportCoverage {
  const seen = (views: ReadonlySet<string>) => {
    const examined = new Set(views);
    for (const [view, sources] of Object.entries(VIEW_SOURCES)) if (views.has(view)) for (const s of sources) examined.add(s);
    for (const [view, primary] of Object.entries(VIEW_PRIMARY)) if (views.has(primary)) examined.add(view);
    return examined;
  };
  return {
    surveys: surveys.map((s) => {
      const examined = seen(s.examined);
      return {
        target: SURVEY_TARGET_LABEL[s.target],
        name: s.name,
        from: s.from,
        to: s.to,
        checked: s.rows.length,
        tables: s.rows
          .filter((r) => r.failed || (r.total ?? 0) > 0)
          .map((r) => ({
            key: r.key,
            table: r.table,
            label: r.label,
            ...(r.via ? { via: r.via } : {}),
            total: r.total,
            inPeriod: r.inPeriod,
            latest: r.latest,
            examined: examined.has(r.table),
            ...(r.failed ? { failed: true } : {}),
          })),
      };
    }),
  };
}

/** 한국 날짜 'YYYY-MM-DD'(오늘) · 며칠 앞뒤. */
export function kstYmd(nowMs: number): string {
  return new Date(nowMs + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
