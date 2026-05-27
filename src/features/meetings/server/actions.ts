"use server";

import { revalidatePath } from "next/cache";
import { CLAUDE_MODELS, getAnthropic } from "@/lib/ai/anthropic";
import { createClient } from "@/lib/supabase/server";

type ActionItem = {
  action: string;
  assignee?: string;
  due?: string;
};

type AnalysisShape = {
  summary: string;
  actionItems: ActionItem[];
};

export type MeetingAiState = { error?: string } | undefined;

export async function runMeetingAiAnalysis(
  _prev: MeetingAiState,
  formData: FormData,
): Promise<MeetingAiState> {
  const meetingId = String(formData.get("meetingId") ?? "");
  if (!meetingId) return { error: "회의록 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("meeting_minutes")
    .select("id, title, content, attendees, held_at")
    .eq("id", meetingId)
    .single();

  if (!m) return { error: "회의록을 찾을 수 없습니다" };

  const attendees = Array.isArray(m.attendees) ? (m.attendees as string[]).join(", ") : "미상";
  const heldAt = new Date(m.held_at).toLocaleDateString("ko-KR");

  let analysis: AnalysisShape;
  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.balanced,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            "다음 학원 회의록을 분석해 JSON으로만 답해주세요.",
            "",
            `제목: ${m.title}`,
            `일시: ${heldAt}`,
            `참석자: ${attendees}`,
            "",
            "본문:",
            m.content,
            "",
            "JSON schema:",
            "{",
            '  "summary": string (2-3문장의 한국어 TLDR),',
            '  "actionItems": [{ "action": string, "assignee"?: string, "due"?: string }]',
            "}",
            "",
            "actionItems의 due는 명시되어 있으면 YYYY-MM-DD 또는 자유 텍스트, 명시 안 됐으면 생략.",
            "assignee는 회의록에 명시된 담당자(예: 박지훈 강사 → 박지훈)만. 추측하지 말 것.",
            "",
            "JSON만 출력. 마크다운 코드 블록 없이.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    analysis = JSON.parse(cleaned) as AnalysisShape;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 호출 실패: ${msg}` };
  }

  const modelVersion = `${CLAUDE_MODELS.balanced}-${new Date().toISOString().slice(0, 10)}`;

  const { error } = await supabase
    .from("meeting_minutes")
    .update({
      ai_summary: analysis.summary,
      ai_action_items: analysis.actionItems,
      ai_model_version: modelVersion,
      ai_generated_at: new Date().toISOString(),
    })
    .eq("id", meetingId);

  if (error) return { error: error.message };

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/meetings");
  return undefined;
}
