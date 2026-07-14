"use server";

// 관리자 "직접 작성·발송" — 관리자가 **임의 학생**의 수업보고서를 작성해 ClassNote로 발송.
// 강사 원스크린(saveLessonReport/saveAndQueueClassnote)과 동일 포맷·레일(lesson_reports → /r 캡처 → ClassNote)이나,
// 강사 소유(teacherOwnsStudent) 게이트 대신 **canWriteTenant('lesson_reports')** 로 인가한다(관리자는 학원 전체 발송 총괄).
// ⚠️ 발송 안전 가드는 강사 경로와 100% 동일하게 유지: dry-run 스위치 · 과목 opt-in/화이트리스트 · 동명이인 name_conflict ·
//    too_old · 취소/게시중 보호. RLS가 테넌트 격리(다른 테넌트 학생 접근 불가). source='admin'(강사 작성률 오염 방지).
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { ingestReport } from "@/features/progress/server/ingest";
import { BOARD_PREFIX } from "../notice-targets";

export type AdminSaveReportInput = {
  studentId: string;
  subject: string; // 과목키(math/english…) — 관리자 발송은 필수(보드·게이트·(student,date,subject) dedup 결정)
  teacherName?: string; // 학부모 카드에 표시할 강사명 — 기본=해당 과목 담당 강사, 미지정 시 관리자 본인
  textbook?: string;
  makeup?: boolean;
  homeworkToday?: string;
  progress: string;
  examInfo: string;
  homeworkScore: string;
  notes: string; // 학부모 보고서 본문
  dailyTest?: string;
  checkTest?: string;
  attitude?: string;
  trendNote?: string;
};

/**
 * 관리자 임의-학생 보고서 upsert(내부 공용). saveLessonReport(강사)와 동일 컬럼 계약이나 **teacherOwnsStudent 게이트를
 * 뺀다** — 인가는 호출부가 canWriteTenant로 이미 확인. RLS 테넌트 격리 + 학생 존재 확인으로 유효성 보강.
 * teacher_name = 지정값(과목 담당) 우선, 없으면 관리자명. source='admin'(강사 작성률 통계 오염 방지). ingestReport 비치명적.
 */
async function upsertAdminReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: CurrentUser,
  input: AdminSaveReportInput,
): Promise<{ ok: boolean; id?: string; shareToken?: string; error?: string }> {
  // 학생 존재(테넌트 스코프=RLS) 확인 — 크로스테넌트/삭제 학생 방어.
  const { data: stu } = await supabase.from("students").select("id").eq("id", input.studentId).maybeSingle();
  if (!stu) return { ok: false, error: "학생을 찾을 수 없습니다" };

  const reportDate = kstToday();
  const { data, error } = await supabase
    .from("lesson_reports")
    .upsert(
      {
        tenant_id: user.tenantId,
        student_id: input.studentId,
        report_date: reportDate,
        subject: input.subject || null,
        textbook: input.textbook || null,
        makeup: input.makeup ?? false,
        homework_today: input.homeworkToday || null,
        progress: input.progress || null,
        exam_info: input.examInfo || null,
        homework_score: input.homeworkScore || null,
        daily_test: input.dailyTest || null,
        check_test: input.checkTest || null,
        attitude: input.attitude || null,
        teacher_name: input.teacherName?.trim() || user.displayName || null,
        notes: input.notes || null,
        trend_note: input.trendNote || null,
        source: "admin",
      },
      { onConflict: "tenant_id,student_id,report_date,subject" },
    )
    .select("id, share_token")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };

  // 진도 컨테이너 반영 — 비수학·진도없음·이미반영은 내부 skip. 실패해도 저장 유지(비치명적).
  try {
    await ingestReport(supabase, {
      id: data.id,
      tenantId: user.tenantId,
      studentId: input.studentId,
      reportDate,
      subject: input.subject || null,
      progress: input.progress || null,
    });
  } catch {
    /* 진도 반영 실패는 저장을 막지 않음 */
  }
  return { ok: true, id: data.id, shareToken: data.share_token };
}

