"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attendanceRate } from "@/lib/calc/attendance";
import { generateJSON } from "@/lib/ai/generate";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant, accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { addDays, kstDateOf, kstLocalToIso, kstToday } from "@/lib/date-kst";
import { stripPastedMarkup } from "../paste-cleanup";
import { consultationSubject } from "../subject";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import {
  canConsultStudent,
  OUT_OF_SCOPE_CONSULTATION,
  OUT_OF_SCOPE_STUDENT,
  scopedConsultationUserId,
} from "./write-scope";

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
  // 역할 게이트 — 유료 AI 호출은 학생 **full** 역할만(비용통제, #S5 형제).
  // 🔴 강사(scoped) 차단(원장 지시 2026-08-18 "AI 케어 분석도 막고 — 읽기만") — 학생 상세의
  // 퇴원·수정 차단(students/server/actions.ts canManageStudentRecords)과 같은 결.
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if ((await accessLevelTenant(user.systemRole, "students")) !== "full") {
    return { error: "AI 케어 분석 권한이 없습니다 — 강사 계정은 열람 전용입니다" };
  }

  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) return { error: "학생 ID가 누락되었습니다" };

  const supabase = await createClient();

  const [{ data: student }, { data: consults }, { data: attendance }, { data: enrollments }] =
    await Promise.all([
      supabase
        .from("students")
        .select(`id, name, grade, school, status, enrolled_at`)
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
        // 날짜 컬럼이라 **KST 오늘** 기준 30일 — UTC로 세면 한국 새벽에 창이 하루 밀린다.
        .gte("session_date", addDays(kstToday(), -30)),
      supabase
        .from("enrollments")
        .select(`start_date, end_date, class:class_id ( class_name, subject )`)
        .eq("student_id", studentId)
        .is("end_date", null),
    ]);

  if (!student) return { error: "학생을 찾을 수 없습니다" };

  const consultationsBlock = (consults ?? [])
    .map((c) => {
      const co = (Array.isArray(c.counselor) ? c.counselor[0] : c.counselor) as
        | { display_name?: string }
        | undefined;
      const date = new Date(c.consulted_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
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
  const rate = total > 0 ? attendanceRate(present, total).toFixed(1) : "—";

  const enrolledClasses = (enrollments ?? [])
    .map((e) => {
      const k = (Array.isArray(e.class) ? e.class[0] : e.class) as
        | { class_name?: string; subject?: string }
        | undefined;
      return k?.class_name ?? "?";
    })
    .join(", ");

  let analysis: CareAnalysisShape;
  let modelId: string;
  try {
    const { data, model } = await generateJSON<CareAnalysisShape>({
      keyName: "consultations",
      maxTokens: 2048,
      meta: { feature: "student_care", tenantId: user.tenantId },
      prompt: [
        "재원생 한 명의 케어 종합 분석을 JSON으로만 답해주세요.",
        "",
        `학생: ${student.name} (${student.grade ?? "—"}, ${student.school ?? "—"})`,
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
    });
    analysis = data;
    modelId = model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 호출 실패: ${msg}` };
  }

  // 모델 버전 꼬리 날짜도 **KST 오늘** — UTC로 뽑으면 한국 새벽에 어제 날짜가 기록에 남는다.
  const modelVersion = `${modelId}-${kstToday()}`;

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

  // 유료 AI 호출이라 누가 돌렸는지를 남긴다(비용). 🔴 분석 **본문**(summary·recommendation)은 안 담는다 —
  // 감사로그는 요약이지 사본이 아니고, 학생 서술이 이력 표에 복제되면 안 된다.
  await logAction({
    action: "student_care_analysis",
    targetType: "student",
    targetLabel: student.name ?? null,
    // focus는 AI 산출이라 배열이 아닐 수 있다 — 문자열이면 `.length`가 **글자 수**가 돼
    // 거짓 건수가 된다. 배열일 때만 세고 아니면 null(모르는 값을 지어내지 않는다).
    metadata: {
      studentId,
      model: modelId,
      focus: Array.isArray(analysis.focus) ? analysis.focus.length : null,
    },
  });

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/consultations");
  return undefined;
}

// ───────── 학생상담 CRUD ─────────
export type ConsultationFormState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: true; redirectTo?: string; nonce?: number }
  | undefined;

const CATEGORIES = ["general", "academic", "emotional", "career", "social", "other"] as const;
const AUDIENCES = ["parent", "student", "both"] as const;

function readConsultationForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v).trim();
  };
  const category = get("category");
  const audience = get("audience");
  return {
    studentId: get("studentId"),
    counselorId: get("counselorId") || null,
    consultedAt: get("consultedAt"),
    category: CATEGORIES.includes(category as (typeof CATEGORIES)[number]) ? category : null,
    subject: get("subject") || null,
    audience: AUDIENCES.includes(audience as (typeof AUDIENCES)[number]) ? audience : null,
    summary: get("summary"),
    followUpAction: get("followUpAction") || null,
    followUpDate: get("followUpDate") || null,
    followUpDone: get("followUpDone") === "true",
  };
}

function validateConsultation(input: ReturnType<typeof readConsultationForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.studentId) errors.studentId = "학생을 선택해주세요";
  if (!input.summary || input.summary.length < 5) errors.summary = "요약을 5자 이상 작성해주세요";
  if (!input.consultedAt) errors.consultedAt = "상담 일시를 입력해주세요";
  return Object.keys(errors).length > 0 ? errors : null;
}

async function subjectForConsultation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  counselorId: string,
  entered: string | null,
): Promise<{ subject: string | null; error?: string }> {
  const { data: counselor, error } = await supabase
    .from("users")
    .select("subjects")
    .eq("id", counselorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !counselor) return { subject: null, error: "상담사를 확인할 수 없습니다." };
  if (entered) return { subject: entered };
  const settings = await getTenantSettings();
  return {
    subject: consultationSubject(null, counselor.subjects, subjectLabelRecord(settings.operations.subjects)),
  };
}

export async function createStudentConsultation(
  _prev: ConsultationFormState,
  formData: FormData,
): Promise<ConsultationFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "consultations"))) return { error: "상담 관리 권한이 없습니다" };

  const input = readConsultationForm(formData);
  const fieldErrors = validateConsultation(input);
  if (fieldErrors) return { fieldErrors };

  // 담당 범위(감사 S3) — 강사는 본인 이름으로, 담당 학생에게만 기록한다(화면 드롭다운과 같은 범위).
  const scopedId = await scopedConsultationUserId(user);
  if (scopedId) {
    if (input.counselorId && input.counselorId !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    if (!(await canConsultStudent(input.studentId))) return { error: OUT_OF_SCOPE_STUDENT };
  }

  const supabase = await createClient();
  const counselorId = input.counselorId ?? user.id;
  const resolved = await subjectForConsultation(supabase, user.tenantId, counselorId, input.subject);
  if (resolved.error) return { error: resolved.error };
  const { data, error } = await supabase
    .from("student_consultations")
    .insert({
      tenant_id: user.tenantId,
      student_id: input.studentId,
      counselor_id: counselorId,
      // 🔴 `new Date(값)`으로 읽지 말 것 — 폼이 보내는 건 **타임존 없는 KST 벽시계**라 서버(UTC)가
      //    그대로 읽으면 9시간 뒤로 앉는다(원장 제보 2026-09-09, date-kst `kstLocalToIso` 주석).
      consulted_at: kstLocalToIso(input.consultedAt) ?? new Date().toISOString(),
      category: input.category,
      subject: resolved.subject,
      audience: input.audience,
      // 붙여넣기로 딸려 온 화면 코드 조각을 걷어낸다(원장 2026-09-09 *"그 조각만 걷어내. 앞으로 가져올때도 조심"*).
      summary: stripPastedMarkup(input.summary),
      follow_up_action: input.followUpAction,
      follow_up_date: input.followUpDate,
      follow_up_done: input.followUpDone,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "상담 저장 실패" };

  // 🔴 요약·후속조치 **본문은 담지 않는다**(상담 내용 금지) — 분류·대상·후속조치 유무까지만.
  // 대상 열의 학생 이름은 metadata.studentId를 뷰어가 일괄 해석한다(auditTargetName).
  await logAction({
    action: "student_consultation_create",
    targetType: "student_consultation",
    metadata: {
      consultationId: data.id as string,
      studentId: input.studentId,
      // 저장되는 값과 같은 식으로 KST 날짜를 뽑는다 — 감사로그가 상담 목록 화면과 같은 날을 말해야 한다.
      consultedAt: kstDateOf(input.consultedAt),
      category: input.category,
      audience: input.audience,
      hasFollowUp: !!input.followUpAction,
      followUpDate: input.followUpDate,
    },
  });

  revalidatePath("/consultations");
  revalidatePath(`/students/${input.studentId}`);
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·이동(B-2).
  // (제출 시점 무조건 clear는 서버 검증 실패 시 입력 유실 위험 → 성공 확정 기반으로 전환.)
  return { ok: true, redirectTo: "/consultations", nonce: Date.now() };
}

export async function updateStudentConsultation(
  _prev: ConsultationFormState,
  formData: FormData,
): Promise<ConsultationFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "consultations"))) return { error: "상담 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const input = readConsultationForm(formData);
  const fieldErrors = validateConsultation(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();
  // 담당 범위(감사 S3) — 강사는 **본인이 쓴 상담**만, 학생을 바꿀 땐 담당 학생으로만.
  const scopedId = await scopedConsultationUserId(user);
  if (scopedId) {
    const { data: current, error: curErr } = await supabase
      .from("student_consultations")
      .select("student_id, counselor_id")
      .eq("id", id)
      .maybeSingle();
    if (curErr) return { error: "상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    if (!current) return { error: "상담을 찾을 수 없습니다" };
    if (current.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    if (input.counselorId && input.counselorId !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    if (current.student_id !== input.studentId && !(await canConsultStudent(input.studentId))) {
      return { error: OUT_OF_SCOPE_STUDENT };
    }
  }
  const counselorId = input.counselorId ?? user.id;
  const resolved = await subjectForConsultation(supabase, user.tenantId, counselorId, input.subject);
  if (resolved.error) return { error: resolved.error };
  const { error } = await supabase
    .from("student_consultations")
    .update({
      student_id: input.studentId,
      counselor_id: counselorId,
      // 🔴 `new Date(값)`으로 읽지 말 것 — 폼이 보내는 건 **타임존 없는 KST 벽시계**라 서버(UTC)가
      //    그대로 읽으면 9시간 뒤로 앉는다(원장 제보 2026-09-09, date-kst `kstLocalToIso` 주석).
      consulted_at: kstLocalToIso(input.consultedAt) ?? new Date().toISOString(),
      category: input.category,
      subject: resolved.subject,
      audience: input.audience,
      // 붙여넣기로 딸려 온 화면 코드 조각을 걷어낸다(원장 2026-09-09 *"그 조각만 걷어내. 앞으로 가져올때도 조심"*).
      summary: stripPastedMarkup(input.summary),
      follow_up_action: input.followUpAction,
      follow_up_date: input.followUpDate,
      follow_up_done: input.followUpDone,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  await logAction({
    action: "student_consultation_update",
    targetType: "student_consultation",
    metadata: {
      consultationId: id,
      studentId: input.studentId,
      consultedAt: kstDateOf(input.consultedAt),
      category: input.category,
      audience: input.audience,
      hasFollowUp: !!input.followUpAction,
      followUpDate: input.followUpDate,
    },
  });

  revalidatePath("/consultations");
  revalidatePath(`/students/${input.studentId}`);
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·이동(B-2).
  return { ok: true, redirectTo: "/consultations", nonce: Date.now() };
}

export type ToggleFollowUpState = { error?: string } | undefined;

export async function toggleConsultationFollowUp(
  _prev: ToggleFollowUpState,
  formData: FormData,
): Promise<ToggleFollowUpState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const cLvl = await accessLevelTenant(user.systemRole, "consultations");
  if (cLvl !== "full" && cLvl !== "scoped") return { error: "상담 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const done = String(formData.get("done") ?? "false") === "true";
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 담당 범위(감사 S3) — 강사는 본인이 쓴 상담의 후속조치만 체크한다(목록과 같은 기준).
  const scopedId = await scopedConsultationUserId(user);
  // .select()로 학생 id를 함께 받는다 — 감사로그 '대상' 칸에 학생 이름이 뜨게(왕복 증가 0).
  let upd = supabase.from("student_consultations").update({ follow_up_done: done }).eq("id", id);
  if (scopedId) upd = upd.eq("counselor_id", scopedId);
  const { data: row, error } = await upd.select("student_id").maybeSingle();
  if (error) return { error: error.message };
  // 강사 범위에서 0행 = 남의 상담(또는 없는 상담) — 조용히 성공으로 보이지 않게 알린다.
  if (scopedId && !row) return { error: OUT_OF_SCOPE_CONSULTATION };

  await logAction({
    action: "student_consultation_follow_up",
    targetType: "student_consultation",
    metadata: { consultationId: id, studentId: (row?.student_id as string | null) ?? null, done },
  });

  revalidatePath("/consultations");
  return undefined;
}

export type DeleteConsultationState = { error?: string } | undefined;

export async function deleteStudentConsultation(
  _prev: DeleteConsultationState,
  formData: FormData,
): Promise<DeleteConsultationState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "consultations"))) return { error: "상담 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  if (!id) return { error: "상담 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 지우면 되찾을 수 없는 맥락(누구의·언제·어떤 분류 상담이었나)을 삭제 **전**에 읽어 둔다.
  // 🔴 요약 본문은 읽지도 담지도 않는다(상담 내용 금지).
  const { data: before, error: beforeErr } = await supabase
    .from("student_consultations")
    .select("student_id, counselor_id, consulted_at, category, audience, follow_up_action, follow_up_done")
    .eq("id", id)
    .maybeSingle();
  // 담당 범위(감사 S3) — 강사는 본인이 쓴 상담만 지운다. 확인을 못 하면 지우지 않는다.
  const scopedId = await scopedConsultationUserId(user);
  let del = supabase.from("student_consultations").delete().eq("id", id);
  if (scopedId) {
    if (beforeErr) return { error: "상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    if (!before || before.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    del = del.eq("counselor_id", scopedId);
  }
  const { error } = await del;
  if (error) return { error: error.message };

  await logAction({
    action: "student_consultation_delete",
    targetType: "student_consultation",
    metadata: {
      consultationId: id,
      // ⚠️ formData의 studentId는 없으면 **빈 문자열**이다 — `?? `로는 안 걸러진다(`|| null`).
      studentId: (before?.student_id as string | null) ?? (studentId || null),
      consultedAt: kstDateOf(before?.consulted_at),
      category: (before?.category as string | null) ?? null,
      audience: (before?.audience as string | null) ?? null,
      hasFollowUp: !!before?.follow_up_action,
    },
  });

  revalidatePath("/consultations");
  if (studentId) revalidatePath(`/students/${studentId}`);
  if (redirectTo) redirect(redirectTo);
  return undefined;
}
