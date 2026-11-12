import "server-only";
/**
 * 비서 의견 결과 재측정(제안 → 결과 → 학습 2단계 · 2026-11-09 · SQL s2_0038) — 크론(/api/cron/assistant-outcomes)이 지점마다 부른다.
 * 다시 잴 날(next_check_on)이 된 의견마다 같은 조회문으로 ① 재측정 기간 ② 저장된 기준 기간(같은 날 다시 — 기준이 흔들렸나만 본다)을
 * 같은 검사기·읽기 전용 실행기로 재어 판정을 남긴다(advice-outcome.ts — 판정은 저장된 기준값과 견준다).
 * - 조회 자체가 틀리면(칸 없음 · 보기 밖 · 결과 모양) 다음 날 다시 — MAX_FAILS번이면 '다시 재지 못함'(broken).
 * - 🔴 연결·증표 같은 일시 문제는 세지 않는다 — 그 지점은 여기서 멈추고 남은 의견은 다음 날 그대로 다시(풀러가 끊긴 날 전부가 영구 실패로 가지 않게).
 * - 지운(감춘) 대화의 의견은 재지 않는다(stopped).
 * 쓰기는 앱 관리자 연결(의견 표는 RLS 정책 0) · 조회는 비서 역할(지점 증표 · 읽기 전용) — 사람 화면을 거치지 않으므로 원장 관문 대신
 * 크론 비밀(CRON_SECRET)과 지점 AI 라이선스로 막는다(라우트).
 */
import { addDays } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { fillWindow, readCheckRow, type CheckUnit } from "../advice";
import { SETTLE_DAYS } from "../advice";
import { fillTargets } from "../advice-targets";
import { askedOnOf, closedDaysIn, judgeOutcome, MAX_FAILS, remeasureWindow } from "../advice-outcome";
import { clipText } from "../text";
import { AssistantQueryError, type AssistantDb } from "./agent";
import { ADVICE } from "./advice-store";
import type { AssistantScope } from "./executor";
import { checkAssistantSql } from "./sql-gate";
import { covers, hiddenColumnsUsed } from "../scope";

type DueRow = {
  id: string;
  thread_id: string;
  check_sql: string;
  check_unit: CheckUnit;
  check_better: "up" | "down";
  window_days: number;
  check_after_days: number;
  baseline_from: string;
  baseline_to: string;
  baseline_value: number | string;
  baseline_sample: number | string | null;
  measure_anchor: string | null;
  next_check_on: string;
  checks_done: number;
  fail_count: number;
  /** 굳힌 대상 명단(s2_0039) — 조회문의 {{대상}} 자리를 채운다. */
  target_ids: string[] | null;
  /** 의견을 만든 사람(묻는 사람) — 재측정은 이 사람의 지금 권한과 맞춰 잰다(s2_0096). */
  asked_by: string;
  /** 이 의견의 답이 쓴 자료의 묶음 키(s2_0096) — null = 표지 전 옛 의견(원장만). */
  scope_keys: string[] | null;
};
const DUE_COLUMNS =
  "id, thread_id, check_sql, check_unit, check_better, window_days, check_after_days, baseline_from, baseline_to, baseline_value, baseline_sample, measure_anchor, next_check_on, checks_done, fail_count, target_ids, asked_by, scope_keys";

