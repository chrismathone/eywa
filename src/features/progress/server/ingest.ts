import type { SupabaseClient } from "@supabase/supabase-js";
import { positionOf, classifyTrack, type LessonPosition, type Track } from "../curriculum-position";
import { detectContainerEvent } from "../progress-detector";
import {
  buildJumpSuppressionDetails,
  isSameTeacher,
  jumpWarningApplies,
  normalizeTeacherName,
} from "../same-teacher-jump";

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
  /**
   * 이 보고서의 작성 강사 이름(`lesson_reports.teacher_name`) — 진도 점프 경고를 **같은 선생님 줄 안에서만**
   * 내기 위한 축(2026-08-20). 🔴 화면·발송이 쓰는 그 컬럼 값을 그대로 넘길 것(직접 조립 금지) —
   * 저장된 값과 어긋나면 같은 강사가 "다른 사람"이 돼 경고가 통째로 조용해진다.
   * null(작성자 미상)이면 비교 자체가 성립하지 않아 점프 경고는 자동 확인으로 닫힌다.
   */
  teacherName: string | null;
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
 *
 * ⚠️ 점프 경고(jump_error)는 **같은 선생님 자기 줄** 안에서만 낸다(원장 2026-08-20) — 판정은
 *    [same-teacher-jump.ts](../same-teacher-jump.ts), 억제는 이벤트를 안 남기는 게 아니라 `resolved_at`을
 *    채워 '자동 확인'으로 닫는 것이다(스키마 변경 0 · 기록은 남아 역검수 가능).
 *    🔴 **컨테이너 개폐(close→open)는 억제 여부와 무관하게 그대로** — 진도 박스 분할은 표시·집계가 이미
 *    의존하고, `errored` 컨테이너를 오류로 그리는 화면은 없다(2026-08-20 전수 확인: 진도 분석 패널은
 *    `status='active'`만 그리고, 원스크린 배지는 errored 조건을 적대 리뷰로 이미 뺐다).
 */