/** 관리자 직접 작성 — 저장만(발송 안 함). 인가 canWriteTenant('lesson_reports'). */
export async function saveAdminReport(
  input: AdminSaveReportInput,
): Promise<{ ok: boolean; id?: string; shareToken?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!input.studentId) return { ok: false, error: "학생을 선택하세요" };
  if (!input.subject) return { ok: false, error: "과목을 선택하세요" };
  const supabase = await createClient();
  return upsertAdminReport(supabase, user, input);
}

/**
 * 관리자 직접 작성 + ClassNote 발송 — saveAndQueueClassnote(강사)와 **동일 가드 순서**:
 * 1) 인가 canWriteTenant  2) 저장 전 상태 pre-read(revoked/processing 보호)  3) upsert 저장
 * 4) dry-run 스위치 OFF → 'dry_run'(저장만)  5) 과목 게이트 → 'subject_off'  6) 동명이인 → 'name_conflict'(큐잉 차단)
 * 7) too_old → queued/too_old. 실제 게시는 로컬 워커가 'queued'를 폴링해 처리(비동기).
 */
export async function saveAndQueueAdminReport(
  input: AdminSaveReportInput,
): Promise<{ ok: boolean; id?: string; shareToken?: string; status?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!input.studentId) return { ok: false, error: "학생을 선택하세요" };
  if (!input.subject) return { ok: false, error: "과목을 선택하세요" };

  const supabase = await createClient();
  const reportDate = kstToday();

  // 저장 전 상태 pre-read(오늘 (student,subject) 행). 취소/게시중은 덮어쓰지 않는다.
  const { data: prior } = await supabase
    .from("lesson_reports")
    .select("id, classnote_status, revoked_at")
    .eq("student_id", input.studentId)
    .eq("report_date", reportDate)
    .eq("subject", input.subject)
    .maybeSingle();
  if (prior?.revoked_at) return { ok: true, id: prior.id, status: "revoked" };
  if (prior?.classnote_status === "processing") return { ok: true, id: prior.id, status: "processing" };

  const saved = await upsertAdminReport(supabase, user, input);
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "보고서 저장에 실패했습니다" };

  // 발송 안전 스위치(기본 OFF) — 원장 승인 전까지 저장만.
  const settings = await getTenantSettings();
  if (!settings.report.classnoteSendEnabled) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "dry_run" };
  }
  // 과목 opt-in/화이트리스트 — 없으면 저장만.
  if (!isClassnoteSubjectEnabled(input.subject, settings.report.classnoteSubjects)) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "subject_off" };
  }
  // 동명이인 — 자동 발송 차단(name_conflict 마킹). classnote_name 접미사로 구분 후 재시도.
  if (await hasClassnoteNameCollision(supabase, input.studentId)) {
    await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "name_conflict",
        classnote_queued_at: null,
        classnote_error: "동명이인 감지 — 자동 발송 차단",
      })
      .eq("id", saved.id);
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "name_conflict" };
  }
  // too_old(전 달 1일 이전) 아니면 queued. 오늘 저장은 항상 통과하나 규약상 명시.
  const allowed = isClassnoteAllowed(reportDate);
  const { error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: allowed ? "queued" : "too_old",
      classnote_queued_at: allowed ? new Date().toISOString() : null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .eq("id", saved.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: saved.id, shareToken: saved.shareToken, status: allowed ? "queued" : "too_old" };
}

export type AdminComposeSubject = {
  key: string;
  label: string; // 한글 과목명(labelOf)
  teacherName: string | null; // 이 과목 담당 강사(기본 teacher_name)
  sendable: boolean; // ClassNote 발송 허용 과목(화이트리스트 ∩ 학원설정 opt-in)
  board: string | null; // 실보드명 미리보기 "(수학)홍길동" — 발송불가 과목이면 null
};

/**
 * 직접 작성 컨텍스트 — 선택한 학생의 발송 관련 정보(작성 폼이 학생 선택 후 호출).
 * 읽기 게이트 canAccessTenant('lesson_reports'). 학생의 활성 수강 반에서 과목·담당강사를 뽑고, 보드명·발송가능·동명이인을 계산.
 */
