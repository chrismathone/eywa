import type { SupabaseClient } from "@supabase/supabase-js";
import { positionOf, classifyTrack, type LessonPosition, type Track } from "../curriculum-position";
import { detectContainerEvent } from "../progress-detector";

// 앱(RLS·서버 클라이언트)과 백필(service-role 클라이언트) 공용 — supabase-js 클라이언트면 된다.
// (server-only 미사용: 백필 스크립트/액션이 같은 코어를 재사용해 로직 분기가 없게 함.)
type ServerClient = SupabaseClient;

// 진도 컨테이너 대상 과목 — 표준 수학 커리큘럼(curriculum.ts)과 매칭되는 subject만.
// subject_1(수학심화)·영어는 커리큘럼 없음 → 제외(edutrix highmath 제외와 동형).
const MATH_SUBJECT = "math";

export type IngestReportInput = {
  id: string;
  tenantId: string;
  studentId: string;
  reportDate: string; // YYYY-MM-DD
  subject: string | null;
  progress: string | null;
};

export type IngestResult = {
  ok: boolean;
  event?: string; // forward | regression | jump_error | overlap_error | container_full
  skipped?: "not-math" | "no-position" | "no-track" | "already-ingested" | "review";
  error?: string;
};

type ActiveContainer = {
  id: string;
  track: Track;
  lastPosition: number | null;
  chapterCount: number;
  maxJump: number;
};

/**
 * 수업보고서 1건 → 진도 컨테이너 반영 (edutrix ingestProgress 이식).
 * 위치매핑(정확 차시)→track 분류→멱등(이 보고서 이벤트 존재)→활성컨테이너 판정→entry/event.
 * 멱등성은 **progress_events.report_id** 기준(모든 ingest가 ≥1 이벤트 기록 → 재-ingest 중복 방지).
 * 실패해도 저장 흐름을 막지 않도록 호출부에서 try/catch. RLS는 supabase(테넌트 스코프)가 담당.
 */
export async function ingestReport(supabase: ServerClient, report: IngestReportInput): Promise<IngestResult> {
  if ((report.subject ?? "") !== MATH_SUBJECT) return { ok: true, skipped: "not-math" };

  const pos = positionOf(report.progress);
  if (!pos) return { ok: true, skipped: "no-position" };

  // 학생 실제 학년 → 현행/선행 분류
  const { data: stu } = await supabase.from("students").select("grade").eq("id", report.studentId).maybeSingle();
  const track = classifyTrack(stu?.grade, pos.grade);
  if (!track) return { ok: true, skipped: "no-track" };

  // 멱등: 이 보고서의 **엔트리**가 있으면 skip. 엔트리 기반(edutrix 패리티)이라 부분실패(close→open 중단)여도
  // 엔트리가 없으면 재-ingest가 재실행해 자가복구된다(이벤트 기반은 부분실패 시 영구 skip → 진도 유실이라 금지).
  // 복습 보고서는 엔트리가 없어 재저장 시 재실행되나, 이벤트는 (report_id,event_type) upsert-ignore로 중복 방지(logEvent).
  const { data: prevEntry } = await supabase
    .from("progress_entries")
    .select("id")
    .eq("report_id", report.id)
    .limit(1)
    .maybeSingle();
  if (prevEntry) return { ok: true, skipped: "already-ingested" };

  const active = await getActiveContainer(supabase, report.studentId, track);

  // 신규: 활성 컨테이너 없으면 개시 + 첫 엔트리 + forward
  if (!active) {
    const opened = await openContainer(supabase, report, track, pos);
    await appendEntry(supabase, report, opened, pos);
    await logEvent(supabase, report, {
      containerId: opened.id,
      eventType: "forward",
      from: null,
      to: pos.position,
      jumpSize: 0,
    });
    return { ok: true, event: "forward" };
  }

  const aheadStart = track === "current" ? await getAheadStartPosition(supabase, report.studentId) : null;
  const decision = detectContainerEvent({
    lastPosition: active.lastPosition,
    newPosition: pos.position,
    chapterCount: active.chapterCount,
    aheadStartPosition: aheadStart,
    track,
  });

  // 이동 이벤트 로그(container_full은 container_closed가 대신 → skip). report_id 실려 멱등 보장.
  if (decision.kind !== "container_full") {
    await logEvent(supabase, report, {
      containerId: active.id,
      eventType: decision.kind,
      from: active.lastPosition,
      to: pos.position,
      jumpSize: decision.jumpSize,
    });
  }

  // 복습/제자리(전진 없음 & 닫기 없음) → 엔트리 미생성(진도 카운트 무반영). 이벤트는 위에서 이미 기록.
  const isReview = !decision.shouldClose && active.lastPosition !== null && pos.position <= active.lastPosition;
  if (isReview) return { ok: true, event: decision.kind, skipped: "review" };

  let targetContainer: OpenedContainer = { id: active.id, lastPosition: active.lastPosition, chapterCount: active.chapterCount, maxJump: active.maxJump };
  if (decision.shouldClose) {
    await closeContainer(supabase, report, active, decision.closeReason === "full" ? "archived" : "errored", decision.closeReason);
    targetContainer = await openContainer(supabase, report, track, pos);
  }
  await appendEntry(supabase, report, targetContainer, pos);
  return { ok: true, event: decision.kind };
}

