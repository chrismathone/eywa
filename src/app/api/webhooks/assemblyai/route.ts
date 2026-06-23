import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { generateJSON } from "@/lib/ai/generate";
import { getTranscript, type SpeakerUtterance } from "@/lib/ai/assemblyai";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeStudentConsultation } from "@/features/consultations/server/ai";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 상수시간 문자열 비교 — 타이밍 공격 방지. 길이 다르면 즉시 false. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// AssemblyAI may pause up to a few minutes between calls; give Claude plenty of room too.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type MeetingReportSection = {
  meetingType: string;
  summary: string;
  agendaDiscussion: string;
  decisions: string;
  actionItems: string;
  speakerSummary: string;
  concerns: string;
  nextSteps: string;
};

// ijw-calander의 13섹션 등록상담 분석 스키마
type ConsultationReport13 = {
  consultationType: string; // 상담 성격
  familyBackground: string; // 가정 배경
  parentConcerns: string; // 학부모 걱정
  parentQuestions: string; // 학부모 질문
  parentRequests: string; // 학부모 요청
  parentSatisfaction: string; // 학부모 만족도
  studentTraits: string; // 학생 특이사항
  teacherResponse: string; // 교사 대응
  salesPoints: string; // 세일즈 포인트
  agreements: string; // 합의 사항
  followUps: string; // 후속 조치
  warnings: string; // 주의 신호
  extracted: {
    prospectName: string | null;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
};

type WebhookBody = {
  transcript_id?: string;
  status?: "completed" | "error";
};

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
  const { data: meeting } = await admin
    .from("meeting_minutes")
    .select("id, tenant_id, title, attendees, held_at, processing_status")
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (meeting) {
    // 멱등성 — 이미 완료된 건의 재전송이면 재분석(유료 AI) 중복을 막고 skip(#S3 replay).
    if (meeting.processing_status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    return handleMeeting(admin, transcriptId, meeting);
  }

  const { data: consult } = await admin
    .from("enrollment_consultations")
    .select(
      "id, tenant_id, prospect_name, prospect_grade, prospect_school, parent_name, parent_phone, processing_status",
    )
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (consult) {
    if (consult.processing_status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    return handleConsultation(admin, transcriptId, consult);
  }

  // 재원생 학생상담(student_consultations) — 학생 컨텍스트는 student_id 조인.
  const { data: sc } = await admin
    .from("student_consultations")
    .select(
      "id, processing_status, consulted_at, audience, category, student:student_id ( name, grade, school )",
    )
    .eq("assemblyai_transcript_id", transcriptId)
    .maybeSingle();

  if (sc) {
    if (sc.processing_status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already completed" });
    }
    return handleStudentConsultation(admin, transcriptId, sc);
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
  },
) {
  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("meeting_minutes")
      .update({ processing_status: "failed", processing_error: `전사 fetch 실패: ${msg}` })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await admin
      .from("meeting_minutes")
      .update({
        processing_status: "failed",
        processing_error: transcript.error ?? "전사 결과가 비어있습니다",
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

  await admin
    .from("meeting_minutes")
    .update({
      transcription: transcript.text,
      speaker_labels: transcript.utterances ?? [],
      audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
      processing_status: "analyzing",
      processing_error: null,
    })
    .eq("id", meeting.id);

  const formatted = (transcript.utterances ?? []).length > 0
    ? (transcript.utterances as SpeakerUtterance[])
        .map((s) => `[화자 ${s.speaker}] ${s.text}`)
        .join("\n")
    : transcript.text;

  const attendees = Array.isArray(meeting.attendees) ? (meeting.attendees as string[]) : [];
  const heldAt = new Date(meeting.held_at).toLocaleDateString("ko-KR");

  let report: MeetingReportSection;
  let speakerRoles: Record<string, string> = {};
  let modelVersion = "";

  try {
    const { data: parsed, model } = await generateJSON<
      MeetingReportSection & { speakerRoles?: Record<string, string> }
    >({
      maxTokens: 8192,
      prompt: [
        "다음은 학원 회의 녹음 전사입니다. 회의록 형태로 분석해 JSON으로만 답해주세요.",
        "",
        `제목: ${meeting.title}`,
        `일시: ${heldAt}`,
        `참석자: ${attendees.length > 0 ? attendees.join(", ") : "미상"}`,
        "",
        "분석 시 반드시 주의할 점:",
        "1. 회의의 유형을 정확히 파악하세요 (예: 정기 운영회의, 강사 회의, 학부모 간담회).",
        "2. 안건별로 논의 내용을 분리하세요.",
        "3. 결정 사항은 '누가 제안했고, 반대 의견은, 최종 결정' 형식으로 정리.",
        "4. 액션 아이템은 담당자와 기한을 가능한 명시.",
        "5. 참석자별 발언을 중립적으로 기록하세요.",
        "6. 미해결 이슈, 갈등, 위험 요소를 별도로 기록하세요.",
        "7. 향후 계획을 반드시 포함하세요.",
        "",
        "녹음 전사 (화자 라벨 포함):",
        formatted,
        "",
        "JSON schema (모든 필드 한국어, 줄바꿈은 \\n):",
        "{",
        '  "speakerRoles": { "A": "역할/이름", "B": "역할/이름" },',
        '  "meetingType": string,',
        '  "summary": string (2-4문장),',
        '  "agendaDiscussion": string,',
        '  "decisions": string,',
        '  "actionItems": string,',
        '  "speakerSummary": string,',
        '  "concerns": string,',
        '  "nextSteps": string',
        "}",
        "",
        "JSON만 출력. 마크다운 코드 블록 없이.",
      ].join("\n"),
    });

    modelVersion = model;
    speakerRoles = parsed.speakerRoles ?? {};
    report = {
      meetingType: parsed.meetingType ?? "",
      summary: parsed.summary ?? "",
      agendaDiscussion: parsed.agendaDiscussion ?? "",
      decisions: parsed.decisions ?? "",
      actionItems: parsed.actionItems ?? "",
      speakerSummary: parsed.speakerSummary ?? "",
      concerns: parsed.concerns ?? "",
      nextSteps: parsed.nextSteps ?? "",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("meeting_minutes")
      .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
      .eq("id", meeting.id);
    return NextResponse.json({ ok: true });
  }

  await admin
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
    .eq("id", meeting.id);

  return NextResponse.json({ ok: true });
}

// ─────────────────────────── consultation flow ───────────────────────────

async function handleConsultation(
  admin: SupabaseClient,
  transcriptId: string,
  consult: {
    id: string;
    tenant_id: string;
    prospect_name: string;
    prospect_grade: string | null;
    prospect_school: string | null;
    parent_name: string | null;
    parent_phone: string | null;
  },
) {
  let transcript;
  try {
    transcript = await getTranscript(transcriptId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: `전사 fetch 실패: ${msg}` })
      .eq("id", consult.id);
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await admin
      .from("enrollment_consultations")
      .update({
        processing_status: "failed",
        processing_error: transcript.error ?? "전사 결과가 비어있습니다",
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

  await admin
    .from("enrollment_consultations")
    .update({
      transcription: transcript.text,
      speaker_labels: transcript.utterances ?? [],
      audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
      processing_status: "analyzing",
      processing_error: null,
    })
    .eq("id", consult.id);

  const formatted = (transcript.utterances ?? []).length > 0
    ? (transcript.utterances as SpeakerUtterance[])
        .map((s) => `[화자 ${s.speaker}] ${s.text}`)
        .join("\n")
    : transcript.text;

  let report: ConsultationReport13;
  let modelId = "stub";

  try {
    const { data, model } = await generateJSON<ConsultationReport13>({
      maxTokens: 8192,
      prompt: [
        "다음은 학원 신입생 등록상담 녹음 전사입니다. 13개 섹션의 상담 분석 + 추출 정보를 JSON으로만 답해주세요.",
        "",
            `학생 이름(현재 입력값): ${consult.prospect_name}`,
            `학년: ${consult.prospect_grade ?? "미상"}`,
            `학교: ${consult.prospect_school ?? "미상"}`,
            `학부모(현재 입력값): ${consult.parent_name ?? "미상"} / ${consult.parent_phone ?? "미상"}`,
            "",
            "분석 가이드:",
            "1. consultationType: 상담 성격 (예: 초기 탐색, 입학 결심, 환불/이탈 우려 등)",
            "2. familyBackground: 가정 배경 (형제자매, 경제 상황 등 발화에 나온 것만)",
            "3. parentConcerns: 학부모가 표현한 걱정·고민",
            "4. parentQuestions: 학부모가 던진 질문 목록",
            "5. parentRequests: 학부모가 요청한 사항",
            "6. parentSatisfaction: 상담 중 만족/불만족 신호",
            "7. studentTraits: 학생 특이사항 (성격, 학습 스타일)",
            "8. teacherResponse: 교사/상담사의 대응 방식 평가",
            "9. salesPoints: 학원이 어필한 장점",
            "10. agreements: 양측 합의 사항",
            "11. followUps: 향후 후속 조치 (연락/방문/시범수업 등)",
            "12. warnings: 등록 실패 가능성·주의 신호",
            "13. extracted: 전사에서 자동 추출한 핵심 정보 (학생 이름/학년/학교/학부모/연락처). 발화에 명시되지 않으면 null.",
            "",
            "녹음 전사 (화자 라벨 포함):",
            formatted,
            "",
            "JSON schema (모든 필드 한국어, 줄바꿈은 \\n):",
            "{",
            '  "consultationType": string,',
            '  "familyBackground": string,',
            '  "parentConcerns": string,',
            '  "parentQuestions": string,',
            '  "parentRequests": string,',
            '  "parentSatisfaction": string,',
            '  "studentTraits": string,',
            '  "teacherResponse": string,',
            '  "salesPoints": string,',
            '  "agreements": string,',
            '  "followUps": string,',
            '  "warnings": string,',
            '  "extracted": {',
            '    "prospectName": string | null,',
            '    "grade": string | null,',
            '    "school": string | null,',
            '    "parentName": string | null,',
            '    "parentPhone": string | null',
            "  }",
            "}",
            "",
            "추측 금지. 전사에 안 나온 정보는 빈 문자열 또는 null.",
            "JSON만 출력. 마크다운 코드 블록 없이.",
      ].join("\n"),
    });
    report = data;
    modelId = model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("enrollment_consultations")
      .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
      .eq("id", consult.id);
    return NextResponse.json({ ok: true });
  }

  // Build / upsert consultation_ai_analysis row. The 13-section report lives in
  // print_payload.audioReport so existing diagnosis/learningPlan jsonb stays compatible.
  const diagnosisStub = {
    strengths: [],
    weaknesses: [],
    level: "—",
    summary: report.consultationType + "\n" + report.parentConcerns,
  };
  const learningPlanStub = {
    immediate: [report.followUps].filter(Boolean),
    semester: [],
    longTerm: [],
  };
  const printPayload = {
    prospect: {
      name: report.extracted.prospectName ?? consult.prospect_name,
      grade: report.extracted.grade ?? consult.prospect_grade,
      school: report.extracted.school ?? consult.prospect_school,
      parentName: report.extracted.parentName ?? consult.parent_name,
      parentPhone: report.extracted.parentPhone ?? consult.parent_phone,
    },
    audioReport: report,
  };

  const modelVersion = `${modelId}-${new Date().toISOString().slice(0, 10)}`;

  await admin.from("consultation_ai_analysis").upsert(
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
  );

  // Auto-fill prospect fields if Claude extracted them (and current values are placeholder-empty).
  const patch: Record<string, unknown> = {
    processing_status: "completed",
    processing_error: null,
    outcome: "ai_done",
  };
  if (!consult.prospect_grade && report.extracted.grade) patch.prospect_grade = report.extracted.grade;
  if (!consult.prospect_school && report.extracted.school) patch.prospect_school = report.extracted.school;
  if (!consult.parent_name && report.extracted.parentName) patch.parent_name = report.extracted.parentName;
  if (!consult.parent_phone && report.extracted.parentPhone) patch.parent_phone = report.extracted.parentPhone;

  await admin.from("enrollment_consultations").update(patch).eq("id", consult.id);

  return NextResponse.json({ ok: true });
}

// ─────────────────────── student consultation flow ───────────────────────
// 재원생 학생상담 — handleConsultation 클론. 결과 7섹션 ai_report는 행에 직접 저장(동결 테이블 불요).

async function handleStudentConsultation(
  admin: SupabaseClient,
  transcriptId: string,
  sc: {
    id: string;
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
      .update({ processing_status: "failed", processing_error: `전사 fetch 실패: ${msg}` })
      .eq("id", sc.id);
    return NextResponse.json({ ok: true });
  }

  if (transcript.status === "error" || !transcript.text) {
    await admin
      .from("student_consultations")
      .update({
        processing_status: "failed",
        processing_error: transcript.error ?? "전사 결과가 비어있습니다",
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

  await admin
    .from("student_consultations")
    .update({
      transcription: transcript.text,
      speaker_labels: transcript.utterances ?? [],
      audio_duration_sec: Math.round(transcript.audio_duration ?? 0),
      processing_status: "analyzing",
      processing_error: null,
    })
    .eq("id", sc.id);

  const formatted = (transcript.utterances ?? []).length > 0
    ? (transcript.utterances as SpeakerUtterance[]).map((s) => `[화자 ${s.speaker}] ${s.text}`).join("\n")
    : transcript.text;

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
    });
    await admin
      .from("student_consultations")
      .update({
        ai_report: report,
        ai_summary: report.summary,
        ai_model_version: `${model}-${new Date().toISOString().slice(0, 10)}`,
        ai_generated_at: new Date().toISOString(),
        processing_status: "completed",
        processing_error: null,
      })
      .eq("id", sc.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("student_consultations")
      .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
      .eq("id", sc.id);
  }

  return NextResponse.json({ ok: true });
}
