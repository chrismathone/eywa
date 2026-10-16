import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { excludedKey } from "../evaluation/preview";
import { portfolioFloor } from "../model/build";
import { missingColumn } from "./evaluation-store";
import { awaitsReference } from "../model/pre-record";
import type { ClosingSource, PortfolioPeriod, PortfolioResult, StoredPeriod } from "../model/types";

/**
 * `teacher_portfolio_months`(0357a) 읽기·쓰기 — 강사 × 월 한 행.
 *
 * 🔴 정책이 0개인 표다. admin 클라이언트로만 읽고, **모든 조회·쓰기에 tenant_id를 적는다**(#104).
 * 🔴 마감한 달(closed_at)은 다시 쓰지 않는다 — 말일 이후의 보충이 지난달 점수를 바꾸면 안 된다.
 *    여기서 건너뛰는 것이 1차 방어이고, DB 트리거가 마지막 벽이다.
 * 🔴 표가 아직 없으면(SQL 적용 전) 읽기는 `tableMissing`으로 돌려준다 — 화면이 죽지 않는다(#95).
 */
const TABLE = "teacher_portfolio_months";
const WRITE_CHUNK = 10; // 한 행의 근거가 100KB를 넘기도 한다 — 요청 본문을 1~2MB 안에 둔다.

export type PortfolioIndexRow = {
  teacherId: string; month: string; total: number | null; knownCount: number; classCount: number; subjects: string[]; computedAt: string;
};
export type SaveSummary = { teachers: number; written: number; closedMonths: string[]; removed: number };

export function isPortfolioTableMissing(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const message = err.message ?? "";
  return message.includes(TABLE) && /does not exist|schema cache|could not find/i.test(message);
}

/**
 * 계산 창 안에서 아직 마감하지 않은 달(강사 → 달) — 지금은 수업 담당이 아니어도 그 달을 마감할 때까지 계속 계산한다.
 * 창보다 앞선 달은 다시 계산할 수 없으니 보지 않는다(그런 줄 때문에 퇴직자를 끝없이 붙들지 않게).
 */
export async function loadOpenMonths(admin: SupabaseClient, tenantId: string, floor: string): Promise<Map<string, string[]>> {
  const rows = await fetchAllPaged<{ teacher_id: string; month: string }>((from, to) =>
    admin.from(TABLE).select("teacher_id, month").eq("tenant_id", tenantId).is("closed_at", null).gte("month", floor)
      .order("teacher_id").order("month").range(from, to));
  const open = new Map<string, string[]>();
  for (const r of rows) open.set(r.teacher_id, [...(open.get(r.teacher_id) ?? []), r.month]);
  return open;
}

/** 표가 있는지만 본다 — 무거운 집계를 시작하기 전에. */
export async function portfolioTableReady(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { error } = await admin.from(TABLE).select("month").eq("tenant_id", tenantId).limit(1);
  if (!error) return true;
  if (isPortfolioTableMissing(error)) return false;
  throw new Error(`직원 포트폴리오 조회 실패: ${error.message}`);
}

/** 강사 목록용 가벼운 줄 — 근거(payload)는 읽지 않는다. */
export async function loadPortfolioIndex(admin: SupabaseClient, tenantId: string, months: readonly string[]): Promise<{ rows: PortfolioIndexRow[]; tableMissing: boolean }> {
  try {
    const rows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      admin.from(TABLE).select("teacher_id, month, total, known_count, class_count, subjects, computed_at")
        .eq("tenant_id", tenantId).in("month", [...months]).order("teacher_id").order("month").range(from, to));
    return {
      tableMissing: false,
      rows: rows.map((r) => ({
        teacherId: r.teacher_id as string, month: r.month as string, total: r.total === null ? null : Number(r.total),
        knownCount: Number(r.known_count), classCount: Number(r.class_count), subjects: (r.subjects as string[] | null) ?? [],
        computedAt: r.computed_at as string,
      })),
    };
  } catch (e) {
    // fetchAllPaged는 메시지만 던진다 — 표가 없다는 뜻이면 '아직 집계 전'으로 받는다.
    if (isPortfolioTableMissing({ message: e instanceof Error ? e.message : String(e) })) return { rows: [], tableMissing: true };
    throw e;
  }
}

