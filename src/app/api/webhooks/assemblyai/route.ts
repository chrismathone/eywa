import { NextResponse } from "next/server";
import { CLAUDE_MODELS, getAnthropic } from "@/lib/ai/anthropic";
import { getTranscript, type SpeakerUtterance } from "@/lib/ai/assemblyai";
import { createAdminClient } from "@/lib/supabase/admin";

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

type WebhookBody = {
  transcript_id?: string;
  status?: "completed" | "error";
};

export async function POST(req: Request) {
  const expected = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  if (expected && req.headers.get("x-eywa-webhook-secret") !== expected) {
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
  const { data: meeting } = await admin
    .from("meeting_minutes")
    .select("id, tenant_id, title, attendees, held_at")
    .eq("assemblyai_transcript_id", transcriptId)
    .single();

  if (!meeting) {
    // Unknown transcript — log and 200 so AssemblyAI doesn't keep retrying.
    console.warn("[assemblyai webhook] no meeting for transcript", transcriptId);
    return NextResponse.json({ ok: true, skipped: "no meeting" });
  }

  // 1) Pull final transcript
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

  // Validate transcript quality
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

  // 2) Save transcription + move to analyzing
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

  // 3) Claude analysis
  const formatted = (transcript.utterances ?? []).length > 0
    ? (transcript.utterances as SpeakerUtterance[])
        .map((s) => `[화자 ${s.speaker}] ${s.text}`)
        .join("\n")
    : transcript.text;

  const attendees = Array.isArray(meeting.attendees) ? (meeting.attendees as string[]) : [];
  const heldAt = new Date(meeting.held_at).toLocaleDateString("ko-KR");

  let report: MeetingReportSection;
  let speakerRoles: Record<string, string> = {};

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.balanced,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
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
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as
      MeetingReportSection & { speakerRoles?: Record<string, string> };

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

  // 4) Save report + finalize
  await admin
    .from("meeting_minutes")
    .update({
      ai_report: report,
      ai_speaker_roles: speakerRoles,
      ai_summary: report.summary,
      ai_model_version: CLAUDE_MODELS.balanced,
      ai_generated_at: new Date().toISOString(),
      processing_status: "completed",
      processing_error: null,
    })
    .eq("id", meeting.id);

  return NextResponse.json({ ok: true });
}
