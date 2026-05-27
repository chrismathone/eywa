"use server";

import { revalidatePath } from "next/cache";
import { CLAUDE_MODELS, getAnthropic } from "@/lib/ai/anthropic";
import { createClient } from "@/lib/supabase/server";

type CareFocus = {
  priority: "high" | "medium" | "low";
  area: string;
  recommendation: string;
};

type CareAnalysisShape = {
  summary: string;
  focus: CareFocus[];
};

export type StudentCareState = { error?: string } | undefined;

export async function runStudentCareAnalysis(
  _prev: StudentCareState,
  formData: FormData,
): Promise<StudentCareState> {
  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();

  const [{ data: student }, { data: consults }, { data: attendance }, { data: enrollments }] =
    await Promise.all([
      supabase
        .from("students")
        .select(
          `id, name, grade, school, status, enrolled_at,
           teacher:primary_teacher_id ( display_name )`,
        )
        .eq("id", studentId)
        .single(),
      supabase
        .from("student_consultations")
        .select(
          `consulted_at, summary, follow_up_action,
           counselor:counselor_id ( display_name )`,
        )
        .eq("student_id", studentId)
        .order("consulted_at", { ascending: false })
        .limit(10),
      supabase
        .from("attendance_records")
        .select("status")
        .eq("student_id", studentId)
        .gte("session_date", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)),
      supabase
        .from("enrollments")
        .select(`start_date, end_date, class:class_id ( class_name, subject )`)
        .eq("student_id", studentId)
        .is("end_date", null),
    ]);

  if (!student) return { error: "학생을 찾을 수 없습니다" };

  const teacher = (Array.isArray(student.teacher) ? student.teacher[0] : student.teacher) as
    | { display_name?: string }
    | undefined;

  const consultationsBlock = (consults ?? [])
    .map((c) => {
      const co = (Array.isArray(c.counselor) ? c.counselor[0] : c.counselor) as
        | { display_name?: string }
        | undefined;
      const date = new Date(c.consulted_at).toLocaleDateString("ko-KR");
      return [
        `[${date} · ${co?.display_name ?? "?"}]`,
        `요약: ${c.summary}`,
        c.follow_up_action ? `Follow-up: ${c.follow_up_action}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const attRows = attendance ?? [];
  const total = attRows.length;
  const present = attRows.filter((r) => r.status === "present").length;
  const absent = attRows.filter((r) => r.status === "absent").length;
  const late = attRows.filter((r) => r.status === "late").length;
  const rate = total > 0 ? ((present / total) * 100).toFixed(1) : "—";

  const enrolledClasses = (enrollments ?? [])
    .map((e) => {
      const k = (Array.isArray(e.class) ? e.class[0] : e.class) as
        | { class_name?: string; subject?: string }
        | undefined;
      return k?.class_name ?? "?";
    })
    .join(", ");

  let analysis: CareAnalysisShape;
  try {
    const client = getAnthropic("consultations");
    const response = await client.messages.create({
      model: CLAUDE_MODELS.balanced,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            "재원생 한 명의 케어 종합 분석을 JSON으로만 답해주세요.",
            "",
            `학생: ${student.name} (${student.grade ?? "—"}, ${student.school ?? "—"})`,
            `담임: ${teacher?.display_name ?? "—"}`,
            `등록일: ${student.enrolled_at ?? "—"}`,
            `수강 중인 반: ${enrolledClasses || "없음"}`,
            "",
            "최근 30일 출결:",
            `  전체 ${total}건 · 출석 ${present} · 결석 ${absent} · 지각 ${late} · 출석률 ${rate}%`,
            "",
            "최근 상담 기록 (최대 10건):",
            consultationsBlock || "  없음",
            "",
            "JSON schema:",
            "{",
            '  "summary": string (한국어 3-4문장 — 학생 현재 상태 + 주요 케어 포인트),',
            '  "focus": [{ "priority": "high" | "medium" | "low", "area": string (영역, 예: 학습/태도/출결), "recommendation": string (구체적 액션) }]',
            "}",
            "",
            "focus는 2~4개. 이미 잘하고 있는 영역은 제외, 개선이 필요하거나 주의가 필요한 영역만.",
            "추측이 아닌 위 데이터에 근거한 분석을 할 것.",
            "JSON만 출력, 마크다운 코드 블록 없이.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    analysis = JSON.parse(cleaned) as CareAnalysisShape;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 호출 실패: ${msg}` };
  }

  const modelVersion = `${CLAUDE_MODELS.balanced}-${new Date().toISOString().slice(0, 10)}`;

  const { error } = await supabase
    .from("students")
    .update({
      ai_care_summary: analysis.summary,
      ai_care_focus: analysis.focus,
      ai_care_model_version: modelVersion,
      ai_care_generated_at: new Date().toISOString(),
    })
    .eq("id", studentId);

  if (error) return { error: error.message };

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/consultations");
  return undefined;
}
