import { timingSafeEqual } from "node:crypto";
import { kstToday } from "@/lib/date-kst";
import { after, NextResponse } from "next/server";
import { getTranscript } from "@/lib/ai/assemblyai";
import { localizeTranscriptionError } from "@/lib/ai/transcription-error";
import {
  analyzeMeeting,
  buildMeetingAnalysisInput,
  type MeetingReport,
} from "@/features/meetings/server/ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { CHINSAN_SCHOOL_SAVE_ALIASES } from "@/features/schools/school-name";
import { reportError } from "@/lib/observability/report-error";
import { analyzeStudentConsultation } from "@/features/consultations/server/ai";
import { extractConsultationForm } from "@/features/enrollment/server/form-extract";
import { runConsultationAnalysis } from "@/features/enrollment/server/consultation-analysis";
import {
  buildFormPatch,
  type CurrentConsultationValues,
  type ExtractedConsultationForm,
} from "@/features/enrollment/form-fill";
import { combineConsultationTranscripts } from "@/features/enrollment/transcripts";
import { trimTrailingNoise, type TrimUtterance } from "@/lib/ai/transcript-trim";
import { syncMirrorAfterRecordingFailure } from "@/features/enrollment/server/recording-mirror";
import { isFresh, isInFlight } from "@/lib/ai/transcription-inflight";
import { handleReviewTranscriptWebhook } from "@/features/video-review/server/transcribe";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 상수시간 문자열 비교 — 타이밍 공격 방지. 길이 다르면 즉시 false. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 파이프라인 전진 write(analyzing/completed/upsert)의 반환 {error}를 검사·로깅(B3).
 * 배경: 이 background write들이 조용히 실패하면 분석이 끝난 행이 결과를 못 보이고 멈춘 것처럼 남았다.
 * 상태 전이 자체는 불변 — 실패 시 reportError로 표면화만(B2 cron이 멈춘 행을 따로 회수).
 */
async function runWrite(
  scope: string,
  recordId: string,
  query: PromiseLike<{ error: unknown }>,
): Promise<void> {
  const { error } = await query;
  if (error) reportError(error, { scope: `webhook.${scope}`, recordId });
}

// AssemblyAI may pause up to a few minutes between calls; give Claude plenty of room too.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// 상담 흐름 수형도(대화 주제 트리) — ijw conversationFlow와 동일 구조.
export type ConversationFlowNode = {
  topic: string;
  summary: string;
  children?: ConversationFlowNode[];
};

type WebhookBody = {
  transcript_id?: string;
  status?: "completed" | "error";
};

/** 사람이 다시 누를 수 있게 남기는 실패 문구(원문 영어는 로그로만). 어느 단계에서 멈췄는지 모르니 버튼 이름을 적지 않는다. */
const BACKGROUND_CRASH_ERROR = "AI 처리가 중간에 멈췄습니다 — 화면에서 다시 실행해 주세요.";
/**
 * 백그라운드 일의 자체 기한 — 함수 상한(maxDuration 300초)에 끊기면 catch도 돌지 못해 행이 '분석 중'에 머문다
 * (곧바로 답하므로 AssemblyAI 재전송도 없고, 하루 1회 cron만 걷는다). 30초를 남기고 실패로 돌린다.
 * ⚠️ 기한 뒤에도 일이 잠시 이어질 수 있지만 끝까지 간다는 보장은 없다(after가 끝나면 실행 환경이 멈출 수 있다) —
 *    끝까지 가면 그 일이 '완료'를 다시 쓰고, 아니면 '실패'로 남아 사람이 다시 누른다.
 */
const BACKGROUND_DEADLINE_MS = 270_000;
type ProcessingTable = "meeting_minutes" | "enrollment_consultations" | "student_consultations";

/** 아직 진행 중인 행만 'failed'로(완료된 행은 건드리지 않는다). */
async function markRowFailed(admin: SupabaseClient, table: ProcessingTable, rowId: string) {
  await admin
    .from(table)
    .update({ processing_status: "failed", processing_error: BACKGROUND_CRASH_ERROR })
    .eq("id", rowId)
    .in("processing_status", ["uploaded", "transcribing", "analyzing"]);
}

/**
 * 알림을 받았다고 **곧바로 답하고**, 무거운 일은 응답 뒤(after)에 돌린다. 일 안에서 예상 못 한 오류가 나거나 기한을 넘기면
 * 그 행이 '분석 중'에 머물지 않게 'failed'로 돌린다(`onCrash`가 있으면 그것으로 — 다중 녹음).
 */
function acceptInBackground(
  table: ProcessingTable,
  rowId: string,
  work: () => Promise<unknown>,
  onCrash?: (admin: SupabaseClient, startedAt: number) => Promise<void>,
) {
  after(async () => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`background deadline ${BACKGROUND_DEADLINE_MS / 1000}s`)), BACKGROUND_DEADLINE_MS);
    });
    try {
      await Promise.race([work(), deadline]);
    } catch (e) {
      reportError(e, { scope: "assemblyai.webhook.background", table, rowId });
      try {
        const admin = createAdminClient();
        await (onCrash ? onCrash(admin, startedAt) : markRowFailed(admin, table, rowId));
      } catch {
        // 여기서도 실패하면 하루 1회 cron(reconcile-transcriptions)이 30분 넘은 행을 돌린다.
      }
    } finally {
      clearTimeout(timer);
    }
  });
  return NextResponse.json({ ok: true, accepted: true });
}

