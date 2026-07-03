import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

// makeedu → eywa 동기화 도메인(0058a makeedu_sync_state.domain).
export type MakeeduSyncDomain =
  | "students"
  | "classes"
  | "enrollments"
  | "invoices"
  | "consultations"
  | "prospects"
  | "catalog";

export type MakeeduSyncState = {
  syncedAt: string;
  rowCount: number | null;
  status: string;
};

/**
 * 도메인별 마지막 동기화 상태. RLS(tenant_isolation)로 현재 테넌트 행만 조회 → tenant 필터 불요.
 * 동기화를 한 번도 안 한 도메인/테넌트는 null(배지 미표시).
 */
export const getMakeeduSyncState = cache(
  async (domain: MakeeduSyncDomain): Promise<MakeeduSyncState | null> => {
    const user = await getCurrentUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("makeedu_sync_state")
      .select("synced_at, row_count, status")
      .eq("domain", domain)
      .maybeSingle();
    if (!data) return null;
    return { syncedAt: data.synced_at as string, rowCount: data.row_count as number | null, status: data.status as string };
  },
);

export type MakeeduSyncRun = {
  id: string;
  triggerSource: string; // scheduled|button|relay|manual
  /** 수동 실행(button/relay)을 누른 사용자 이름. 자동(scheduled)·CLI(manual)·구데이터는 null → UI "[자동 실행]". */
  triggeredByName: string | null;
  status: string; // running|ok|partial|error|skipped
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** 이번 실행이 갱신한 도메인 스냅샷 {students:{status,rows}, ...} */
  domains: Record<string, { status: string; rows: number | null }> | null;
  failedDomains: string[];
  error: string | null;
};

/**
 * 동기화 실행 로그(0070a makeedu_sync_runs) — 연동 면 이력. RLS로 현재 테넌트만.
 * 페이지네이션(로그는 append-only라 쌓임): page(1-base)·pageSize로 잘라 {runs, total} 반환.
 */
