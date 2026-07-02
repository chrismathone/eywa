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
  status: string; // running|ok|partial|error|skipped
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** 이번 실행이 갱신한 도메인 스냅샷 {students:{status,rows}, ...} */
  domains: Record<string, { status: string; rows: number | null }> | null;
  failedDomains: string[];
  error: string | null;
};

/** 최근 동기화 실행 로그(0070a makeedu_sync_runs) — 연동 면 이력 표시. RLS로 현재 테넌트만. */
export async function getMakeeduSyncRuns(limit = 8): Promise<MakeeduSyncRun[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("makeedu_sync_runs")
    .select("id, trigger_source, status, started_at, finished_at, duration_ms, domains, failed_domains, error")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    triggerSource: r.trigger_source as string,
    status: r.status as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null,
    domains: (r.domains as MakeeduSyncRun["domains"]) ?? null,
    failedDomains: (r.failed_domains as string[] | null) ?? [],
    error: (r.error as string | null) ?? null,
  }));
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