/** 한 강사의 달들(최신 → 과거). 점수와 근거를 함께 싣는다. */
export async function loadTeacherPeriods(admin: SupabaseClient, tenantId: string, teacherId: string, months: readonly string[]): Promise<StoredPeriod[]> {
  const { data, error } = await admin.from(TABLE).select("month, payload, closed_at, closing_source, computed_at")
    .eq("tenant_id", tenantId).eq("teacher_id", teacherId).in("month", [...months]).order("month", { ascending: false });
  if (error) throw new Error(`직원 포트폴리오 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => ({
    ...(r.payload as PortfolioPeriod),
    closing: { closedAt: (r.closed_at as string | null) ?? null, source: (r.closing_source as ClosingSource | null) ?? null, computedAt: r.computed_at as string },
  }));
}

/** 달이 끝난 바로 다음 날 마감했으면 '말일 마감', 그보다 늦으면 남은 기록으로 다시 만든 '재구성'이다. */
export function closingSourceFor(periodEnd: string, now: Date): ClosingSource {
  return kstToday(now) <= addDays(periodEnd, 1) ? "month_end" : "reconstructed";
}

/** 0359a의 raws 칸이 있는가 — 없으면 그 칸 없이 저장한다(앱이 SQL보다 먼저 나가도 집계가 멈추지 않게, #95). */
export async function portfolioRawsReady(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { error } = await admin.from(TABLE).select("raws").eq("tenant_id", tenantId).limit(1);
  if (!error) return true;
  if (missingColumn(error)) return false;
  throw new Error(`직원 포트폴리오 조회 실패: ${error.message}`);
}

/**
 * 설정 미리보기용 원래 수치 — 끈 지표까지 싣는다(켜 보면 몇 점인지 바로 보이게).
 * 규칙과 상관없이 합계에서 뺀 칸(급여 비율의 새 선생님)은 표식을 함께 — 미리보기도 집계처럼 뺀다(`excludedKey`).
 */
export function rawsOf(w: Pick<PortfolioPeriod, "items">): Record<string, number | null> {
  return Object.fromEntries(w.items.flatMap((m): [string, number | null][] =>
    [[m.id, m.raw ?? null], ...("newcomer" in m && m.newcomer ? [[excludedKey(m.id), 1] as [string, number]] : [])]));
}

const CLOSED_LOCK = "마감한 달의 점수는 바꿀 수 없습니다";

/**
 * 10줄씩 쓴다. 🔴 같은 지점의 집계가 겹쳐(저장 직후 다시 매기기 + [지금 집계] + 1일 cron) 다른 쪽이 먼저 그 달을 마감했으면
 * 트리거가 묶음 전체를 거절한다 — 그 묶음에서 이미 마감된 줄만 빼고 한 번 더 쓴다(나머지 묶음까지 버리지 않는다).
 */
async function writeChunk(admin: SupabaseClient, tenantId: string, chunk: Record<string, unknown>[]): Promise<void> {
  const upsert = (rows: Record<string, unknown>[]) => admin.from(TABLE).upsert(rows, { onConflict: "tenant_id,teacher_id,month" });
  const { error } = await upsert(chunk);
  if (!error) return;
  if (!(error.message ?? "").includes(CLOSED_LOCK)) throw new Error(`직원 포트폴리오 저장 실패: ${error.message}`);
  const months = [...new Set(chunk.map((r) => r.month as string))];
  const { data, error: readError } = await admin.from(TABLE).select("teacher_id, month").eq("tenant_id", tenantId)
    .in("month", months).in("teacher_id", [...new Set(chunk.map((r) => r.teacher_id as string))]).not("closed_at", "is", null);
  if (readError) throw new Error(`직원 포트폴리오 저장 실패: ${readError.message}`);
  const closed = new Set((data ?? []).map((r) => `${r.teacher_id}|${r.month}`));
  const rest = chunk.filter((r) => !closed.has(`${r.teacher_id}|${r.month}`));
  if (!rest.length) return;
  const retry = await upsert(rest);
  if (retry.error) throw new Error(`직원 포트폴리오 저장 실패: ${retry.error.message}`);
}

/**
 * `holdClose` — 아직 마감하면 안 되는 칸(급여 비율을 일시 실패로 못 센 칸). 기준 달 대기처럼 열어 두고, 급여 비율 계획이
 * 마감하지 않은 달을 전부 세므로 다음 집계마다 다시 센다(`loadPayPlan`). 창 끝 달(`floor`)은 다음 실행에서 창 밖으로 밀려
 * 다시 셀 수 없으니 그래도 마감한다.
 */
export async function savePortfolioMonths(
  admin: SupabaseClient, tenantId: string, result: PortfolioResult, now: Date,
  opts: { withRaws?: boolean; holdClose?: (teacherId: string, month: string) => boolean } = {},
): Promise<SaveSummary> {
  const months = [...new Set(result.teachers.flatMap((t) => t.periods.map((w) => w.month)))];
  const existing = months.length
    ? await fetchAllPaged<{ teacher_id: string; month: string; closed_at: string | null }>((from, to) =>
      admin.from(TABLE).select("teacher_id, month, closed_at").eq("tenant_id", tenantId).in("month", months)
        .order("teacher_id").order("month").range(from, to))
    : [];
  const closed = new Set(existing.filter((r) => r.closed_at).map((r) => `${r.teacher_id}|${r.month}`));
  const lastClosedMonth = result.months.find((w) => !w.partial)?.month ?? null;
  // 창의 가장 오래된 달은 다음 실행에서 창 밖으로 밀려나 다시 계산할 수 없다 — 기준 달을 기다리던 달도 이때 마감한다.
  const floor = portfolioFloor(result.end);
  const computedAt = now.toISOString();
  const rows: Record<string, unknown>[] = [];
  const closedMonths = new Set<string>();
  const live = new Set<string>();
  for (const teacher of result.teachers) for (const w of teacher.periods) {
    const key = `${teacher.id}|${w.month}`;
    live.add(key);
    if (closed.has(key)) continue;
    const closes = !w.partial && (w.month <= floor
      || (!awaitsReference(w, result.preRecord, lastClosedMonth) && !opts.holdClose?.(teacher.id, w.month)));
    if (closes) closedMonths.add(w.month);
    rows.push({
      tenant_id: tenantId, teacher_id: teacher.id, month: w.month, period_end: w.end, total: w.total, known_count: w.knownCount,
      class_count: w.classes.length, subjects: w.subjects, payload: w, computed_at: computedAt,
      closed_at: closes ? computedAt : null, closing_source: closes ? closingSourceFor(w.end, now) : null,
      ...(opts.withRaws ? { raws: rawsOf(w) } : {}),
    });
  }
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) await writeChunk(admin, tenantId, rows.slice(i, i + WRITE_CHUNK));
  // 더는 집계 대상이 아닌 강사(퇴직 등)의 '진행 중' 줄은 걷는다. 마감한 줄은 기록이라 남긴다.
  let removed = 0;
  for (const stale of existing.filter((r) => !r.closed_at && !live.has(`${r.teacher_id}|${r.month}`))) {
    const { error } = await admin.from(TABLE).delete().eq("tenant_id", tenantId).eq("teacher_id", stale.teacher_id)
      .eq("month", stale.month).is("closed_at", null);
    if (error) throw new Error(`직원 포트폴리오 정리 실패: ${error.message}`);
    removed++;
  }
  return { teachers: result.teachers.length, written: rows.length, closedMonths: [...closedMonths].sort(), removed };
}