export async function getMakeeduSyncRuns(
  page = 1,
  pageSize = 8,
): Promise<{ runs: MakeeduSyncRun[]; total: number }> {
  const user = await getCurrentUser();
  if (!user) return { runs: [], total: 0 };
  const supabase = await createClient();
  const from = (Math.max(1, page) - 1) * pageSize;
  const { data, count } = await supabase
    .from("makeedu_sync_runs")
    .select(
      "id, trigger_source, triggered_by, status, started_at, finished_at, duration_ms, domains, failed_domains, error",
      { count: "exact" },
    )
    .order("started_at", { ascending: false })
    .range(from, from + pageSize - 1);
  const rows = data ?? [];
  // "누가 실행했는지"(0076a) 이름 해석 — 이 페이지의 triggered_by를 배치 1회로(같은 테넌트 users, RLS 통과).
  const actorIds = [...new Set(rows.map((r) => r.triggered_by as string | null).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (actorIds.length) {
    const { data: actors } = await supabase.from("users").select("id, display_name").in("id", actorIds);
    for (const u of actors ?? []) nameById.set(u.id as string, (u.display_name as string | null) ?? "");
  }
  const runs = rows.map((r) => ({
    id: r.id as string,
    triggerSource: r.trigger_source as string,
    triggeredByName: r.triggered_by ? nameById.get(r.triggered_by as string) || null : null,
    status: r.status as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null,
    domains: (r.domains as MakeeduSyncRun["domains"]) ?? null,
    failedDomains: (r.failed_domains as string[] | null) ?? [],
    error: (r.error as string | null) ?? null,
  }));
  return { runs, total: count ?? 0 };
}

// ───────── 동기화 워처 심장박동(0073a) — 어느 PC가 담당·온라인인지 ─────────

export type MakeeduWorker = {
  hostname: string;
  lastSeen: string;
  startedAt: string | null;
  /** 마지막 활동이 60초 이내면 온라인(워처 폴 15초 × 4 여유). */
  online: boolean;
};

/**
 * 동기화 담당 PC(워처) 목록 + 온라인 여부. 워처가 매 폴(15초)마다 last_seen을 갱신 → 60초 이내면 온라인.
 * RLS로 현재 테넌트만. 행 없으면 [](= 지정된 PC 없음 → UI가 안내). now는 서버 렌더 시각.
 */
export async function getMakeeduSyncWorkers(nowMs: number): Promise<MakeeduWorker[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("makeedu_sync_workers")
    .select("hostname, last_seen, started_at")
    .order("last_seen", { ascending: false });
  return (data ?? []).map((w) => {
    const lastSeen = w.last_seen as string;
    return {
      hostname: w.hostname as string,
      lastSeen,
      startedAt: (w.started_at as string | null) ?? null,
      online: nowMs - new Date(lastSeen).getTime() < 60_000,
    };
  });
}

// ───────── 동기화 버튼 잠금(동시 실행/연타 방지) — 모든 사용자 공유 ─────────

/** 동기화 트리거 후 이 시간 동안 '지금 동기화' 버튼을 모든 사용자에게 비활성(연타·동시 실행 방지). */
export const SYNC_COOLDOWN_MS = 5 * 60_000; // 5분(사용자 지정). 조정하려면 이 값만.

export type MakeeduSyncLock = {
  /** 이 시각까지 버튼 비활성(마지막 트리거 + 쿨다운). null이면 트리거 기록 없음. */
  busyUntil: string | null;
  /** 지금 동기화가 실제 진행 중(pending/running 요청 또는 running 실행) — 라벨 "진행 중"용. */
  running: boolean;
};

/** 'running' 표시가 이 나이를 넘으면 stale로 간주(킬된 실행/워처가 마감 못 한 잔류) — 버튼 영구 잠금 방지. */
const RUNNING_STALE_MS = 30 * 60_000;

/**
 * 동기화 버튼 공유 잠금 상태 — DB의 요청/실행 기록에서 계산(클라 로컬 아님 → 모든 사용자 공유).
 * busyUntil = 마지막 트리거(요청 requested_at / 실행 started_at 중 최신) + SYNC_COOLDOWN_MS.
 * running = pending 요청(동기화 PC 대기 — 나이 무관, 정직한 잠금) 또는 **30분 이내의** running 요청/실행.
 * ⚠️ running 나이 제한: 프로세스가 킬되면(스케줄러 20분 컷·크래시) 'running' 행이 마감 없이 잔류해
 * 버튼이 다음 실행까지(최대 반나절) 잠기던 잠재 버그 방어 — 30분 지난 running은 stale로 무시.
 * RLS로 현재 테넌트만. 데이터 안전(dedup·원자적 claim)은 별개 — 이건 UX 잠금.
 */
export async function getMakeeduSyncLock(): Promise<MakeeduSyncLock> {
  const user = await getCurrentUser();
  if (!user) return { busyUntil: null, running: false };
  const supabase = await createClient();
  // 독립 조회 셋 → 병렬(B4). 최신 요청/실행 + 진행 중(pending/running) 요청 소수 행(나이 판정에 시각 필요).
  const [{ data: lastReq }, { data: lastRun }, { data: inflight }] = await Promise.all([
    supabase
      .from("makeedu_sync_requests")
      .select("requested_at")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("makeedu_sync_runs")
      .select("started_at, status")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("makeedu_sync_requests")
      .select("status, requested_at, started_at")
      .in("status", ["pending", "running"])
      .limit(20),
  ]);
  const now = Date.now();
  const fresh = (iso: string | null | undefined) =>
    !!iso && now - new Date(iso).getTime() < RUNNING_STALE_MS;
  const triggerTimes = [
    lastReq?.requested_at as string | undefined,
    lastRun?.started_at as string | undefined,
  ]
    .filter(Boolean)
    .map((t) => new Date(t as string).getTime());
  const lastTrigger = triggerTimes.length ? Math.max(...triggerTimes) : null;
  const running =
    (inflight ?? []).some((r) =>
      r.status === "pending"
        ? true // 대기 요청 = PC가 켜지면 처리될 정직한 잠금(나이 무관)
        : fresh((r.started_at as string | null) ?? (r.requested_at as string | null)),
    ) ||
    (lastRun?.status === "running" && fresh(lastRun.started_at as string | null));
  return {
    busyUntil: lastTrigger != null ? new Date(lastTrigger + SYNC_COOLDOWN_MS).toISOString() : null,
    running,
  };
}

export type MakeeduAutoSyncStatus = {
  /** GitHub Actions cron 자동 동기화 ON/OFF. 행이 없으면 기본 ON(cron opt-out 모델 — 끄면 cron이 스킵). */
  enabled: boolean;
  /** 도메인 통틀어 가장 최근 동기화 시각(배지 요약). */
  lastSyncedAt: string | null;
};

// ───────── 역동기화(eywa→makeedu) — QR 공개접수 상담 푸시 ─────────

export type UnpushedIntakeConsultation = {
  id: string;
  prospectName: string;
  prospectSchool: string | null;
  prospectGrade: string | null;
  parentName: string | null;
  parentPhone: string | null;
  subject: string | null;
  consultationPath: string | null;
  createdAt: string;
  /** 진행 중 푸시 요청 상태(pending|running|error) — 있으면 큐에 있거나 실패한 것. */
  pushStatus: string | null;
  pushError: string | null;
};

/**
 * makeedu 미전송 QR 공개접수 상담 후보 = from_public_intake && makeedu_id 없음 && 아직 성공 푸시 안 됨
 * && 등록완료(enrolled) 아님. 각 후보에 최신 푸시 요청 상태를 붙여(대기/실패 구분) 연동 면 목록에 표시.
 * ⚠️ enrolled 제외 이유: enrolled = "학원에 등록했다"(eywa 사실) — 예비원생 단계를 지난 학생이라 makeedu
 * 예비상담으로 보내면 "이미 다니는 학생이 신규 문의로 뜨는" 군더더기(허다언 케이스, 2026-07-02 실측 — 그는
 * makeedu 원생목록에도 이미 있었음). 등록된 학생이 makeedu 원생/예비 목록 어디에도 없으면 **원생등록 푸시**가
 * 맞는 경로 — v2 후보(예비상담 폼이 아니라 /member/student/list_regist.do, 미구현). RLS로 현재 테넌트만.
 */
export async function getUnpushedIntakeConsultations(limit = 50): Promise<UnpushedIntakeConsultation[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  // 후보: QR 접수 + makeedu 미연결 + 미푸시 + 미등록(enrolled 제외).
  const { data: rows } = await supabase
    .from("enrollment_consultations")
    .select(
      "id, prospect_name, prospect_school, prospect_grade, parent_name, parent_phone, subject, consultation_path, created_at",
    )
    .eq("from_public_intake", true)
    .is("makeedu_id", null)
    .is("makeedu_pushed_at", null)
    .neq("outcome", "enrolled")
    .order("created_at", { ascending: false })
    .limit(limit);
  const candidates = rows ?? [];
  if (candidates.length === 0) return [];

  // 각 후보의 최신 푸시 요청 상태(대기/실패 배지). 소량이라 한 번에 조회.
  const ids = candidates.map((c) => c.id as string);
  const { data: reqs } = await supabase
    .from("makeedu_push_requests")
    .select("consultation_id, status, error, requested_at")
    .in("consultation_id", ids)
    .order("requested_at", { ascending: false });
  const latest = new Map<string, { status: string; error: string | null }>();
  for (const r of reqs ?? []) {
    const cid = r.consultation_id as string;
    if (!latest.has(cid)) latest.set(cid, { status: r.status as string, error: (r.error as string | null) ?? null });
  }

  return candidates.map((c) => {
    const st = latest.get(c.id as string);
    return {
      id: c.id as string,
      prospectName: c.prospect_name as string,
      prospectSchool: (c.prospect_school as string | null) ?? null,
      prospectGrade: (c.prospect_grade as string | null) ?? null,
      parentName: (c.parent_name as string | null) ?? null,
      parentPhone: (c.parent_phone as string | null) ?? null,
      subject: (c.subject as string | null) ?? null,
      consultationPath: (c.consultation_path as string | null) ?? null,
      createdAt: c.created_at as string,
      // done/skipped는 후보에서 이미 빠지므로(pushed_at 세팅) pending|running|error만 의미.
      pushStatus: st && st.status !== "done" && st.status !== "skipped" ? st.status : null,
      pushError: st ? st.error : null,
    };
  });
}

/** makeedu 자동 동기화 토글 상태 + 최근 동기화 시각. 연동 면(MakeeduSyncCard)에서 사용. */
export async function getMakeeduAutoSyncStatus(): Promise<MakeeduAutoSyncStatus> {
  const user = await getCurrentUser();
  if (!user) return { enabled: true, lastSyncedAt: null };
  const supabase = await createClient();
  // 독립 조회 둘 → 병렬(B4). RLS(tenant_isolation)로 현재 테넌트 행만.
  const [{ data: integ }, { data: latest }] = await Promise.all([
    supabase.from("user_integrations").select("sync_enabled").eq("provider", "makeedu").maybeSingle(),
    supabase
      .from("makeedu_sync_state")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    enabled: integ?.sync_enabled !== false, // 행 없으면 기본 ON
    lastSyncedAt: (latest?.synced_at as string | undefined) ?? null,
  };
}