export type OutcomeTally = { measured: number; failed: number; broken: number; stopped: number; left: number; paused?: string };

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** 다시 잴 날이 된 의견(오래 기다린 것부터) — 지점마다 `limit`개까지. 기준값이 있는 확인 지표만. */
async function dueAdvice(tenantId: string, today: string, limit: number): Promise<DueRow[]> {
  const { data, error } = await createAdminClient()
    .from(ADVICE)
    .select(DUE_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("measure_state", "waiting")
    .lte("next_check_on", today)
    .not("check_sql", "is", null)
    .not("baseline_value", "is", null)
    .order("next_check_on", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit)
    .returns<DueRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** 지운(감춘) 대화 — 그 의견은 재지 않는다(원장이 목록에서 치운 대화의 숫자를 계속 재지 않게). */
async function deletedThreads(tenantId: string, threadIds: string[]): Promise<Set<string>> {
  const db = createAdminClient();
  const rows = await fetchInChunks<{ id: string; deleted_at: string | null }>(threadIds, (chunk) =>
    db.from("assistant_threads").select("id, deleted_at").in("id", chunk).eq("tenant_id", tenantId).returns<{ id: string; deleted_at: string | null }[]>(),
  );
  const alive = new Set(rows.filter((r) => !r.deleted_at).map((r) => r.id));
  return new Set(threadIds.filter((id) => !alive.has(id)));
}

type Measured = { ok: true; value: number; sample: number | null } | { ok: false; transient: boolean; error: string };

/** 조회문 틀 하나를 한 기간으로 — 검사기 → 읽기 전용 실행기 → 결과 한 줄. 던지지 않는다(연결·증표 문제는 `transient`). */
async function measureWindow(db: AssistantDb, views: ReadonlySet<string>, row: DueRow, from: string, to: string, denied?: ReadonlyMap<string, string>): Promise<Measured> {
  try {
    // 대상 자리는 처음 굳힌 명단으로(s2_0039 · 기준값을 잴 때와 같은 채우기 — advice-targets.ts).
    const gate = await checkAssistantSql(fillTargets(fillWindow(row.check_sql, from, to), row.target_ids), views, denied);
    if (!gate.ok) return { ok: false, transient: false, error: `쓸 수 없는 조회입니다 — ${gate.reason}` };
    // 만든 사람에게 가린 칸(값이 null로 온다)으로는 재지 않는다 — null을 0으로 세어 판정이 틀린다(적대 리뷰 2026-11-12).
    const masked = db.hiddenColumns ? hiddenColumnsUsed(gate.tables, gate.columns, db.hiddenColumns) : [];
    if (masked.length) return { ok: false, transient: false, error: `권한 밖 칸(${masked.join(", ")})을 써서 잴 수 없습니다` };
    const read = readCheckRow(await db.run(gate.sql), row.check_unit);
    return read.ok ? { ok: true, value: read.value, sample: read.sample } : { ok: false, transient: false, error: read.error };
  } catch (error) {
    // 실패로 세는 것은 그 조회 자체가 틀린 오류(kind query)뿐 — 연결·증표·검사기 로드 같은 기반 문제는 일시 문제다.
    const counted = error instanceof AssistantQueryError && error.kind === "query";
    return { ok: false, transient: !counted, error: error instanceof Error ? error.message : "조회 오류" };
  }
}

/**
 * 한 지점의 재측정 — `openDb`는 그 지점 증표를 단 읽기 전용 연결(executor.ts openAssistantDb). 다시 잴 의견이 없으면 연결하지 않는다.
 * `deadline`(ms 시각)을 넘으면 남은 의견은 그대로 둔다(다음 날 다시). `holidays` = 그 지점 휴원일(학원 설정).
 */
export async function runAdviceOutcomes(input: {
  tenantId: string;
  today: string;
  limit: number;
  deadline: number;
  holidays: ReadonlySet<string>;
  /** 그 지점 + 범위 증표를 단 읽기 전용 연결(executor.ts openAssistantDb). */
  openDb: (scope: AssistantScope) => Promise<AssistantDb & { close(): Promise<void> }>;
  /** 의견을 만든 사람의 지금 범위(server/scope.ts userScopeKeys) — 빈 배열 = 퇴사·비서 권한 없음(재지 않는다). */
  scopeOf: (userId: string) => Promise<string[]>;
  now?: () => number;
}): Promise<OutcomeTally> {
  const now = input.now ?? Date.now;
  const tally: OutcomeTally = { measured: 0, failed: 0, broken: 0, stopped: 0, left: 0 };
  const due = await dueAdvice(input.tenantId, input.today, input.limit);
  if (due.length === 0) return tally;
  const admin = createAdminClient();
  /**
   * 기다림이고 다시 잴 날이 읽은 그대로인 줄만 고친다 — 다른 실행이 먼저 바꿨거나, 재는 사이 원장이 '완료'로 기준일을 다시 잡았으면 0줄(덮지 않는다 ·
   * 재리뷰 2026-11-09). 실제로 고친 줄만 센다. 줄 하나의 쓰기 오류는 그 줄만 건너뛴다(지점 전체를 멈추지 않는다).
   */
  const update = async (row: Pick<DueRow, "id" | "next_check_on">, patch: Record<string, unknown>): Promise<boolean> => {
    const { data, error } = await admin
      .from(ADVICE)
      .update(patch)
      .eq("id", row.id)
      .eq("tenant_id", input.tenantId)
      .eq("measure_state", "waiting")
      .eq("next_check_on", row.next_check_on)
      .select("id");
    if (error) {
      reportWarning("학원 비서 의견 결과 저장 실패", { scope: "assistant.outcomes.update", tenantId: input.tenantId, error: error.message });
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  };
  const deleted = await deletedThreads(input.tenantId, [...new Set(due.map((r) => r.thread_id))]);
  const live: DueRow[] = [];
  for (const row of due) {
    if (!deleted.has(row.thread_id)) live.push(row);
    else if (await update(row, { measure_state: "stopped", last_error: "지운 대화의 의견이라 재지 않습니다" })) tally.stopped += 1;
  }
  if (live.length === 0) return tally;
  // 🔴 만든 사람의 지금 권한과 맞춰 잰다(Codex 합의 6) — 증표 = 의견에 저장된 묶음 키(그 답이 쓴 자료)이고, 만든 사람의 지금 범위가 그것을 다 덮을 때만.
  //    퇴사·비서 권한을 잃었거나 권한이 줄었으면 재지 않는다(stopped). 표지 없는 옛 의견은 만든 사람이 지금 원장일 때만.
  const scopes = new Map<string, string[] | "failed">();
  const groups = new Map<string, { scope: AssistantScope; rows: DueRow[] }>();
  for (const row of live) {
    let keys = scopes.get(row.asked_by);
    if (keys === undefined) {
      try {
        keys = await input.scopeOf(row.asked_by);
      } catch (error) {
        // 권한을 못 읽으면 그 사람 몫은 오늘 재지 않는다(기본값으로 넓히지 않는다 · 멈춤으로 닫지도 않는다 — 다음 날 다시).
        reportWarning("학원 비서 의견 재측정 — 권한 확인 실패", { scope: "assistant.outcomes.scope", tenantId: input.tenantId, error: error instanceof Error ? error.message : String(error) });
        keys = "failed";
      }
      scopes.set(row.asked_by, keys);
    }
    if (keys === "failed") {
      tally.left += 1;
      continue;
    }
    if (keys.length === 0 || !covers(keys, row.scope_keys)) {
      const why = keys.length === 0 ? "만든 사람이 학원 비서를 쓸 수 없어 재지 않습니다" : "만든 사람의 지금 권한 밖 자료라 재지 않습니다";
      if (await update(row, { measure_state: "stopped", last_error: why })) tally.stopped += 1;
      continue;
    }
    // 증표 = 만든 사람의 지금 범위(의견 표지를 다 덮는 것을 위에서 확인했다) — 표지만으로 좁히면 표지에 없던 칸이 null로 가려 판정이 틀린다(적대 리뷰 2026-11-12).
    const token = keys;
    const key = `${row.asked_by}|${token.join(",")}`;
    const group = groups.get(key) ?? { scope: { userId: row.asked_by, keys: token }, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const ordered = [...groups.values()];
  const total = ordered.reduce((n, g) => n + g.rows.length, 0);
  let seen = 0;
  for (const group of ordered) {
    if (tally.paused || now() > input.deadline) {
      tally.left += total - seen;
      break;
    }
    seen += group.rows.length;
    const stop = await measureGroup(group.scope, group.rows);
    if (stop) {
      tally.left += total - seen;
      break;
    }
  }
  return tally;

  /** 같은 사람 · 같은 증표의 의견 묶음을 한 연결로 잰다. true = 일시 문제로 이 지점은 여기서 멈춘다. */
  async function measureGroup(scope: AssistantScope, rows: DueRow[]): Promise<boolean> {
    const db = await input.openDb(scope);
    try {
      const views = await db.views();
      const denied = (await db.denied?.()) ?? undefined;
      for (const [i, row] of rows.entries()) {
        if (now() > input.deadline) {
          tally.left += rows.length - i;
          return false;
        }
        const base = num(row.baseline_value);
        if (base === null) continue;
        const anchor = row.measure_anchor ?? askedOnOf(row.baseline_to);
        const after = remeasureWindow(anchor, row.window_days, row.check_after_days);
        // 재측정 기간이 끝나고 이틀이 아직 안 지났으면(맞지 않는 다시 잴 날) 재지 않는다 — 덜 찬 기간을 결과로 남기지 않게.
        if (after.to > addDays(input.today, -SETTLE_DAYS)) continue;
        const nowM = await measureWindow(db, views, row, after.from, after.to, denied);
        // 기준이 흔들렸나 — 재측정이 된 때만(실패면 시간을 두 배로 쓰지 않는다) · 마감이 지났으면 건너뛴다.
        const reM = nowM.ok && now() <= input.deadline ? await measureWindow(db, views, row, row.baseline_from, row.baseline_to, denied) : null;
        const transient = (!nowM.ok && nowM.transient) || (reM && !reM.ok && reM.transient);
        if (transient) {
          // 연결·증표 문제 — 세지 않고 이 지점은 여기서 멈춘다(남은 의견은 다음 날 그대로). 멈춘 줄에는 까닭만 적어 둔다(늘 같은 줄에서 멈추면 보이게).
          tally.left += rows.length - i;
          tally.paused = clipText(!nowM.ok ? nowM.error : reM && !reM.ok ? reM.error : "연결 문제", 120);
          await update(row, { last_error: clipText(`일시 문제(실패로 세지 않음): ${tally.paused}`, 200) });
          return true;
        }
        if (!nowM.ok) {
          const fails = row.fail_count + 1;
          const changed = await update(row, {
            fail_count: Math.min(fails, MAX_FAILS),
            last_error: clipText(`재측정 기간: ${nowM.error}`, 200),
            ...(fails >= MAX_FAILS ? { measure_state: "broken" } : { next_check_on: addDays(input.today, 1) }),
          });
          if (changed && fails >= MAX_FAILS) tally.broken += 1;
          else if (changed) tally.failed += 1;
          continue;
        }
        const rebase = reM && reM.ok ? reM : null;
        const judged = judgeOutcome({
          unit: row.check_unit,
          better: row.check_better,
          base,
          baseSample: num(row.baseline_sample),
          now: nowM.value,
          nowSample: nowM.sample,
          rebase: rebase?.value ?? null,
          closed: { base: closedDaysIn(input.holidays, row.baseline_from, row.baseline_to), now: closedDaysIn(input.holidays, after.from, after.to) },
        });
        const changed = await update(row, {
          measure_state: "measured",
          latest_verdict: judged.verdict,
          latest_value: nowM.value,
          latest_sample: nowM.sample,
          latest_base: rebase?.value ?? null,
          latest_base_sample: rebase?.sample ?? null,
          latest_from: after.from,
          latest_to: after.to,
          latest_delta: judged.delta,
          latest_threshold: judged.threshold,
          latest_reason: judged.reason,
          latest_checked_at: new Date(now()).toISOString(),
          checks_done: Math.min(row.checks_done + 1, 10),
          last_error: null,
        });
        if (changed) tally.measured += 1;
      }
      return false;
    } finally {
      await db.close().catch(() => undefined);
    }
  }
}