export async function ingestReport(supabase: ServerClient, report: IngestReportInput): Promise<IngestResult> {
  // 명시적 비수학(subject_1·english)만 제외. null=legacy 임포트(수학일 수 있음)는 통과시키고
  // positionOf(커리큘럼 정확 매핑)를 실질 필터로 삼는다(eywa 네이티브 math는 그대로 통과).
  if (report.subject != null && report.subject !== MATH_SUBJECT) return { ok: true, skipped: "not-math" };

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

  // 점프 경고는 **같은 선생님 자기 줄** 안에서만 낸다(원장 2026-08-20, same-teacher-jump.ts).
  // 조회는 점프가 났을 때만(실측 전체 이력 15건) — 평상시 라운드트립 추가 0.
  const suppression = decision.kind === "jump_error" ? await resolveJumpSuppression(supabase, report, track, pos.position) : null;

  // 이동 이벤트 로그(container_full은 container_closed가 대신 → skip). report_id 실려 멱등 보장.
  if (decision.kind !== "container_full") {
    await logEvent(supabase, report, {
      containerId: active.id,
      eventType: decision.kind,
      from: active.lastPosition,
      to: pos.position,
      jumpSize: decision.jumpSize,
      // 억제 = 이벤트를 안 남기는 게 아니라 **남기되 '자동 확인'으로 닫는 것**. 경고 표면 3곳(원스크린 배지·
      // 벨 알림·진도 분석 카드)이 전부 `resolved_at is null`을 보므로 조용해지고, 기록은 남아 역검수가 된다.
      // resolvedBy는 null(=시스템) — 사람이 누른 '이상 없음'(0151a)과 화면에서 구분된다.
      ...(suppression ? { resolvedAt: new Date().toISOString(), details: suppression } : {}),
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

/**
 * 같은 학생·같은 track에서 **이 보고서 작성자와 같은 강사**가 쓴 직전 엔트리를 훑는 개수 상한.
 * 실측(2026-08-20 injaewon) 학생×track당 엔트리 최대 12개(평균 3.3) — 60은 5배 여유다.
 * 상한을 두는 이유는 [[#54]](무페이징 select = 1000행 silent 절단)와 같은 결: 결과를 "고르는" 쿼리라
 * 범위를 코드가 정해야 한다. 넘칠 만큼 오래된 학생이 생기면 그 강사의 직전을 못 찾아 **경고가 억제**된다
 * (경고를 더 내는 쪽이 아니라 덜 내는 쪽으로 틀린다 — 규칙의 기본 방향과 같다).
 */
const SAME_TEACHER_LOOKBACK = 60;

/**
 * 점프 경고 억제 판정 — 억제할 이유가 있으면 details(=자동 확인 표식)를, 아니면 null(경고 유지)을 돌린다.
 * ⚠️ 조회가 실패하면 **경고를 유지**한다(= 이 기능이 없던 때의 동작). 조용히 억제하면 경고가 사라진 걸
 *    아무도 모른다 — 실패는 로그로 드러내고 판단은 사람에게 남긴다.
 */
async function resolveJumpSuppression(
  supabase: ServerClient,
  report: IngestReportInput,
  track: Track,
  newPosition: number,
): Promise<ReturnType<typeof buildJumpSuppressionDetails> | null> {
  let sameTeacherLastPosition: number | null = null;
  try {
    sameTeacherLastPosition = await findSameTeacherLastPosition(supabase, report, track);
  } catch (e) {
    console.error("[progress] 같은 강사 직전 진도 조회 실패 — 점프 경고 유지:", e instanceof Error ? e.message : e);
    return null;
  }
  if (jumpWarningApplies({ sameTeacherLastPosition, newPosition })) return null;
  return buildJumpSuppressionDetails({ teacherName: report.teacherName, sameTeacherLastPosition });
}

/**
 * 이 보고서 작성자와 같은 강사가 그 학생·같은 track에 쓴 **직전** 엔트리 위치.
 * - 날짜 상한(`entry_date <= report_date`)이 핵심이다 — 없으면 **나중에 쓴 진도**와 비교하게 돼
 *   재판정(백필·일회성 스크립트)에서 결론이 뒤집힌다(실측: 이재희 8/10 건이 상한 없이는 8/13 엔트리와 비교돼
 *   억제로 뒤집혔다).
 * - 이름 정규화(공백·대소문자)는 SQL로 표현할 수 없어 **JS에서** 고른다 — 그래서 후보를 몇 줄 받아 훑는다.
 * - 비교 대상은 **엔트리**다 — 복습·역행 보고서는 엔트리를 만들지 않으므로(위 isReview) 그 강사가
 *   복습만 썼다면 비교 대상이 없어 억제된다. 진도를 실제로 밀어 올린 기록만 '그 강사의 줄'로 본다.
 */
async function findSameTeacherLastPosition(
  supabase: ServerClient,
  report: IngestReportInput,
  track: Track,
): Promise<number | null> {
  if (normalizeTeacherName(report.teacherName) === null) return null; // 작성자 미상 = 비교 불가

  const { data, error } = await supabase
    .from("progress_entries")
    // ⚠️ 임베드는 FK 이름을 명시한다([[#94]] — 컬럼 하나 더한 날 조용히 300으로 죽지 않게).
    .select(
      "global_position, entry_date, container:progress_containers!progress_entries_container_id_fkey!inner(track), report:lesson_reports!progress_entries_report_id_fkey(teacher_name)",
    )
    .eq("student_id", report.studentId)
    .eq("container.track", track)
    .lte("entry_date", report.reportDate)
    .neq("report_id", report.id) // 이번 보고서 제외(재-ingest·재판정에서 자기 자신과 비교하지 않게)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(SAME_TEACHER_LOOKBACK);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    // PostgREST 임베드는 관계에 따라 객체/배열로 온다 — 둘 다 받는다(queries.ts resolver와 같은 처리).
    const linked = (Array.isArray(row.report) ? row.report[0] : row.report) as { teacher_name?: string | null } | null;
    if (!isSameTeacher(linked?.teacher_name, report.teacherName)) continue;
    if (typeof row.global_position !== "number") continue; // 위치 없는 엔트리는 비교 대상이 아니다
    return row.global_position;
  }
  return null;
}

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
    /** 시스템 자동 확인(=경고 억제) 시각. 사람이 누른 확인(0151a)과 달리 resolved_by는 비운다. */
    resolvedAt?: string;
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
      ...(e.resolvedAt ? { resolved_at: e.resolvedAt } : {}),
    },
    { onConflict: "report_id,event_type", ignoreDuplicates: true },
  );
  if (error) throw new Error(`logEvent(${e.eventType}) 실패: ${error.message}`);
}