/**
 * 다중 녹음의 백그라운드가 죽었을 때 — 다른 녹음이 상담을 이어 가고 있으면 상담 전체를 실패로 덮지 않는다:
 * ① 다른 녹음이 아직 전사 중(그 녹음의 완료가 다시 분석한다 · `analyzeConsultationAndPersist`의 inFlightRemains와 같은 규칙)
 * ② 다른 녹음이 **이 일이 시작된 뒤에** 바뀌었다(전사를 마치고 지금 그 웹훅이 더 완전한 합본으로 분석 중일 수 있다).
 * 이 녹음 행이 멈췄으면 cron이 30분 뒤 걷는다.
 */
async function failConsultationUnlessOthersInFlight(
  admin: SupabaseClient,
  consultationId: string,
  recordingId: string,
  startedAt: number,
) {
  const { data } = await admin
    .from("consultation_recordings")
    .select("id, processing_status, updated_at")
    .eq("consultation_id", consultationId);
  const othersActive = (data ?? []).some((r) => {
    if (r.id === recordingId) return false;
    if (r.processing_status === "uploaded" || r.processing_status === "transcribing") return true;
    const changed = Date.parse(String(r.updated_at ?? ""));
    return Number.isFinite(changed) && changed >= startedAt;
  });
  if (!othersActive) await markRowFailed(admin, "enrollment_consultations", consultationId);
}