// ── 헬퍼 ──

type OpenedContainer = { id: string; lastPosition: number | null; chapterCount: number; maxJump: number };

async function getActiveContainer(supabase: ServerClient, studentId: string, track: Track): Promise<ActiveContainer | null> {
  const { data } = await supabase
    .from("progress_containers")
    .select("id, track, last_position, chapter_count, max_jump")
    .eq("student_id", studentId)
    .eq("track", track)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    track: data.track as Track,
    lastPosition: data.last_position,
    chapterCount: data.chapter_count ?? 0,
    maxJump: data.max_jump ?? 0,
  };
}

async function getAheadStartPosition(supabase: ServerClient, studentId: string): Promise<number | null> {
  const { data } = await supabase
    .from("progress_containers")
    .select("start_position")
    .eq("student_id", studentId)
    .eq("track", "ahead")
    .eq("status", "active")
    .maybeSingle();
  return data?.start_position ?? null;
}

async function nextSequenceNumber(supabase: ServerClient, studentId: string, track: Track): Promise<number> {
  const { data } = await supabase
    .from("progress_containers")
    .select("sequence_number")
    .eq("student_id", studentId)
    .eq("track", track)
    .order("sequence_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sequence_number ?? 0) + 1;
}

async function openContainer(
  supabase: ServerClient,
  report: IngestReportInput,
  track: Track,
  pos: LessonPosition,
): Promise<OpenedContainer> {
  const seq = await nextSequenceNumber(supabase, report.studentId, track);
  const { data, error } = await supabase
    .from("progress_containers")
    .insert({
      tenant_id: report.tenantId,
      student_id: report.studentId,
      track,
      sequence_number: seq,
      grade_scope: pos.grade,
      start_position: pos.position,
      last_position: pos.position,
      chapter_count: 0,
      max_jump: 0,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`openContainer 실패: ${error?.message ?? "no id"}`);
  await logEvent(supabase, report, {
    containerId: data.id,
    eventType: "container_opened",
    from: null,
    to: pos.position,
    jumpSize: null,
    details: { sequence_number: seq, track },
  });
  // 새 컨테이너는 start=last=pos, chapter_count 0 → 이후 appendEntry가 첫 엔트리로 카운트 1.
  return { id: data.id, lastPosition: pos.position, chapterCount: 0, maxJump: 0 };
}

async function closeContainer(
  supabase: ServerClient,
  report: IngestReportInput,
  active: ActiveContainer,
  status: "archived" | "errored",
  reason: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("progress_containers")
    .update({ status, error_reason: reason, archived_at: new Date().toISOString() })
    .eq("id", active.id);
  if (error) throw new Error(`closeContainer 실패: ${error.message}`);
  await logEvent(supabase, report, {
    containerId: active.id,
    eventType: "container_closed",
    from: null,
    to: active.lastPosition,
    jumpSize: null,
    details: { status, reason },
  });
}

async function appendEntry(
  supabase: ServerClient,
  report: IngestReportInput,
  container: OpenedContainer,
  pos: LessonPosition,
): Promise<void> {
  const prevLast = container.lastPosition;
  const jump = prevLast == null ? 0 : Math.max(0, pos.position - prevLast);
  const { error: entryErr } = await supabase.from("progress_entries").insert({
    tenant_id: report.tenantId,
    container_id: container.id,
    report_id: report.id,
    student_id: report.studentId,
    entry_date: report.reportDate,
    soft_chapter_name: pos.lesson,
    global_position: pos.position,
    raw_progress: report.progress,
  });
  if (entryErr) throw new Error(`appendEntry(entry) 실패: ${entryErr.message}`);
  const { error: updErr } = await supabase
    .from("progress_containers")
    .update({
      last_position: pos.position,
      chapter_count: container.chapterCount + 1,
      max_jump: Math.max(container.maxJump, jump),
    })
    .eq("id", container.id);
  if (updErr) throw new Error(`appendEntry(update) 실패: ${updErr.message}`);
}

async function logEvent(
  supabase: ServerClient,
  report: IngestReportInput,
  e: {
    containerId: string | null;
    eventType: string;
    from: number | null;
    to: number | null;
    jumpSize: number | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  // upsert-ignore: 복습 보고서 재저장 등으로 같은 (report_id, event_type)가 재요청돼도 중복 로그 방지.
  // 한 ingest 안에서는 이벤트 타입이 서로 달라 충돌 없음(jump_error/container_closed/container_opened/forward…).
  const { error } = await supabase.from("progress_events").upsert(
    {
      tenant_id: report.tenantId,
      student_id: report.studentId,
      container_id: e.containerId,
      event_type: e.eventType,
      from_position: e.from,
      to_position: e.to,
      jump_size: e.jumpSize,
      report_id: report.id,
      details: e.details ?? null,
      actor: "ingest",
    },
    { onConflict: "report_id,event_type", ignoreDuplicates: true },
  );
  if (error) throw new Error(`logEvent(${e.eventType}) 실패: ${error.message}`);
}
