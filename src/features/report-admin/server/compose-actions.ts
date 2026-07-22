"use server";

// 관리자 "직접 작성·발송" — 관리자가 **임의 학생**의 수업보고서를 작성해 ClassNote로 발송.
// 강사 원스크린(saveLessonReport/saveAndQueueClassnote)과 동일 포맷·레일(lesson_reports → /r 캡처 → ClassNote)이나,
// 강사 소유(teacherOwnsStudent) 게이트 대신 **canWriteTenant('lesson_reports')** 로 인가한다(관리자는 학원 전체 발송 총괄).
// ⚠️ 발송 안전 가드는 강사 경로와 100% 동일하게 유지: dry-run 스위치 · 과목 opt-in/화이트리스트 · 동명이인 name_conflict ·
//    too_old · 취소/게시중 보호. RLS가 테넌트 격리(다른 테넌트 학생 접근 불가). source='admin'(강사 작성률 오염 방지).
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { resolveReportDate } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { absenceKeyOf, getAbsenceBlockedKeys, isStudentAbsentForSend } from "@/features/onescreen/server/absence-gate";
import { ingestReport } from "@/features/progress/server/ingest";
import { BOARD_PREFIX } from "../notice-targets";
import { resolveReportClassId } from "./resolve-class";

export type AdminSaveReportInput = {
  studentId: string;
  reportDate?: string; // 대상 날짜(YYYY-MM-DD) — 빈값=오늘. 과거 날짜 작성·발송용(report_date=카드·ClassNote 게시일).
  subject: string; // 과목키(math/english…) — 관리자 발송은 필수(보드·게이트 결정. 반이 없을 때의 dedup 단위)
  /**
   * 이 보고서의 반(0134a) — 보고서 1건의 단위. 반 단위 대량발송은 고른 반을 그대로 싣고,
   * 개별 작성은 `resolveReportClassId`가 **모호하지 않을 때만** 채운다(모호하면 null = 과목 단위, 예전과 동일).
   */
  classId?: string | null;
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

  const reportDate = resolveReportDate(input.reportDate); // 빈값·미래→오늘, 과거는 그대로(too_old 가드가 발송 범위 강제)
  const { data, error } = await supabase
    .from("lesson_reports")
    .upsert(
      {
        tenant_id: user.tenantId,
        student_id: input.studentId,
        report_date: reportDate,
        subject: input.subject || null,
        class_id: input.classId || null, // 0134a — 보고서 단위(없으면 과목이 단위)
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
      // 생성열 unit_key = coalesce(class_id::text, subject) — 0134a. 강사 경로와 같은 타깃.
      { onConflict: "tenant_id,student_id,report_date,unit_key" },
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
  const reportDate = resolveReportDate(input.reportDate); // 빈값·미래→오늘, 과거 그대로(아래 too_old 가드가 실발송 범위 강제)

  // 반을 모호하지 않게 특정할 수 있으면 붙인다(0134a) — 강사가 그 반 보고서를 이미 썼다면 **같은 행**을
  // 갱신해야 한다. 안 붙이면 반 있는 행과 반 없는 행이 따로 생겨 학부모에게 두 번 나간다.
  const classId = input.classId ?? (await resolveReportClassId(supabase, {
    studentId: input.studentId,
    reportDate,
    subject: input.subject,
    teacherName: input.teacherName,
  }));
  const scopedInput = { ...input, classId };

  // 저장 전 상태 pre-read — 행(반) 단위. 취소/게시중/발송완료는 덮어쓰지 않는다.
  // ⚠️ maybeSingle 금지: 같은 (student,date,subject)에 반이 다른 2행이 정상적으로 존재할 수 있다.
  const priorBase = supabase
    .from("lesson_reports")
    .select("id, classnote_status, revoked_at")
    .eq("student_id", input.studentId)
    .eq("report_date", reportDate);
  const { data: priorRows } = await (
    classId ? priorBase.eq("class_id", classId) : priorBase.is("class_id", null).eq("subject", input.subject)
  ).limit(1);
  const prior = priorRows?.[0];
  if (prior?.revoked_at) return { ok: true, id: prior.id, status: "revoked" };
  if (prior?.classnote_status === "processing") return { ok: true, id: prior.id, status: "processing" };
  // 이미 게시된 건은 재발송 차단(강사 경로 saveAndQueueClassnote와 동일 규칙, 2026-07-22).
  // ClassNote는 게시글 수정·삭제가 없어 재발송 = 학부모 게시판에 글이 하나 더 붙는 것뿐이다.
  // 정말 다시 보내야 하면 발송 콘솔의 '재발송'(retryClassnote) 또는 공유링크 재발급을 쓴다.
  if (prior?.classnote_status === "success") return { ok: true, id: prior.id, status: "already_sent" };

  const saved = await upsertAdminReport(supabase, user, scopedInput);
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
  // 결석 게이트(#77) — 그날 결석으로 기록된 학생은 저장만 하고 큐잉 안 함(원스크린 게이트의 서버 공용판).
  // 보강 보고서(makeup)는 게이트 제외(결석+같은 날 보강 참석 = 정당한 발송). 조회 실패 = fail-closed(저장은 완료).
  if (!input.makeup) {
    try {
      if (
        await isStudentAbsentForSend(supabase, user.tenantId, {
          studentId: input.studentId,
          reportDate,
          subject: input.subject,
          classId, // 반이 정해졌으면 그 반 출결만(0134a)
        })
      ) {
        // 대기 중(queued) 재고 회수 — 안 지우면 "전송하지 않았습니다" 안내 직후 워커가 갱신 내용을 게시.
        if (prior?.classnote_status === "queued") {
          await supabase
            .from("lesson_reports")
            .update({ classnote_status: null, classnote_queued_at: null })
            .eq("id", saved.id)
            .eq("classnote_status", "queued");
        }
        return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "absent" };
      }
    } catch {
      return { ok: false, error: "출결 확인에 실패해 발송하지 않았습니다 — 저장은 완료됐습니다. 다시 시도하세요" };
    }
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

const BULK_BODY_MAX = 4000;
const BULK_CLASS_CAP = 100;
const BULK_TARGET_CAP = 400; // (학생,과목) 타깃 상한 — 초과분은 잘라내고 skipped로 알린다(타임아웃·오발송 폭 방어).
const BULK_TEST_STUDENT_NAME = "학원이"; // 실 학부모에게 안 가는 테스트 학생(반 공지 TEST_TARGET과 동일 관례).

export type BulkAdminReportInput = {
  classIds: string[];
  reportDate?: string; // 대상 날짜(YYYY-MM-DD) — 빈값=오늘. 과거 날짜 대량 발송용(report_date=카드·ClassNote 게시일).
  teacherName?: string; // 표시 강사명 오버라이드 — 비우면 각 반의 담당 강사(classes.teacher_id)
  textbook?: string;
  makeup?: boolean;
  homeworkToday?: string;
  progress?: string; // 오늘 진도(공유)
  notes: string; // 학부모 보고서 본문(공유) — 필수
  trendNote?: string;
  test?: boolean; // 학원이 1명에게만(파이프라인 검증)
};

// classId: 0134a — 대량발송은 **반을 골라서** 보내므로 반이 항상 정확하다(테스트 학생 경로만 null).
type BulkTarget = { studentId: string; subject: string; classId: string | null; teacherName: string | null };

/**
 * 반 단위 대량 발송 — 선택 반들의 재원생 각자에게 **같은 내용**의 리포트 카드를 작성해 ClassNote 큐에 적재.
 * 반 공지(sendClassNotice, 자유 텍스트)의 **리포트-카드 버전**. 학부모 발송이라 안전가드는 개별 발송
 * (saveAndQueueAdminReport)과 동일하게 **학생별로** 태운다: dry-run 스위치 · 과목 opt-in/화이트리스트 ·
 * 동명이인 name_conflict(sendClassnoteForUnsent 25청크 배치) · too_old(전 달 1일 이전 날짜=발송 차단). 실제 게시는 로컬 워커.
 * ⚠️ 오늘 그 과목 보고서가 이미 있는 학생은 **건너뛴다**(강사 작성분 덮어쓰기·중복 발송 방지). dry-run이면 저장/큐잉 안 함.
 */
export async function sendBulkAdminReports(input: BulkAdminReportInput): Promise<{
  ok: boolean;
  queued?: number;
  conflicts?: number; // 동명이인으로 발송 차단된 학생 수
  skippedExisting?: number; // 이미 오늘 보고서가 있어 제외된 학생 수
  absent?: number; // 그날 결석 기록이라 제외된 (학생,과목) 수 — 카드 작성 자체를 안 함(#77 결석 게이트)
  subjectOff?: number; // 발송 대상 과목이 아니라 제외된 (학생,과목) 수
  overflow?: number; // 타깃 상한 초과로 잘린 수
  tooOld?: number; // 전 달 1일 이전 날짜라 발송 차단(too_old)된 수 — 개별/원스크린 경로와 동일 가드
  wouldSend?: number; // dry-run 시 발송 예정 인원(상한)
  dryRun?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  const body = (input.notes ?? "").trim();
  if (!body) return { ok: false, error: "학부모 보고서 본문을 입력하세요" };
  if (body.length > BULK_BODY_MAX) return { ok: false, error: `본문이 너무 깁니다(최대 ${BULK_BODY_MAX}자)` };

  const supabase = await createClient();
  const settings = await getTenantSettings();
  const reportDate = resolveReportDate(input.reportDate); // 빈값·미래→오늘, 과거 그대로(아래 too_old 가드가 실발송 범위 강제)
  const allowedSubjects = settings.report.classnoteSubjects;

  // ── 1. 대상 (학생,과목,담당강사) 후보 해석 ──
  let targets: BulkTarget[] = [];
  let subjectOff = 0;
  if (input.test) {
    // 테스트 학생(학원이) — 탈원 상태일 수 있어 이름으로 조회(반 해석 경로로 안 뽑힘). 발송 과목 첫 번째로.
    const firstSendable = allowedSubjects.find((k) => isClassnoteSubjectEnabled(k, allowedSubjects));
    if (!firstSendable)
      return { ok: false, error: "발송 가능한 과목이 없습니다 — 원장 설정 > 수업보고서 > 발송 과목을 먼저 지정하세요" };
    const { data: t } = await supabase
      .from("students")
      .select("id")
      .eq("name", BULK_TEST_STUDENT_NAME)
      .limit(1)
      .maybeSingle();
    if (!t) return { ok: false, error: `테스트 학생(${BULK_TEST_STUDENT_NAME})을 찾을 수 없습니다` };
    // 테스트 학생(학원이)은 반 해석 경로 밖이라 classId 없음 → 과목이 단위(예전과 동일).
    targets = [{ studentId: t.id as string, subject: firstSendable, classId: null, teacherName: input.teacherName?.trim() || null }];
  } else {
    const classIds = [...new Set(input.classIds ?? [])].slice(0, BULK_CLASS_CAP);
    if (!classIds.length) return { ok: false, error: "대상 반을 선택하세요" };
    const { data: classes } = await supabase
      .from("classes")
      .select("id, subject, teacher_id")
      .in("id", classIds)
      .eq("is_active", true);
    const subjectByClass = new Map((classes ?? []).map((c) => [c.id as string, c.subject as string | null]));
    const teacherByClass = new Map((classes ?? []).map((c) => [c.id as string, c.teacher_id as string | null]));
    const teacherIds = [...new Set([...teacherByClass.values()].filter(Boolean))] as string[];
    const nameByTeacher = new Map<string, string | null>();
    if (teacherIds.length) {
      const { data } = await supabase.from("users").select("id, display_name").in("id", teacherIds);
      for (const u of data ?? []) nameByTeacher.set(u.id as string, (u.display_name as string | null) ?? null);
    }
    // 활성 수강 rows(선택 반 한정) → 재원생만. B3: id 청크 .in().
    const enr = await fetchInChunks<{ class_id: string; student_id: string }>([...subjectByClass.keys()], (chunk) =>
      supabase.from("enrollments").select("class_id, student_id").in("class_id", chunk).is("end_date", null),
    );
    const studentIds = [...new Set(enr.map((e) => e.student_id))];
    const students = await fetchInChunks<{ id: string; status: string }>(studentIds, (chunk) =>
      supabase.from("students").select("id, status").in("id", chunk),
    );
    const statusById = new Map(students.map((s) => [s.id, s.status]));
    const override = input.teacherName?.trim() || null;
    // (학생,**반**) dedup — 0134a. 예전엔 (학생,과목)이라 같은 과목 두 반을 고르면 **한 건만** 나갔다
    // (관리자가 정규 반과 특강 반을 함께 선택하면 특강 몫이 조용히 사라짐). 이제 반마다 1건이다.
    const byKey = new Map<string, BulkTarget>();
    for (const e of enr) {
      if (statusById.get(e.student_id) !== "enrolled") continue; // 재원생만
      const subject = subjectByClass.get(e.class_id);
      if (!subject) continue;
      const key = `${e.student_id}|${e.class_id}`;
      if (byKey.has(key)) continue;
      const tId = teacherByClass.get(e.class_id);
      byKey.set(key, {
        studentId: e.student_id,
        subject,
        classId: e.class_id,
        teacherName: override || (tId ? nameByTeacher.get(tId) ?? null : null),
      });
    }
    // 과목 게이트 — 발송 대상 과목(opt-in ∩ 화이트리스트)만. 반 목록은 이미 발송과목으로 좁혀졌지만 이중 방어.
    const all = [...byKey.values()];
    targets = all.filter((t) => isClassnoteSubjectEnabled(t.subject, allowedSubjects));
    subjectOff = all.length - targets.length;
  }

  // 타깃 상한 — 초과분 잘라내고 알림(오발송 폭·타임아웃 방어).
  let overflow = 0;
  if (targets.length > BULK_TARGET_CAP) {
    overflow = targets.length - BULK_TARGET_CAP;
    targets = targets.slice(0, BULK_TARGET_CAP);
  }
  if (!targets.length) return { ok: true, queued: 0, conflicts: 0, skippedExisting: 0, subjectOff, overflow };

  // ── 2. 발송 안전 스위치(기본 OFF) — dry-run이면 저장/큐잉 없이 예정 인원만 반환 ──
  if (!settings.report.classnoteSendEnabled) {
    return { ok: true, dryRun: true, wouldSend: targets.length, queued: 0, conflicts: 0, skippedExisting: 0, subjectOff, overflow };
  }

  // ── 3. 오늘 그 과목 보고서가 이미 있는 학생 제외(덮어쓰기·중복 발송 방지) ──
  const targetStudentIds = [...new Set(targets.map((t) => t.studentId))];
  // ⚠️ 판정 단위 = 보고서 단위(0134a) = 반, 반이 없으면 과목. 반 기준과 과목 기준을 **둘 다** 본다 —
  //    반 있는 행이 이미 있으면 그 반 대상만 빼고, 반 없는 행(관리자 구버전·이관)은 같은 과목 대상을 뺀다
  //    (안 그러면 이미 학부모에게 나간 건에 한 건 더 붙는다).
  const existing = await fetchInChunks<{ student_id: string; subject: string | null; class_id: string | null }>(
    targetStudentIds,
    (chunk) =>
      supabase
        .from("lesson_reports")
        .select("student_id, subject, class_id")
        .eq("report_date", reportDate)
        .in("student_id", chunk),
  );
  const existingByClass = new Set(
    existing.filter((r) => r.class_id).map((r) => `${r.student_id}|${r.class_id}`),
  );
  const existingBySubject = new Set(
    existing.filter((r) => !r.class_id).map((r) => `${r.student_id}|${r.subject ?? ""}`),
  );
  const fresh = targets.filter(
    (t) =>
      !(t.classId && existingByClass.has(`${t.studentId}|${t.classId}`)) &&
      !existingBySubject.has(`${t.studentId}|${t.subject}`),
  );
  const skippedExisting = targets.length - fresh.length;
  if (!fresh.length) return { ok: true, queued: 0, conflicts: 0, skippedExisting, subjectOff, overflow };

  // ── 3.5 결석 게이트(#77) — 그날 결석 기록 학생에겐 "오늘 수업" 카드를 만들지도, 보내지도 않는다
  //    (원스크린 게이트와 동일 규약 — 결석 학생용 행을 안 만들어 미발송 재촉(unsent_report) 후보도 안 생김).
  //    보강 카드(input.makeup)는 게이트 제외(결석+보강 참석이 전제인 발송). 조회 실패 = fail-closed. ──
  let sendable: BulkTarget[];
  let absent = 0;
  if (input.makeup) {
    sendable = fresh;
  } else {
    try {
      // 반 단위 판정(0134a) — 대량발송은 반을 골라 보내므로 그 반 출결만 본다.
      const keyOf = (t: BulkTarget) => ({
        studentId: t.studentId,
        reportDate,
        subject: t.subject,
        classId: t.classId,
      });
      const blocked = await getAbsenceBlockedKeys(supabase, user.tenantId, fresh.map(keyOf));
      sendable = fresh.filter((t) => !blocked.has(absenceKeyOf(keyOf(t))));
    } catch {
      return { ok: false, error: "출결 확인에 실패했습니다 — 다시 시도하세요" };
    }
    absent = fresh.length - sendable.length;
  }
  if (!sendable.length) return { ok: true, queued: 0, conflicts: 0, skippedExisting, absent, subjectOff, overflow };

  // ── 4. 동명이인 감지 — 학생별 1회, 25명 청크(sendClassnoteForUnsent 패턴) ──
  const freshStudentIds = [...new Set(sendable.map((t) => t.studentId))];
  const conflicted = new Set<string>();
  for (let i = 0; i < freshStudentIds.length; i += 25) {
    const results = await Promise.all(
      freshStudentIds.slice(i, i + 25).map(async (sid) => [sid, await hasClassnoteNameCollision(supabase, sid)] as const),
    );
    for (const [sid, hit] of results) if (hit) conflicted.add(sid);
  }

  // ── 5. 리포트 카드 일괄 작성(공유 내용 + 학생 과목 + 반 담당강사). 청크 upsert. ──
  const nowIso = new Date().toISOString();
  const rowsToAuthor = sendable.map((t) => ({
    tenant_id: user.tenantId,
    student_id: t.studentId,
    report_date: reportDate,
    subject: t.subject,
    class_id: t.classId, // 0134a — 반 단위(선택한 반). 테스트 학생 경로만 null.
    textbook: input.textbook?.trim() || null,
    makeup: input.makeup ?? false,
    homework_today: input.homeworkToday?.trim() || null,
    progress: input.progress?.trim() || null,
    exam_info: null,
    homework_score: null,
    daily_test: null,
    check_test: null,
    attitude: null,
    teacher_name: t.teacherName || user.displayName || null,
    notes: body,
    trend_note: input.trendNote?.trim() || null,
    source: "admin",
  }));
  const authored: { id: string; student_id: string; subject: string | null }[] = [];
  for (let i = 0; i < rowsToAuthor.length; i += 100) {
    const { data, error } = await supabase
      .from("lesson_reports")
      .upsert(rowsToAuthor.slice(i, i + 100), { onConflict: "tenant_id,student_id,report_date,unit_key" })
      .select("id, student_id, subject");
    if (error) return { ok: false, error: error.message };
    authored.push(...((data ?? []) as typeof authored));
  }

  const conflictIds = authored.filter((r) => conflicted.has(r.student_id)).map((r) => r.id);
  const queueIds = authored.filter((r) => !conflicted.has(r.student_id)).map((r) => r.id);

  // ── 6. 상태 확정 — 동명이인 name_conflict / too_old(전 달 1일 이전) / 나머지 queued. .is(null) 경합 이중방어. ──
  let conflicts = 0;
  for (let i = 0; i < conflictIds.length; i += 100) {
    const { data } = await supabase
      .from("lesson_reports")
      .update({ classnote_status: "name_conflict", classnote_queued_at: null, classnote_error: "동명이인 감지 — 자동 발송 차단" })
      .in("id", conflictIds.slice(i, i + 100))
      .is("classnote_status", null)
      .select("id");
    conflicts += (data ?? []).length;
  }
  // reportDate 균일 → 개별/원스크린 경로(saveAndQueueAdminReport:164)와 동일하게 too_old 일괄 판정.
  // 과거 날짜가 전 달 1일보다 오래면 워커가 어차피 안 집는다(classnote-core.mjs:100 report_date>=md) → too_old로 명시(큐 고아·오해성공 방지).
  const allowed = isClassnoteAllowed(reportDate);
  let queued = 0;
  let tooOld = 0;
  for (let i = 0; i < queueIds.length; i += 100) {
    const { data, error } = await supabase
      .from("lesson_reports")
      .update({
        classnote_status: allowed ? "queued" : "too_old",
        classnote_queued_at: allowed ? nowIso : null,
        classnote_processing_at: null,
        classnote_retry_count: 0,
        classnote_error: null,
      })
      .in("id", queueIds.slice(i, i + 100))
      .is("classnote_status", null)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (allowed) queued += (data ?? []).length;
    else tooOld += (data ?? []).length;
  }

  // ── 7. 진도 컨테이너 반영(수학·진도 있을 때만, 비치명적). 10건씩 동시. ──
  const queuedIdSet = new Set(queueIds);
  const subjectById = new Map(authored.map((r) => [r.id, r.subject]));
  const queuedRows = authored.filter((r) => queuedIdSet.has(r.id));
  for (let i = 0; i < queuedRows.length; i += 10) {
    await Promise.all(
      queuedRows.slice(i, i + 10).map((r) =>
        ingestReport(supabase, {
          id: r.id,
          tenantId: user.tenantId,
          studentId: r.student_id,
          reportDate,
          subject: subjectById.get(r.id) ?? null,
          progress: input.progress?.trim() || null,
        }).catch(() => {}),
      ),
    );
  }

  return { ok: true, queued, conflicts, skippedExisting, absent, subjectOff, overflow, tooOld };
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
