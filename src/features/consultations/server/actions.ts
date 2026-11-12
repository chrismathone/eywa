"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { refreshFlowInsight } from "@/features/explore/server/flow-insights";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { generateJSON } from "@/lib/ai/generate";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant, accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { addDays, kstDateOf, kstLocalToIso, kstToday } from "@/lib/date-kst";
import { stripPastedMarkup } from "../paste-cleanup";
import { consultationSubject } from "../subject";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isFeatureLicensed } from "@/lib/license/server";
import { subjectLabelRecord } from "@/features/owner/subjects";
import {
  canConsultStudent,
  OUT_OF_SCOPE_CONSULTATION,
  OUT_OF_SCOPE_STUDENT,
  scopedConsultationUserId,
} from "./write-scope";
import { preserveConsultationLink, visibleConsultationSummary } from "../internal-link";
import { decideClassForSave, type ClassDecision } from "./class-save";
import { classSchemaWorthTrying, isMissingClassSchema, noteClassSchema } from "./class-support";
import { decodeLinkPick } from "@/features/newcomers/consult-link";
import {
  applyConsultationNewcomerLinks,
  prepareConsultationUnlink,
} from "@/features/newcomers/server/consult-link";

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
  const user = await getCurrentUser({ teacherView: true });
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
        .select("id, student_id, class_id, session_date, slot_start, recorded_at, status")
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
        `요약: ${visibleConsultationSummary(c.summary)}`,
        c.follow_up_action ? `Follow-up: ${c.follow_up_action}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  // 🔴 정정 줄은 최신 하나만 — 고친 결석을 여전히 결석으로 AI에 넘기던 것(점검 2026-09-28).
  const attRows = effectiveAttendanceRecords(attendance ?? []);
  const total = attRows.length;
  const present = attRows.filter((r) => r.status === "present").length;
  const absent = attRows.filter((r) => r.status === "absent").length;
  const late = attRows.filter((r) => r.status === "late").length;
  const rate = total > 0 ? attendanceRate(attendedCount({ present, late }), total).toFixed(1) : "—";

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

  if (error) return { error: explainDbError(error, { scope: "consultations.careAnalysis.save", fallback: "분석 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

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
  const classPick = get("classPick");
  return {
    // 반(0318a) — 폼이 '반' 칸을 그렸을 때만 온다. auto = 서버가 판정 · manual = 사람이 고름(빈 값 = 미매핑) · 없음 = 칸이 없었다.
    classPick: classPick === "auto" || classPick === "manual" ? classPick : null,
    classId: get("classId") || null,
    studentId: get("studentId"),
    counselorId: get("counselorId") || null,
    consultedAt: get("consultedAt"),
    category: CATEGORIES.includes(category as (typeof CATEGORIES)[number]) ? category : null,
    subject: get("subject") || null,
    audience: AUDIENCES.includes(audience as (typeof AUDIENCES)[number]) ? audience : null,
    summary: visibleConsultationSummary(get("summary")),
    followUpAction: get("followUpAction") || null,
    followUpDate: get("followUpDate") || null,
    followUpDone: get("followUpDone") === "true",
  };
}

/**
 * 신규생 관리 칸(0295a 반자동) — 폼이 **그린 과목 줄마다** `newcomerLinkRow`(과목 키, 과목 무관 = 빈 값)가 온다.
 * 안 그린 줄의 연결은 건드리지 않는다(신규생이 아닌 학생·그만둔 과목의 옛 연결이 풀리면 안 된다).
 */
function readNewcomerLinks(formData: FormData) {
  const picks = formData
    .getAll("newcomerLink")
    .map((v) => decodeLinkPick(String(v)))
    .filter((p): p is NonNullable<typeof p> => !!p);
  return { renderedSubjects: new Set(formData.getAll("newcomerLinkRow").map((v) => String(v))), picks };
}

/** 상담 저장 뒤 신규생 체크 연결 — 실패해도 상담 저장은 되돌리지 않는다(재제출하면 상담이 두 번 생긴다). */
async function linkNewcomerChecks(
  user: { tenantId: string; id: string },
  consultationId: string,
  input: ReturnType<typeof readConsultationForm>,
  formData: FormData,
) {
  const links = readNewcomerLinks(formData);
  // 폼 값은 타임존 없는 KST 벽시계 — 서버(UTC)가 그대로 읽으면 오후 3시 이후 상담이 다음 날로 넘어간다(kstLocalToIso 주석).
  const consultedOn = kstDateOf(kstLocalToIso(input.consultedAt)) ?? kstToday();
  const res = await applyConsultationNewcomerLinks({
    tenantId: user.tenantId,
    userId: user.id,
    consultationId,
    studentId: input.studentId,
    consultedOn,
    ...links,
  });
  if (res.error) console.error("[consultation] newcomer link:", res.error);
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

/** 저장 행에 싣는 반 칸 — 0318a가 없으면(판정 불가) 아무것도 싣지 않는다([[#95]]). */
function classColumns(decision: ClassDecision | null): { class_id?: string | null; class_source?: string } {
  if (!decision || !decision.supported || "error" in decision) return {};
  return { class_id: decision.classId, class_source: decision.source };
}

/** 감사 metadata의 반 — 판정했을 때만(칸이 없으면 반 이야기를 지어내지 않는다). */
function classAudit(decision: ClassDecision | null): Record<string, unknown> {
  if (!decision || !decision.supported || "error" in decision) return {};
  return { classId: decision.classId, className: decision.className, classPick: decision.source };
}

/**
 * 상담을 저장한 뒤 그 학생의 **상담 흐름 분석**을 이전 분석에 합산한다(원장 2026-11-03 *"새 상담 올릴때마다 상담 분석 돌릴것"*).
 * 응답을 보낸 뒤(`after`) 돌고, 실패해도 상담 저장엔 영향이 없다(결과는 연결 탐색 왼쪽 '흐름 분석' 카드에 저장된 것만 보인다).
 */
async function scheduleFlowRefresh(tenantId: string, studentId: string) {
  if (!(await isFeatureLicensed(tenantId, "ai_analysis"))) return;
  after(async () => {
    const r = await refreshFlowInsight({ tenantId, studentId, kind: "consultations", reason: "consultation_saved" });
    if (r.status === "failed") console.error(`[consultations] 상담 흐름 분석 갱신 실패(${studentId}): ${r.error}`);
  });
}

export async function createStudentConsultation(
  _prev: ConsultationFormState,
  formData: FormData,
): Promise<ConsultationFormState> {
  const user = await getCurrentUser({ teacherView: true });
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
  // 🔴 `new Date(값)`으로 읽지 말 것 — 폼이 보내는 건 **타임존 없는 KST 벽시계**다(아래 consulted_at 주석).
  const consultedIso = kstLocalToIso(input.consultedAt) ?? new Date().toISOString();
  const consultedOn = kstDateOf(consultedIso);
  // 반(0318a) — 사람이 고른 값은 그대로, 아니면 서버가 판정한다(폼 미리보기와 같은 함수 · class-save.ts).
  const decision = await decideClassForSave({
    studentId: input.studentId,
    date: consultedOn,
    counselorId,
    subject: resolved.subject,
    pick: input.classPick ?? "auto",
    pickedClassId: input.classId,
  }).catch((e) => {
    console.error("[consultation] 반 판정 실패(반 없이 저장):", e instanceof Error ? e.message : e);
    return null;
  });
  if (decision && decision.supported && "error" in decision) return { error: decision.error };
  const row = {
      tenant_id: user.tenantId,
      student_id: input.studentId,
      counselor_id: counselorId,
      // 🔴 `new Date(값)`으로 읽지 말 것 — 폼이 보내는 건 **타임존 없는 KST 벽시계**라 서버(UTC)가
      //    그대로 읽으면 9시간 뒤로 앉는다(원장 제보 2026-09-09, date-kst `kstLocalToIso` 주석).
      consulted_at: consultedIso,
      category: input.category,
      subject: resolved.subject,
      audience: input.audience,
      // 붙여넣기로 딸려 온 화면 코드 조각을 걷어낸다(원장 2026-09-09 *"그 조각만 걷어내. 앞으로 가져올때도 조심"*).
      summary: stripPastedMarkup(input.summary),
      follow_up_action: input.followUpAction,
      follow_up_date: input.followUpDate,
      follow_up_done: input.followUpDone,
  };
  const insert = (withClass: boolean) =>
    supabase
      .from("student_consultations")
      .insert({ ...row, ...(withClass ? classColumns(decision) : {}) })
      .select("id")
      .single();
  let savedClass = !!decision && decision.supported;
  let { data, error } = await insert(savedClass);
  if (savedClass && error && isMissingClassSchema(error)) {
    // 판정 RPC는 있는데 칸이 아직 없는 틈(스키마 캐시) — 반 없이 저장한다(상담 기록이 우선).
    noteClassSchema(false);
    savedClass = false;
    ({ data, error } = await insert(false));
  }

  if (error || !data) return { error: explainDbError(error, { scope: "consultations.create", fallback: "상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  await linkNewcomerChecks(user, data.id as string, input, formData);

  // 🔴 요약·후속조치 **본문은 담지 않는다**(상담 내용 금지) — 분류·대상·후속조치 유무까지만.
  // 대상 열의 학생 이름은 metadata.studentId를 뷰어가 일괄 해석한다(auditTargetName).
  await logAction({
    action: "student_consultation_create",
    targetType: "student_consultation",
    metadata: {
      consultationId: data.id as string,
      studentId: input.studentId,
      // 저장되는 값과 같은 식으로 KST 날짜를 뽑는다 — 감사로그가 상담 목록 화면과 같은 날을 말해야 한다.
      consultedAt: consultedOn,
      category: input.category,
      audience: input.audience,
      hasFollowUp: !!input.followUpAction,
      followUpDate: input.followUpDate,
      ...(savedClass ? classAudit(decision) : {}),
    },
  });

  revalidatePath("/consultations");
  revalidatePath(`/students/${input.studentId}`);
  await scheduleFlowRefresh(user.tenantId, input.studentId);
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·이동(B-2).
  // (제출 시점 무조건 clear는 서버 검증 실패 시 입력 유실 위험 → 성공 확정 기반으로 전환.)
  return { ok: true, redirectTo: "/consultations", nonce: Date.now() };
}

export async function updateStudentConsultation(
  _prev: ConsultationFormState,
  formData: FormData,
): Promise<ConsultationFormState> {
  const user = await getCurrentUser({ teacherView: true });
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
    if (curErr) {
      logDbError(curErr, "consultations.updateStudentConsultation");
      return { error: "상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
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
  // 반 칸(0318a)까지 함께 읽는다 — 없으면 그 조각을 빼고 다시(반은 건드리지 않고 저장, [[#95]]).
  const readStored = (withClass: boolean) =>
    supabase
      .from("student_consultations")
      .select(
        withClass
          ? "summary, student_id, subject, category, consulted_at, class_id, class_source, cls:classes!student_consultations_class_id_fkey ( class_name )"
          : "summary, student_id, subject, category, consulted_at",
      )
      .eq("id", id)
      .eq("tenant_id", user.tenantId)
      .maybeSingle();
  let classReadable = classSchemaWorthTrying();
  let { data: storedRaw, error: readError } = await readStored(classReadable);
  if (classReadable && readError && isMissingClassSchema(readError)) {
    noteClassSchema(false);
    classReadable = false;
    ({ data: storedRaw, error: readError } = await readStored(false));
  }
  if (readError || !storedRaw) return { error: "상담 기록을 찾지 못했습니다" };
  const stored = storedRaw as unknown as {
    summary: string | null;
    student_id: string;
    subject: string | null;
    category: string | null;
    consulted_at: string | null;
    class_id?: string | null;
    class_source?: string | null;
    cls?: { class_name?: string | null } | { class_name?: string | null }[] | null;
  };
  const storedCls = Array.isArray(stored.cls) ? stored.cls[0] : stored.cls;
  const prevClass = { id: stored.class_id ?? null, name: storedCls?.class_name ?? null, source: stored.class_source ?? null };

  // 반 — 폼이 칸을 그렸으면 그 선택대로(자동 = 서버 판정), 칸이 없었으면(0318a 전에 연 화면) 사람이 고른 값은 두고 나머지는 판정.
  const consultedIso = kstLocalToIso(input.consultedAt) ?? new Date().toISOString();
  const consultedOn = kstDateOf(consultedIso);
  // 🔴 학생·상담일이 바뀌면 저장된 반은 더는 그 상담의 사실이 아니다(다른 학생의 반·그날 수강하지 않던 반) — 사람이 고른 값이어도
  //    그대로 들고 가지 않는다(폼이 칸을 그렸으면 서버가 어차피 다시 검증하고, 칸이 없던 화면이면 아래에서 다시 판정한다).
  const contextChanged = stored.student_id !== input.studentId || kstDateOf(stored.consulted_at) !== consultedOn;
  const keepManual = !input.classPick && prevClass.source === "manual" && !contextChanged;
  const decision =
    !classReadable || keepManual
      ? null
      : await decideClassForSave({
          studentId: input.studentId,
          date: consultedOn,
          counselorId,
          subject: resolved.subject,
          pick: input.classPick ?? "auto",
          pickedClassId: input.classId,
        }).catch((e) => {
          console.error("[consultation] 반 판정 실패(반은 그대로 두고 저장):", e instanceof Error ? e.message : e);
          return null;
        });
  if (decision && decision.supported && "error" in decision) return { error: decision.error };
  const judged = decision && decision.supported && !("error" in decision) ? decision : null;
  // 반을 다시 정하지 못했는데(판정 실패·후보 조회 불가) 학생·상담일이 바뀌었으면 옛 반을 **비우고 '아직 판정 안 함'으로** 되돌린다 —
  // 그대로 두면 다른 학생의 반이 붙은 채 남고(stale), '자동'·'직접 고름' 표식 때문에 목록·백필이 다시 판정하지도 않는다.
  const resetStale = classReadable && !judged && contextChanged && (prevClass.id !== null || prevClass.source !== null);
  const classPatch: { class_id?: string | null; class_source?: string | null } = judged
    ? classColumns(judged)
    : resetStale
      ? { class_id: null, class_source: null }
      : {};
  const cleanSummary = stripPastedMarkup(input.summary) ?? "";
  const summary = stored.student_id === input.studentId && stored.subject === resolved.subject &&
    stored.category === "academic" && input.category === "academic"
    ? preserveConsultationLink(cleanSummary, stored.summary ?? "")
    : cleanSummary;
  const patch = {
      student_id: input.studentId,
      counselor_id: counselorId,
      // 🔴 `new Date(값)`으로 읽지 말 것 — 폼이 보내는 건 **타임존 없는 KST 벽시계**라 서버(UTC)가
      //    그대로 읽으면 9시간 뒤로 앉는다(원장 제보 2026-09-09, date-kst `kstLocalToIso` 주석).
      consulted_at: consultedIso,
      category: input.category,
      subject: resolved.subject,
      audience: input.audience,
      // 붙여넣기로 딸려 온 화면 코드 조각을 걷어낸다(원장 2026-09-09 *"그 조각만 걷어내. 앞으로 가져올때도 조심"*).
      summary,
      follow_up_action: input.followUpAction,
      follow_up_date: input.followUpDate,
      follow_up_done: input.followUpDone,
  };
  const update = (withClass: boolean) =>
    supabase
      .from("student_consultations")
      .update({ ...patch, ...(withClass ? classPatch : {}) })
      .eq("id", id)
      .eq("tenant_id", user.tenantId);
  let savedClass = !!judged || resetStale;
  let { error } = await update(savedClass);
  if (savedClass && error && isMissingClassSchema(error)) {
    noteClassSchema(false);
    savedClass = false;
    ({ error } = await update(false));
  }

  if (error) return { error: explainDbError(error, { scope: "consultations.update", fallback: "상담을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };
  await linkNewcomerChecks(user, id, input, formData);

  await logAction({
    action: "student_consultation_update",
    targetType: "student_consultation",
    metadata: {
      consultationId: id,
      studentId: input.studentId,
      consultedAt: consultedOn,
      category: input.category,
      audience: input.audience,
      hasFollowUp: !!input.followUpAction,
      followUpDate: input.followUpDate,
      // 반이 **바뀐 경우에만** 이전 값을 함께 남긴다(원장 *"기능 추가·변동은 모두 감사로그"* — 반 변경이 수정 기록에 보여야 한다).
      // 이전에 판정한 적이 없던 옛 행(출처 없음)의 첫 판정은 '변경'이 아니다 — 이전 값을 '미매핑'으로 적으면 거짓이 된다.
      ...(savedClass && judged ? classAudit(judged) : {}),
      // 판정은 못 했지만 옛 반을 비운 저장(위 resetStale) — 반이 빠졌다는 사실은 남긴다.
      ...(savedClass && !judged ? { classId: null, className: null } : {}),
      ...(savedClass && prevClass.source !== null && (judged ? judged.classId : null) !== prevClass.id
        ? { prevClassId: prevClass.id, prevClassName: prevClass.name }
        : {}),
    },
  });

  revalidatePath("/consultations");
  revalidatePath(`/students/${input.studentId}`);
  await scheduleFlowRefresh(user.tenantId, input.studentId);
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·이동(B-2).
  return { ok: true, redirectTo: "/consultations", nonce: Date.now() };
}

export type ToggleFollowUpState = { error?: string } | undefined;

export async function toggleConsultationFollowUp(
  _prev: ToggleFollowUpState,
  formData: FormData,
): Promise<ToggleFollowUpState> {
  const user = await getCurrentUser({ teacherView: true });
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
  if (error) return { error: explainDbError(error, { scope: "consultations.followUp", fallback: "후속조치를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };
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
  const user = await getCurrentUser({ teacherView: true });
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
    if (beforeErr) {
      logDbError(beforeErr, "consultations.deleteStudentConsultation");
      return { error: "상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    if (!before || before.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
    del = del.eq("counselor_id", scopedId);
  }
  // 🔴 이 상담으로 한 신규생 체크를 지우기 **전에** 찾아 두고, 삭제가 성공한 **뒤에** 푼다 — 상담이 없는데
  //    "콜 했음"만 남으면 거짓 기록이다. 못 찾으면 지우지 않는다(지운 뒤엔 FK set null로 찾을 길이 없다).
  const unlink = await prepareConsultationUnlink(user.tenantId, id);
  if (unlink.error) return { error: `${unlink.error} — 상담을 지우지 않았습니다` };
  const { error } = await del;
  if (error) return { error: explainDbError(error, { scope: "consultations.delete", fallback: "상담을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", op: "delete" }).message };
  await unlink.apply();

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
