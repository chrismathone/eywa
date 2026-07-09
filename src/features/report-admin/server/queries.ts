import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";
import { needsAttention, summarizeQueue, type QueueSummary } from "../classnote-queue";

/** KST 날짜에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

export type QueueItem = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
  status: string | null;
  error: string | null;
  processingAt: string | null;
  shareToken: string | null;
};

export type WorkerStatus = { hostname: string; lastSeenMinutes: number; online: boolean };

export type ClassnoteQueueView = {
  summary: QueueSummary;
  items: QueueItem[]; // 주의 필요(실패·오래됨·동명이인·멈춤) 목록 — 상한 100
  workers: WorkerStatus[];
  since: string; // 집계 시작일
  days: number;
};

// 워커 하트비트가 이 분(minutes) 이상 끊기면 오프라인(watch 데몬 15초 폴 → 넉넉히 3분).
const WORKER_OFFLINE_MINUTES = 3;

/**
 * ClassNote 발송 큐 현황(원장 보고서 관리 Part A) — 최근 N일 발송요청 보고서의 상태 집계 + 주의목록 + 워커 상태.
 * RLS로 테넌트 스코프. 로그인만 확인(읽기). edutrix getClassNoteQueueOverview 이식.
 */
export async function getClassnoteQueue(days = 3): Promise<ClassnoteQueueView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const today = kstToday();
  const since = daysBefore(today, days);
  const nowMs = Date.now();

  const { data: rowsRaw } = await supabase
    .from("lesson_reports")
    .select("id, student_id, subject, report_date, classnote_status, classnote_error, classnote_processing_at, share_token")
    .gte("report_date", since)
    .not("classnote_status", "is", null)
    .order("report_date", { ascending: false })
    .limit(1000);
  const rows = rowsRaw ?? [];

  const summary = summarizeQueue(
    rows.map((r) => ({ status: r.classnote_status as string | null, processingAt: r.classnote_processing_at as string | null })),
    nowMs,
  );

  // 주의 필요 목록(관리 액션 대상) — 상한 100.
  const attention = rows
    .filter((r) => needsAttention(r.classnote_status as string | null, r.classnote_processing_at as string | null, nowMs))
    .slice(0, 100);
  const ids = [...new Set(attention.map((r) => r.student_id as string))];
  const nameRows = await fetchInChunks<{ id: string; name: string }>(ids, (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const items: QueueItem[] = attention.map((r) => ({
    id: r.id as string,
    studentName: nameById.get(r.student_id as string) ?? "(학생)",
    subject: r.subject as string | null,
    reportDate: r.report_date as string,
    status: r.classnote_status as string | null,
    error: r.classnote_error as string | null,
    processingAt: r.classnote_processing_at as string | null,
    shareToken: r.share_token as string | null,
  }));

  const { data: wk } = await supabase.from("classnote_workers").select("hostname, last_seen");
  const workers: WorkerStatus[] = (wk ?? []).map((w) => {
    const mins = Math.floor((nowMs - Date.parse(w.last_seen as string)) / 60_000);
    return { hostname: w.hostname as string, lastSeenMinutes: Math.max(0, mins), online: mins < WORKER_OFFLINE_MINUTES };
  });

  return { summary, items, workers, since, days };
}