export async function getAdminComposeContext(studentId: string): Promise<{
  ok: boolean;
  student?: { id: string; name: string; classnoteName: string | null };
  subjects?: AdminComposeSubject[]; // 이 학생의 수강 과목(담당 강사 포함)
  sendableSubjects?: AdminComposeSubject[]; // 발송 가능 과목(수강 무관 폴백) — 미수강 학생도 직접 발송 가능
  nameCollision?: boolean;
  sendEnabled?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!studentId) return { ok: false, error: "학생을 선택하세요" };
  const supabase = await createClient();

  const { data: stu } = await supabase
    .from("students")
    .select("id, name, classnote_name")
    .eq("id", studentId)
    .maybeSingle();
  if (!stu) return { ok: false, error: "학생을 찾을 수 없습니다" };

  // 활성 수강 반 → 과목 + 담당 강사(join 형태 모호성 회피 위해 2단계 조회).
  const { data: enr } = await supabase
    .from("enrollments")
    .select("class_id")
    .eq("student_id", studentId)
    .is("end_date", null);
  const classIds = [...new Set((enr ?? []).map((e) => e.class_id as string))];
  let classRows: { subject: string | null; teacher_id: string | null }[] = [];
  if (classIds.length) {
    const { data } = await supabase.from("classes").select("subject, teacher_id").in("id", classIds);
    classRows = (data ?? []) as typeof classRows;
  }
  const teacherIds = [...new Set(classRows.map((c) => c.teacher_id).filter(Boolean))] as string[];
  const nameByTeacher = new Map<string, string | null>();
  if (teacherIds.length) {
    const { data } = await supabase.from("users").select("id, display_name").in("id", teacherIds);
    for (const u of data ?? []) nameByTeacher.set(u.id as string, (u.display_name as string | null) ?? null);
  }

  const settings = await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const effName = (stu.classnote_name?.trim() || stu.name?.trim() || "") as string;

  // 과목키별 첫 담당 강사(수강 순).
  const bySubject = new Map<string, string | null>();
  for (const c of classRows) {
    if (!c.subject) continue;
    if (!bySubject.has(c.subject)) bySubject.set(c.subject, c.teacher_id ? nameByTeacher.get(c.teacher_id) ?? null : null);
  }
  const subjects: AdminComposeSubject[] = [...bySubject.entries()].map(([key, teacherName]) => {
    const sendable = isClassnoteSubjectEnabled(key, settings.report.classnoteSubjects);
    return {
      key,
      label: subjectMaps.labelOf(key),
      teacherName,
      sendable,
      // 보드 미리보기·발송 확인은 실제 발송 가능한 과목만 — 발송불가(비opt-in) 과목에 보드명을 보여주면
      // "(영어)홍길동에게 발송할까요?"처럼 실제론 막히는(subject_off) 발송을 암시해 오해를 준다.
      board: sendable && BOARD_PREFIX[key] ? `${BOARD_PREFIX[key]}${effName}` : null,
    };
  });

  // 발송 가능 과목(학원설정 opt-in ∩ 화이트리스트) — **수강 이력과 무관**한 폴백 옵션.
  // 학생이 발송 과목 반에 수강 중이 아니어도(예: 테스트 학생 '학원이') 관리자가 직접 골라 보낼 수 있게 한다.
  // 담당 강사는 없음(표시 강사명은 관리자명 폴백, 편집 가능). classnoteSubjects가 비면 빈 배열 = 발송 불가 안내.
  const sendableSubjects: AdminComposeSubject[] = settings.report.classnoteSubjects
    .filter((key) => isClassnoteSubjectEnabled(key, settings.report.classnoteSubjects))
    .map((key) => ({
      key,
      label: subjectMaps.labelOf(key),
      teacherName: null,
      sendable: true,
      board: BOARD_PREFIX[key] ? `${BOARD_PREFIX[key]}${effName}` : null,
    }));

  const nameCollision = await hasClassnoteNameCollision(supabase, studentId);
  return {
    ok: true,
    student: { id: stu.id as string, name: stu.name as string, classnoteName: (stu.classnote_name as string | null) ?? null },
    subjects,
    sendableSubjects,
    nameCollision,
    sendEnabled: settings.report.classnoteSendEnabled,
  };
}