export async function POST(req: Request) {
  // Fail-closed: 시크릿 미설정이면 엔드포인트를 닫는다(이전 `if (expected && …)`는 미설정 시
  // 검사를 통째로 건너뛰어 누구나 임의 transcript_id로 AI 분석·PII 쓰기를 트리거할 수 있었다, #S3).
  const expected = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  const provided = req.headers.get("x-eywa-webhook-secret") ?? "";
  if (!expected || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const transcriptId = body.transcript_id;
  if (!transcriptId) {
    return NextResponse.json({ error: "missing transcript_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Dispatch: meeting first, then consultation. Each row carries the same transcript id.
  // 🔴 무거운 일(전사 가져오기·AI 분석·저장)은 **응답 뒤에**(after) 돈다(2026-10-19). AssemblyAI는 10초 안에 2xx가 없으면
  //    10초 간격으로 최대 10번 다시 보내는데, 분석(1~3분)을 끝낸 뒤 답하던 때는 그 재전송마다 분석이 처음부터 다시 돌아
  //    녹음 1건에 AI가 6~11번 불렸다(30일 중복 82~89% · 결과도 여러 번 덮어씀). 이제 이 함수는 행을 찾고 곧바로 답한다.
  //    after 안에서 죽거나 270초 기한을 넘기면 그 행을 'failed'로 돌린다(못 돌리면 하루 1회 cron reconcile-transcriptions가 30분 넘은 행을 돌린다).
  const { data: meeting } = await admin
    .from("meeting_minutes")
    .select("id, tenant_id, title, attendees, held_at, content, processing_status, updated_at")
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (meeting) {
    // 멱등성 — 이미 완료된 건의 재전송이면 재분석(유료 AI) 중복을 막고 skip(#S3 replay).
    if (meeting.processing_status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    // 이미 분석 중(방금 시작)이면 같은 알림이 한 번 더 온 것 — 두 번째 분석을 돌리지 않는다.
    if (isInFlight(meeting.processing_status, meeting.updated_at)) {
      return NextResponse.json({ ok: true, skipped: "already in progress" });
    }
    return acceptInBackground("meeting_minutes", meeting.id, () => handleMeeting(admin, transcriptId, meeting));
  }

  // 등록상담 녹음 행(consultation_recordings) — 신규 경로(녹음=여러 행). 레거시 단일 컬럼보다 먼저 매칭.
  const { data: recording } = await admin
    .from("consultation_recordings")
    .select(
      "id, processing_status, created_at, consultation:consultation_id (id, tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, processing_status, updated_at)",
    )
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (recording?.consultation) {
    // PostgREST 단일 FK 임베드는 객체를 주지만 타입은 배열 유니온이라 단언.
    const rc = recording.consultation as unknown as ConsultationContext & {
      processing_status: string;
      updated_at: string | null;
    };
    if (recording.processing_status === "completed") {
      // 전사는 끝났는데 상담 미러가 미완이면 = 분석 단계에서 죽은 것(함수 타임아웃/크래시).
      // replay를 분석 복구로 취급 — 완료 녹음 합본으로 분석만 재실행(전사 재fetch·행 재기록 불요).
      // (적대리뷰 #2: 레거시 경로는 replay로 회복됐던 것의 회귀 방지.)
      // 🔴 단, 방금 시작한 분석이 아직 도는 중이면(10분 안) 복구가 아니라 같은 알림의 재전송이다 — 건너뛴다(2026-10-19).
      if (rc.processing_status === "analyzing" || rc.processing_status === "transcribing") {
        if (isFresh(rc.updated_at)) return NextResponse.json({ ok: true, skipped: "already in progress" });
        return acceptInBackground(
          "enrollment_consultations",
          rc.id,
          () => recoverConsultationAnalysis(admin, rc),
          (a, startedAt) => failConsultationUnlessOthersInFlight(a, rc.id, recording.id, startedAt),
        );
      }
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    return acceptInBackground(
      "enrollment_consultations",
      rc.id,
      () =>
        handleConsultationRecording(
          admin,
          transcriptId,
          { id: recording.id, createdAt: recording.created_at as string },
          rc,
        ),
      (a, startedAt) => failConsultationUnlessOthersInFlight(a, rc.id, recording.id, startedAt),
    );
  }

  // 레거시 경로 — 배포 전 in-flight(transcript id가 상담 행에 직접 붙은) 건 처리용 폴백.
  const { data: consult } = await admin
    .from("enrollment_consultations")
    .select(
      "id, tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, processing_status, updated_at",
    )
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (consult) {
    if (consult.processing_status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    if (isInFlight(consult.processing_status, consult.updated_at)) {
      return NextResponse.json({ ok: true, skipped: "already in progress" });
    }
    return acceptInBackground("enrollment_consultations", consult.id, () => handleConsultation(admin, transcriptId, consult));
  }

  // 재원생 학생상담(student_consultations) — 학생 컨텍스트는 student_id 조인.
  const { data: sc } = await admin
    .from("student_consultations")
    .select(
      "id, tenant_id, processing_status, updated_at, consulted_at, audience, category, student:student_id ( name, grade, school )",
    )
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (sc) {
    if (sc.processing_status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    if (isInFlight(sc.processing_status, sc.updated_at)) {
      return NextResponse.json({ ok: true, skipped: "already in progress" });
    }
    return acceptInBackground("student_consultations", sc.id, () => handleStudentConsultation(admin, transcriptId, sc));
  }

  // 영상 설명 AI 참고 메모(0390a) — 전사만 받아 넣는다(판정은 밤 배치가 한다). 가벼운 일이지만 같은 규약으로 응답 뒤에.
  const { data: review } = await admin.from("homework_video_reviews").select("id, stage").eq("transcript_id", transcriptId).maybeSingle();
  if (review) {
    if (review.stage !== "transcribing") return NextResponse.json({ ok: true, skipped: "already applied" });
    after(() => handleReviewTranscriptWebhook(transcriptId).then(() => undefined).catch((e) => reportError(e, { scope: "assemblyai.video-review", transcriptId })));
    return NextResponse.json({ ok: true, accepted: "video-review" });
  }

  console.warn("[assemblyai webhook] no matching row for transcript", transcriptId);
  return NextResponse.json({ ok: true, skipped: "no row" });
}

// ─────────────────────────── meeting flow ───────────────────────────

async function handleMeeting(
  admin: SupabaseClient,
  transcriptId: string,
  meeting: {
    id: string;
    tenant_id: string;
    title: string;
    attendees: unknown;
    held_at: string;
    content: string | null;
  },
) {
  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("meeting_minutes")
      .update({ processing_status: "failed", processing_error: localizeTranscriptionError(msg) })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await admin
      .from("meeting_minutes")
      .update({
        processing_status: "failed",
        processing_error: localizeTranscriptionError(transcript.error ?? "전사 결과가 비어있습니다"),
      })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }

  const cleanedText = transcript.text.replace(/\s/g, "");
  if (cleanedText.length < 30) {
    await admin
      .from("meeting_minutes")
      .update({
        processing_status: "failed",
        processing_error: `인식된 텍스트가 너무 짧습니다 (${cleanedText.length}자)`,
        transcription: transcript.text,
      })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }
  if ((transcript.audio_duration ?? 0) < 5) {
    await admin
      .from("meeting_minutes")
      .update({
        processing_status: "failed",
        processing_error: "녹음 시간이 너무 짧습니다 (5초 이상 필요)",
        transcription: transcript.text,
      })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }

  await runWrite(
    "meeting.analyzing",
    meeting.id,
    admin
      .from("meeting_minutes")
      .update({
        transcription: transcript.text,
        speaker_labels: transcript.utterances ?? [],
        audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
        processing_status: "analyzing",
        processing_error: null,
      })
      .eq("id", meeting.id),
  );

  // 전사 포맷·8섹션 분석은 공유 단일 소스(features/meetings/server/ai.ts) — 재분석 액션과 동일.
  // B: 회의 종료 후 섞인 뒷부분 잡음 꼬리를 분석 입력에서 제외(raw transcription/speaker_labels 저장분은 위에서 전체 보존).
  const { formatted } = buildMeetingAnalysisInput(transcript.text, transcript.utterances);
  const attendees = Array.isArray(meeting.attendees) ? (meeting.attendees as string[]) : [];
  const heldAt = new Date(meeting.held_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

  let report: MeetingReport;
  let speakerRoles: Record<string, string> = {};
  let modelVersion = "";

  try {
    // 메모장(content)이 있으면 전사와 함께 분석 — 작성자가 짚은 핵심을 회의록에 결합.
    const result = await analyzeMeeting(formatted, {
      title: meeting.title,
      heldAt,
      attendees,
      notepad: meeting.content,
      tenantId: meeting.tenant_id,
    });
    report = result.report;
    speakerRoles = result.speakerRoles;
    modelVersion = result.model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("meeting_minutes")
      .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }

  await runWrite(
    "meeting.completed",
    meeting.id,
    admin
      .from("meeting_minutes")
      .update({
        ai_report: report,
        ai_speaker_roles: speakerRoles,
        ai_summary: report.summary,
        ai_model_version: modelVersion,
        ai_generated_at: new Date().toISOString(),
        processing_status: "completed",
        processing_error: null,
      })
      .eq("id", meeting.id),
  );

  return NextResponse.json({ ok: true });
}

// ─────────────────────────── consultation flow ───────────────────────────

/** 상담 컨텍스트 — 분석 프롬프트에 들어가는 상담 행 필드(레거시 단일 컬럼·녹음 행 경로 공용). */
type ConsultationContext = {
  id: string;
  tenant_id: string;
  prospect_name: string;
  prospect_grade: string | null;
  prospect_school: string | null;
  parent_name: string | null;
  parent_phone: string | null;
};

/**
 * 녹음 행 실패 처리 — 행에 실패 기록 후, 상담 미러는 syncMirrorAfterRecordingFailure로 동기화:
 * 완료 녹음이 하나라도 있으면 미러 completed 복원(상담 전체가 '처리 실패'로 오표시되는 것 방지 —
 * 실패는 그 녹음 행의 상태칩·에러로만), 없으면 레거시처럼 failed + 에러(적대리뷰 #9).
 */
async function failRecording(
  admin: SupabaseClient,
  recordingId: string,
  consultationId: string,
  message: string,
  partialTranscript?: string,
) {
  await admin
    .from("consultation_recordings")
    .update({
      processing_status: "failed",
      processing_error: message,
      ...(partialTranscript ? { transcription: partialTranscript } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", recordingId);
  await syncMirrorAfterRecordingFailure(admin, consultationId, message);
}

/**
 * 등록상담 녹음 행(consultation_recordings) 완료 처리 — 신규 경로(녹음=여러 행, 2026-07-02).
 * 전사를 녹음 행에 저장(행 상태 completed)한 뒤, 이 상담의 **완료된 전체 녹음 전사 합본**으로
 * 13섹션 분석·폼 보강을 재실행한다 → 녹음이 추가될 때마다 분석이 전체 맥락으로 갱신(추가 분석).
 * 상담 행 단일 컬럼은 미러: transcription=합본, speaker_labels=단일 녹음일 때만, 상태=진행 상태.
 */
/** 완료 녹음 행 타입(합본용 최소 필드). */
type DoneRecordingRow = {
  id: string;
  transcription: string | null;
  speaker_labels: unknown;
  created_at: string;
};

/**
 * 완료 녹음 행들 → 합본 입력. trim=true면 각 녹음의 종료 후 잡음 꼬리(B)를 잘라낸 발화로 합본
 * (분석 입력용). trim=false면 원본 그대로(저장 미러용 — raw 보존). 화자 라벨 없는 녹음(옛 통짜 전사)은
 * 타임스탬프가 없어 트림 불가 → plainText 그대로(프롬프트 지침 C가 방어).
 */
function toCombineInputs(rows: DoneRecordingRow[], trim = false) {
  return rows.map((r) => {
    const raw = Array.isArray(r.speaker_labels) ? (r.speaker_labels as TrimUtterance[]) : null;
    return {
      utterances: raw && trim ? trimTrailingNoise(raw).kept : raw,
      plainText: r.transcription,
      recordedAt: r.created_at,
    };
  });
}

/**
 * 단일 전사(레거시 상담·재원생 학생상담)를 [화자 X] 텍스트로 포맷 — 종료 후 잡음 꼬리(B) 트림 적용.
 * 화자 라벨이 없으면(타임스탬프 없음) plainText 그대로(C 프롬프트가 방어). 저장 미러는 호출부가 별도로 full 저장.
 */
function formatTrimmedTranscript(utterances: unknown, plainText: string): string {
  const utts = Array.isArray(utterances) ? (utterances as TrimUtterance[]) : [];
  if (utts.length === 0) return plainText;
  const kept = trimTrailingNoise(utts).kept;
  return kept.length > 0 ? kept.map((s) => `[화자 ${s.speaker}] ${s.text}`).join("\n") : plainText;
}

/**
 * 분석 복구 — 녹음 행은 completed인데 상담 미러가 analyzing/transcribing에 멈춘 경우
 * (분석 단계에서 함수 타임아웃/크래시 후 AssemblyAI가 웹훅을 재전송). 저장된 완료 전사 합본으로
 * 분석만 재실행한다(전사 재fetch·행 재기록 불요). 적대리뷰 #2.
 */
async function recoverConsultationAnalysis(admin: SupabaseClient, consult: ConsultationContext) {
  const { data: doneRecs } = await admin
    .from("consultation_recordings")
    .select("id, transcription, speaker_labels, created_at")
    .eq("consultation_id", consult.id)
    .eq("processing_status", "completed")
    .order("created_at", { ascending: true });
  const rows = (doneRecs ?? []) as DoneRecordingRow[];
  if (rows.length === 0) return NextResponse.json({ ok: true, skipped: "no completed recordings" });

  const inputs = toCombineInputs(rows);
  const combined = combineConsultationTranscripts(inputs); // full — 저장 미러(raw 보존)
  // B: 분석 입력만 종료 후 잡음 꼬리를 잘라낸 합본으로.
  const combinedForAnalysis = combineConsultationTranscripts(toCombineInputs(rows, true));
  const multi =
    inputs.filter((i) => (i.utterances?.length ?? 0) > 0 || (i.plainText ?? "").trim().length > 0)
      .length > 1;

  await runWrite(
    "consultation.analyzing",
    consult.id,
    admin
      .from("enrollment_consultations")
      .update({
        transcription: combined,
        processing_status: "analyzing",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", consult.id),
  );

  return analyzeConsultationAndPersist(admin, consult, combinedForAnalysis, {
    multi,
    analyzedIds: rows.map((r) => r.id),
  });
}

async function handleConsultationRecording(
  admin: SupabaseClient,
  transcriptId: string,
  rec: { id: string; createdAt: string },
  consult: ConsultationContext,
) {
  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failRecording(admin, rec.id, consult.id, localizeTranscriptionError(msg));
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await failRecording(
      admin,
      rec.id,
      consult.id,
      localizeTranscriptionError(transcript.error ?? "전사 결과가 비어있습니다"),
    );
    return NextResponse.json({ ok: true });
  }

  const cleanedText = transcript.text.replace(/\s/g, "");
  if (cleanedText.length < 30 || (transcript.audio_duration ?? 0) < 5) {
    await failRecording(
      admin,
      rec.id,
      consult.id,
      "녹음이 너무 짧거나 음성이 인식되지 않았습니다",
      transcript.text,
    );
    return NextResponse.json({ ok: true });
  }

  // 녹음 행 = 전사 확정 시점에 completed(분석은 상담 레벨 상태로 추적).
  await runWrite(
    "consultation.recording.completed",
    rec.id,
    admin
      .from("consultation_recordings")
      .update({
        transcription: transcript.text,
        speaker_labels: transcript.utterances ?? [],
        audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
        processing_status: "completed",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rec.id),
  );

  // 완료된 전체 녹음 합본(시간순) — 1개면 레거시와 동일 포맷(프롬프트 무변).
  // ⚠️ 현재 녹음은 DB read-back이 아니라 **in-memory 전사를 직접 병합** — 바로 위 completed write가
  // 실패(runWrite는 로깅만)해도 합본에서 이 전사가 빠지지 않는다(적대리뷰 #3).
  const { data: doneRecs } = await admin
    .from("consultation_recordings")
    .select("id, transcription, speaker_labels, created_at")
    .eq("consultation_id", consult.id)
    .eq("processing_status", "completed")
    .neq("id", rec.id)
    .order("created_at", { ascending: true });
  const rows: DoneRecordingRow[] = [
    ...((doneRecs ?? []) as DoneRecordingRow[]),
    {
      id: rec.id,
      transcription: transcript.text,
      speaker_labels: transcript.utterances ?? [],
      created_at: rec.createdAt,
    },
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const inputs = toCombineInputs(rows);
  const combined = combineConsultationTranscripts(inputs); // full — 저장 미러(raw 보존)
  // B: 분석 입력만 종료 후 잡음 꼬리를 잘라낸 합본으로(미러는 full 유지 = 비파괴, 상세 전사 표시는 전체 그대로).
  const combinedForAnalysis = combineConsultationTranscripts(toCombineInputs(rows, true));
  const nonEmptyCount = inputs.filter(
    (i) => (i.utterances?.length ?? 0) > 0 || (i.plainText ?? "").trim().length > 0,
  ).length;
  const multi = nonEmptyCount > 1;

  // 상담 행 미러 — transcription=합본(전체 맥락). 다중 녹음이면 단일 speaker_labels는 비워
  // 합본 텍스트와 어긋난 stale 화자 라벨 노출을 방지(녹음별 라벨은 각 행에 보존). 상태는 analyzing.
  await runWrite(
    "consultation.analyzing",
    consult.id,
    admin
      .from("enrollment_consultations")
      .update({
        transcription: combined,
        speaker_labels: multi ? [] : (transcript.utterances ?? []),
        audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
        processing_status: "analyzing",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", consult.id),
  );

  return analyzeConsultationAndPersist(admin, consult, combinedForAnalysis, {
    multi,
    analyzedIds: rows.map((r) => r.id),
  });
}

async function handleConsultation(
  admin: SupabaseClient,
  transcriptId: string,
  consult: ConsultationContext,
) {
  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: localizeTranscriptionError(msg) })
      .eq("id", consult.id);
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await admin
      .from("enrollment_consultations")
      .update({
        processing_status: "failed",
        processing_error: localizeTranscriptionError(transcript.error ?? "전사 결과가 비어있습니다"),
      })
      .eq("id", consult.id);
    return NextResponse.json({ ok: true });
  }

  const cleanedText = transcript.text.replace(/\s/g, "");
  if (cleanedText.length < 30 || (transcript.audio_duration ?? 0) < 5) {
    await admin
      .from("enrollment_consultations")
      .update({
        processing_status: "failed",
        processing_error: "녹음이 너무 짧거나 음성이 인식되지 않았습니다",
        transcription: transcript.text,
      })
      .eq("id", consult.id);
    return NextResponse.json({ ok: true });
  }

  await runWrite(
    "consultation.analyzing",
    consult.id,
    admin
      .from("enrollment_consultations")
      .update({
        transcription: transcript.text,
        speaker_labels: transcript.utterances ?? [],
        audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
        processing_status: "analyzing",
        processing_error: null,
      })
      .eq("id", consult.id),
  );

  // B: 종료 후 잡음 꼬리를 분석 입력에서 제외(저장된 transcription/speaker_labels는 위에서 full 보존).
  const formatted = formatTrimmedTranscript(transcript.utterances, transcript.text);

  return analyzeConsultationAndPersist(admin, consult, formatted, { multi: false });
}

/**
 * 13섹션 심층분석 + 폼 추출 + consultation_ai_analysis upsert + 빈 필드 자동보강 — 공유 tail.
 * 레거시 단일 컬럼 경로(handleConsultation)와 녹음 행 경로(handleConsultationRecording)가 공유한다.
 * formatted = 단일 전사 또는 다중 녹음 합본(《녹음 n》 헤더). multi면 프롬프트에 회차 안내 한 줄 추가
 * (단일이면 레거시와 바이트 동일 프롬프트 — 기존 품질 보존).
 *
 * opts.analyzedIds(녹음 행 경로만): 이 분석의 입력이 된 완료 녹음 id 집합 — 분석(수십 초) 후
 * 쓰기 직전 **최신성 재확인**에 쓴다. 그 사이 다른 녹음이 completed로 늘었으면(더 완전한 합본을
 * 든 웹훅이 존재) 이 분석의 모든 쓰기를 skip — 부분 합본이 전체 합본을 덮는 fan-in 레이스 차단
 * (적대리뷰 #1/#5). 진행 중 녹음이 남아 있으면 미러를 completed 대신 transcribing으로 남겨
 * StatusWatcher가 계속 살아 있게 한다(적대리뷰 #8).
 */
async function analyzeConsultationAndPersist(
  admin: SupabaseClient,
  consult: ConsultationContext,
  formatted: string,
  opts: { multi: boolean; analyzedIds?: string[] },
) {
  let extracted: ExtractedConsultationForm | null = null;
  const tenantSettings = await getTenantSettingsByTenantId(consult.tenant_id).catch(() => null);
  const shuttleOn = tenantSettings ? isModuleEnabled(tenantSettings.modules.disabled, "shuttle") : true;

  // 13섹션 심층분석 + 폼 필드 추출을 병렬 실행(ijw processRegistrationRecording 패턴).
  // 분석은 필수(실패 시 failed), 폼 추출은 best-effort(실패해도 분석은 살린다).
  const [analysisRes, extractRes] = await Promise.allSettled([
    // 프롬프트·모델·저장 전 후처리는 재분석과 같은 단일 소스(2026-10-19 — 같은 프롬프트 복사본이 여기 있었다, 줄 단위 동일 확인 뒤 합침).
    runConsultationAnalysis(consult, formatted, opts.multi, "anthropic", { tenantId: consult.tenant_id }),
    extractConsultationForm(formatted, {
      studentName: consult.prospect_name,
      grade: consult.prospect_grade,
      school: consult.prospect_school,
      tenantId: consult.tenant_id,
      shuttleOn,
    }),
  ]);

  // ── 최신성/동시성 재확인(녹음 행 경로만, 적대리뷰 #1/#5/#8) ──
  // 분석은 수십 초 걸린다 — 그 사이 다른 녹음이 completed로 늘었으면 그 웹훅이 더 완전한 합본을
  // 들고 있으므로 이 분석의 쓰기를 전부 skip(부분 합본이 전체 합본을 last-write-wins로 덮는 것 방지).
  // 아직 전사 중(uploaded/transcribing)인 녹음이 남았으면 미러를 completed로 닫지 않는다(#8).
  let inFlightRemains = false;
  if (opts.analyzedIds) {
    const analyzed = new Set(opts.analyzedIds);
    const { data: recsNow } = await admin
      .from("consultation_recordings")
      .select("id, processing_status")
      .eq("consultation_id", consult.id);
    const hasNewerCompleted = (recsNow ?? []).some(
      (r) => r.processing_status === "completed" && !analyzed.has(r.id),
    );
    if (hasNewerCompleted) {
      return NextResponse.json({ ok: true, skipped: "stale analysis snapshot" });
    }
    inFlightRemains = (recsNow ?? []).some(
      (r) => r.processing_status === "uploaded" || r.processing_status === "transcribing",
    );
  }

  if (analysisRes.status === "rejected") {
    const e = analysisRes.reason;
    const msg = e instanceof Error ? e.message : String(e);
    // 다른 녹음이 아직 전사 중이면 failed로 덮지 않는다 — 그 녹음의 완료가 곧 재분석하므로
    // 일시 실패를 상담 전체 실패로 오표시하지 않음(다 실패로 끝나면 그 웹훅이 failed 기록).
    if (inFlightRemains) {
      return NextResponse.json({ ok: true, skipped: "analysis failed, newer recording in flight" });
    }
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
      .eq("id", consult.id);
    return NextResponse.json({ ok: true });
  }
  const report = analysisRes.value.data;
  const modelId = analysisRes.value.model;
  if (extractRes.status === "fulfilled") {
    extracted = extractRes.value.form;
  } else {
    console.warn("[assemblyai webhook] 폼 추출 실패(분석은 유지)", extractRes.reason);
  }

  // Build / upsert consultation_ai_analysis row. The 13-section report lives in
  // print_payload.audioReport so existing diagnosis/learningPlan jsonb stays compatible.
  const diagnosisStub = {
    strengths: [],
    weaknesses: [],
    level: "—",
    summary: report.summary || report.consultationType || report.parentConcerns,
  };
  const learningPlanStub = {
    immediate: [report.followUps].filter(Boolean),
    semester: [],
    longTerm: [],
  };
  // speakerRoles는 audioReport(13섹션)와 분리 저장 — audioReport를 ConsultationReport13 타입으로 깨끗하게 유지.
  const { speakerRoles: inferredSpeakerRoles, ...reportSections } = report;
  const printPayload = {
    prospect: {
      name: report.extracted.prospectName ?? consult.prospect_name,
      grade: report.extracted.grade ?? consult.prospect_grade,
      school: report.extracted.school ?? consult.prospect_school,
      parentName: report.extracted.parentName ?? consult.parent_name,
      parentPhone: report.extracted.parentPhone ?? consult.parent_phone,
    },
    audioReport: reportSections,
    // 전사 화자→역할(상담자/학부모/학생) 매핑 — 상세 전사 패널이 화자별 역할 라벨로 렌더.
    speakerRoles: inferredSpeakerRoles ?? {},
    // 폼 자동추출 원본 스냅샷 — buildFormPatch는 "빈 칸만" 채우므로, 이미 채워진 필드의 AI 추출값은
    // 여기 보존해 상세/수정폼이 '✨ AI 제안'으로 비파괴 제시(상담 내용 등)한다. 추출 실패 시 미포함.
    ...(extracted ? { formSuggestions: extracted } : {}),
  };

  const modelVersion = `${modelId}-${kstToday()}`;

  await runWrite(
    "consultation.analysis",
    consult.id,
    admin.from("consultation_ai_analysis").upsert(
      {
        consultation_id: consult.id,
        model_version: modelVersion,
        diagnosis: diagnosisStub,
        learning_plan: learningPlanStub,
        print_payload: printPayload,
        // onConflict DO UPDATE 시 DEFAULT now()가 안 먹으므로 명시 갱신(재분석 '생성일' 정확).
        generated_at: new Date().toISOString(),
      },
      { onConflict: "consultation_id,model_version" },
    ),
  );

  // outcome 회귀 방지(적대리뷰 #4) — 등록완료(enrolled)·거절(declined)·노쇼(no_show) 등 종결 상태의
  // 상담에 녹음을 추가해도 칸반이 'AI 완료'로 되돌아가지 않는다(초기 단계일 때만 ai_done 승격).
  const { data: outcomeRow } = await admin
    .from("enrollment_consultations")
    .select("outcome")
    .eq("id", consult.id)
    .maybeSingle();
  const TERMINAL_OUTCOMES = new Set(["enrolled", "declined", "no_show"]);
  const keepOutcome = !!outcomeRow && TERMINAL_OUTCOMES.has(outcomeRow.outcome as string);

  // Auto-fill — 빈 필드만 채운다(상담사 수기 입력 절대 안 덮어씀).
  // 진행 중 녹음이 남아 있으면 completed 대신 transcribing 유지(#8 — StatusWatcher 생존).
  const patch: Record<string, unknown> = {
    processing_status: inFlightRemains ? "transcribing" : "completed",
    processing_error: null,
    ...(keepOutcome ? {} : { outcome: "ai_done" }),
  };
  // (1) 13섹션 분석의 extracted 4필드 — 기본 baseline(폼 추출 실패 시에도 동작).
  if (!consult.prospect_grade && report.extracted.grade) patch.prospect_grade = report.extracted.grade;
  if (!consult.prospect_school && report.extracted.school) patch.prospect_school = report.extracted.school;
  if (!consult.parent_name && report.extracted.parentName) patch.parent_name = report.extracted.parentName;
  if (!consult.parent_phone && report.extracted.parentPhone) patch.parent_phone = report.extracted.parentPhone;

  // (2) 전용 폼 추출(ijw 패리티) — 전체 폼의 빈 필드를 채운다. 현재 값을 읽어 빈 곳만.
  if (extracted) {
    const { data: cur } = await admin
      .from("enrollment_consultations")
      .select(
        "prospect_grade, prospect_school, parent_name, parent_phone, parent_relation, gender, birth_date, address, consultation_path, career_goal, siblings, safety_notes, shuttle_bus_request, registration_status, subject, parent_request, learning_history, follow_up_content, non_registration_reason, subject_details",
      )
      .eq("id", consult.id)
      .single();
    const current: CurrentConsultationValues = {
      prospectGrade: cur?.prospect_grade,
      prospectSchool: cur?.prospect_school,
      parentName: cur?.parent_name,
      parentPhone: cur?.parent_phone,
      parentRelation: cur?.parent_relation,
      gender: cur?.gender,
      birthDate: cur?.birth_date,
      address: cur?.address,
      consultationPath: cur?.consultation_path,
      careerGoal: cur?.career_goal,
      siblings: cur?.siblings,
      safetyNotes: cur?.safety_notes,
      shuttleBusRequest: cur?.shuttle_bus_request,
      registrationStatus: cur?.registration_status,
      subject: cur?.subject,
      parentRequest: cur?.parent_request,
      learningHistory: cur?.learning_history,
      followUpContent: cur?.follow_up_content,
      nonRegistrationReason: cur?.non_registration_reason,
      subjectDetails: cur?.subject_details,
    };
    // 후보정 하네스에 전사·학생명 전달 → 환각 고유명사·학생이름 echo 차단(약한 모델 방어).
    // 학교명 저장 별칭은 그 상담 학원의 설정 값(침산 = 일중→대구일중, 새 학원 = 없음). 조회 자체가 던지면
    // 이 작업 전과 같은 별칭(침산 목록)으로 — 웹훅을 멈출 이유가 아니고, 침산은 실패해도 종전과 같아야 한다.
    const schoolAliases = tenantSettings?.operations.schoolSaveAliases ?? CHINSAN_SCHOOL_SAVE_ALIASES;
    Object.assign(
      patch,
      buildFormPatch(extracted, current, { studentName: consult.prospect_name, transcript: formatted, schoolAliases, shuttleOn }),
    );
  }

  await runWrite(
    "consultation.completed",
    consult.id,
    admin.from("enrollment_consultations").update(patch).eq("id", consult.id),
  );

  return NextResponse.json({ ok: true });
}

// ─────────────────────── student consultation flow ───────────────────────
// 재원생 학생상담 — handleConsultation 클론. 결과 7섹션 ai_report는 행에 직접 저장(동결 테이블 불요).

async function handleStudentConsultation(
  admin: SupabaseClient,
  transcriptId: string,
  sc: {
    id: string;
    tenant_id: string | null;
    consulted_at: string | null;
    audience: string | null;
    category: string | null;
    student: unknown;
  },
) {
  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("student_consultations")
      .update({ processing_status: "failed", processing_error: localizeTranscriptionError(msg) })
      .eq("id", sc.id);
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await admin
      .from("student_consultations")
      .update({
        processing_status: "failed",
        processing_error: localizeTranscriptionError(transcript.error ?? "전사 결과가 비어있습니다"),
      })
      .eq("id", sc.id);
    return NextResponse.json({ ok: true });
  }

  const cleanedText = transcript.text.replace(/\s/g, "");
  if (cleanedText.length < 30 || (transcript.audio_duration ?? 0) < 5) {
    await admin
      .from("student_consultations")
      .update({
        processing_status: "failed",
        processing_error: "녹음이 너무 짧거나 음성이 인식되지 않았습니다",
        transcription: transcript.text,
      })
      .eq("id", sc.id);
    return NextResponse.json({ ok: true });
  }

  await runWrite(
    "studentConsultation.analyzing",
    sc.id,
    admin
      .from("student_consultations")
      .update({
        transcription: transcript.text,
        speaker_labels: transcript.utterances ?? [],
        audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
        processing_status: "analyzing",
        processing_error: null,
      })
      .eq("id", sc.id),
  );

  // B: 종료 후 잡음 꼬리를 분석 입력에서 제외(저장된 transcription/speaker_labels는 위에서 full 보존).
  const formatted = formatTrimmedTranscript(transcript.utterances, transcript.text);

  const student = (Array.isArray(sc.student) ? sc.student[0] : sc.student) as
    | { name?: string; grade?: string | null; school?: string | null }
    | undefined;

  try {
    const { report, model } = await analyzeStudentConsultation(formatted, {
      studentName: student?.name ?? "학생",
      grade: student?.grade ?? null,
      school: student?.school ?? null,
      consultedAt: sc.consulted_at,
      audience: sc.audience,
      category: sc.category,
      // tenant_id는 DB에서 NOT NULL이다 — 타입만 느슨하다. 비어 있으면 generateJSON이 거절해 아래 catch가 '실패'로 적는다.
      tenantId: sc.tenant_id ?? "",
    });
    await runWrite(
      "studentConsultation.completed",
      sc.id,
      admin
        .from("student_consultations")
        .update({
          ai_report: report,
          ai_summary: report.summary,
          ai_model_version: `${model}-${kstToday()}`,
          ai_generated_at: new Date().toISOString(),
          processing_status: "completed",
          processing_error: null,
        })
        .eq("id", sc.id),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("student_consultations")
      .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
      .eq("id", sc.id);
  }

  return NextResponse.json({ ok: true });
}
