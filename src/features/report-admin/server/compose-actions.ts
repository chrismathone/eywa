"use server";

// 관리자 "직접 작성·발송" — 관리자가 **임의 학생**의 수업보고서를 작성해 ClassNote로 발송.
// 강사 원스크린(saveLessonReport/saveAndQueueClassnote)과 동일 포맷·레일(lesson_reports → /r 캡처 → ClassNote)이나,
// 강사 소유(teacherOwnsStudent) 게이트 대신 **canWriteTenant('lesson_reports')** 로 인가한다(관리자는 학원 전체 발송 총괄).
// ⚠️ 발송 안전 가드는 강사 경로와 100% 동일하게 유지: dry-run 스위치 · 과목 opt-in/화이트리스트 · 동명이인 name_conflict ·
//    too_old · 취소/게시중 보호. RLS가 테넌트 격리(다른 테넌트 학생 접근 불가). source='admin'(강사 작성률 오염 방지).
import { normalizeNoneMarker } from "@/features/onescreen/none-marker";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { resolveReportDate } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { absenceKeyOf, getAbsenceBlockedKeys, isStudentAbsentForSend } from "@/features/onescreen/server/absence-gate";
import { ingestReport } from "@/features/progress/server/ingest";
import { parseMentSource, resolveMentSource, type MentSource } from "@/features/onescreen/ment-source";
import { mentSourceColumnReady } from "@/features/onescreen/server/ment-source-db";
import { BOARD_PREFIX } from "../notice-targets";
import { resolveReportClassId } from "./resolve-class";
import {
  classRouteActive,
  isSendClassRouteRow,
  NO_SEND_CLASS_ERROR,
  SEND_CLASS_SUBJECTS,
  sendClassRow,
} from "@/features/onescreen/send-class";
import {
  blockedForNoSendClass,
  classBoardLiveForStudent,
  explainBoardMissing,
  reportMakeupClassId,
  resolveMakeupSendClass,
} from "@/features/onescreen/server/send-class";
import { claimMakeupAnchorChange, finishMakeupAnchor, prepareMakeupAnchor } from "@/features/onescreen/server/makeup-anchor-sync";
import { makeupReportUpsertBlock } from "@/features/makeups/server/adapters/gates";
import { ensureMakeupAttendanceForReport, resolveMakeupOwner } from "@/features/attendance/server/makeup-pool";
import { MAKEUP_CHECK_REQUIRED_ERROR, makeupCheckPending } from "@/features/attendance/server/makeup-check-gate";
import { classnoteSendOn } from "@/features/owner/classnote-gate";

/**
 * 발송 상태를 쓸 때의 조건 — **워커가 집지도(processing) 보내지도(success) 않은 행만**(원스크린 actions.ts와 같은 값).
 * 🔴 맨 위의 processing·success 확인과 실제 쓰기 사이에 워커가 첫 글을 올릴 수 있다. 조건 없이 쓰면 success를 queued로 되돌려
 *    **같은 글이 한 번 더** 나간다(9/29 박세욱 — 강사 경로에서 실제로 난 사고. 관리자 경로에는 이 방어가 빠져 있었다).
 */
const CLASSNOTE_REQUEUE_OK = "classnote_status.is.null,classnote_status.not.in.(processing,success)";

/**
 * 조건부 쓰기가 0행이었을 때 — 지금 상태를 다시 읽어 **그 상태 그대로** 답한다(처리 중 / 이미 발송).
 * 그 밖(행이 사라짐·상태를 못 읽음)은 "이미 발송"이라고 지어내지 않고 오류로 돌려준다.
 */
async function unqueuedStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reportId: string,
  shareToken: string | undefined,
): Promise<{ ok: boolean; id?: string; shareToken?: string; status?: string; error?: string }> {
  const { data: now } = await supabase.from("lesson_reports").select("classnote_status").eq("id", reportId).maybeSingle();
  const st = (now?.classnote_status as string | null) ?? null;
  if (st === "processing" || st === "success")
    return { ok: true, id: reportId, shareToken, status: st === "processing" ? "processing" : "already_sent" };
  return { ok: false, id: reportId, shareToken, error: "발송 상태를 확인하지 못했습니다 — 저장은 됐습니다. 잠시 뒤 다시 시도하세요" };
}

export type AdminSaveReportInput = {
  studentId: string;
  reportDate?: string; // 대상 날짜(YYYY-MM-DD) — 빈값=오늘. 과거 날짜 작성·발송용(report_date=카드·ClassNote 게시일).
  subject: string; // 과목키(math/english…) — 관리자 발송은 필수(보드·게이트 결정. 반이 없을 때의 dedup 단위)
  /**
   * 이 보고서의 반(0134a) — 보고서 1건의 단위. 반 단위 대량발송은 고른 반을 그대로 싣고,
   * 개별 작성은 `resolveReportClassId`가 **모호하지 않을 때만** 채운다(모호하면 null = 과목 단위, 예전과 동일).
   */
  classId?: string | null;
  /**
   * 'ClassNote로 보낼 반'(0303a) — 반별 발송인데 보고서 반에 살아 있는 반 보드가 없을 때(보강·사라진 종강 반) 관리자가
   * 고른 반(원장 2026-09-30 *"학생 고르고 난 후에 반 고르기"*). 서버가 후보 안에 있는지 다시 확인한다.
   */
  classnoteClassId?: string | null;
  /**
   * 반 없는 보강의 **보강 반**(0171a `makeup_class_id`) — 원장 2026-09-30 *"보고서 반 = 출석부 반"*. 고른 반이 곧 발송 반이고
   * 출석부 보강 칸도 그 반에 선다. 비우면 옛 화면처럼 `classnoteClassId`(보낼 반 고르기)를 보강 반으로 받는다.
   */
  makeupClassId?: string | null;
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
  /** 멘트 작성 방식(0214a) — 클라 판정(자동작성 스냅샷 비교). 서버가 기존 라벨과 합쳐 최종 확정. */
  mentSource?: MentSource;
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
): Promise<{ ok: boolean; id?: string; shareToken?: string; error?: string; makeupClassId?: string | null; needsAnchor?: boolean }> {
  // 학생 존재(테넌트 스코프=RLS) 확인 — 크로스테넌트/삭제 학생 방어. probe와 독립이라 병렬(B4).
  const [{ data: stu }, mentReady] = await Promise.all([
    supabase.from("students").select("id").eq("id", input.studentId).maybeSingle(),
    mentSourceColumnReady(supabase),
  ]);
  if (!stu) return { ok: false, error: "학생을 찾을 수 없습니다" };

  const reportDate = resolveReportDate(input.reportDate); // 빈값·미래→오늘, 과거는 그대로(too_old 가드가 발송 범위 강제)

  // 옛 행 한 번 읽기 — 멘트 작성 방식(0214a) sticky 판정 + 보강 반(앵커) 판정 재료. 컬럼 없으면 멘트 칸만 뺀다(#95).
  const priorBase = supabase
    .from("lesson_reports")
    .select(
      mentReady
        ? "id, notes, ment_source, makeup_class_id, classnote_status, classnote_sent_at, created_by"
        : "id, makeup_class_id, classnote_status, classnote_sent_at, created_by",
    )
    .eq("student_id", input.studentId)
    .eq("report_date", reportDate);
  const { data: priorRows } = await (
    input.classId
      ? priorBase.eq("class_id", input.classId)
      : input.subject
        ? priorBase.is("class_id", null).eq("subject", input.subject)
        : priorBase.is("class_id", null).is("subject", null)
  ).limit(1);
  const prior = priorRows?.[0] as
    | {
        id: string;
        notes?: string | null;
        ment_source?: string | null;
        makeup_class_id: string | null;
        classnote_status: string | null;
        classnote_sent_at: string | null;
        created_by: string | null;
      }
    | undefined;
  const mentPatch = mentReady
    ? {
        ment_source: resolveMentSource({
          client: input.mentSource,
          prevSource: prior?.ment_source,
          prevNotes: prior?.notes,
          nextNotes: input.notes,
        }),
      }
    : {};

  /**
   * 🔴 반 없는 보강(관리자 직접 작성) — **보고서 반 = 출석부 반 = 발송 반**(원장 2026-09-30, 설계 h). 원스크린과 같은 함수:
   * 보강 반 = 관리자가 고른 반(`makeupClassId` · 옛 화면의 '보낼 반' `classnoteClassId`) → 없으면 옛 앵커. 받을 반은 학생이 다니는 반
   * (같은 과목·종강 전). 반별 발송 대상인데 반이 없으면 '반 미정'으로 막는다. 저장 뒤 그 반에 출결 칸을 맞춘다(예전엔 칸을 안 만들었다 — C8).
   */
  const isMakeupRow = !!input.makeup && !input.classId;
  const shownTeacher = input.teacherName?.trim() || user.displayName || null;
  let makeupAnchor: string | null = null;
  let priorAnchor: string | null = null;
  let anchorMove: Extract<Awaited<ReturnType<typeof prepareMakeupAnchor>>, { ok: true }>["move"] = null;
  if (isMakeupRow) {
    const prepared = await prepareMakeupAnchor(supabase, {
      tenantId: user.tenantId,
      candidatesFor: user.id,
      studentId: input.studentId,
      date: reportDate,
      subject: input.subject,
      wanted: input.makeupClassId ?? input.classnoteClassId ?? null,
      prior: prior
        ? {
            makeupClassId: prior.makeup_class_id ?? null,
            classnoteStatus: prior.classnote_status ?? null,
            classnoteSentAt: prior.classnote_sent_at ?? null,
            createdBy: prior.created_by ?? null,
          }
        : null,
      anchorRequired: async () =>
        SEND_CLASS_SUBJECTS.has(input.subject) && classRouteActive(await getTenantSettings(), shownTeacher),
    });
    if (!prepared.ok)
      return { ok: false, ...(prior ? { id: prior.id } : {}), error: prepared.error, ...(prepared.needsAnchor ? { needsAnchor: true } : {}) };
    makeupAnchor = prepared.anchor;
    priorAnchor = prepared.priorAnchor;
    anchorMove = prepared.move;
    // 옛 행의 반이 바뀌면 upsert 전에 조건부로 먼저 바꾼다(원스크린 저장과 같은 규칙 — 워커 claim과 둘 중 하나만 이긴다).
    if (prior && makeupAnchor && makeupAnchor !== priorAnchor) {
      const claimed = await claimMakeupAnchorChange({ tenantId: user.tenantId, reportId: prior.id, from: priorAnchor, to: makeupAnchor });
      if (!claimed.ok) return { ok: false, id: prior.id, error: claimed.error };
    }
  }

  const reportBlock = await makeupReportUpsertBlock({
    makeup: isMakeupRow, classId: input.classId || null, subject: input.subject,
    studentId: input.studentId, date: reportDate, creating: !prior, existingReportId: prior?.id ?? null,
  });
  if (reportBlock) return { ok: false, ...(prior ? { id: prior.id } : {}), error: reportBlock };

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
        // 자유입력 자리표시자(`-`·`X` 등)를 "없음" 하나로 표준화(none-marker.ts 규약, 원장 2026-07-23) —
        // 그대로 두면 학부모 카드에 "오늘 과제: -"가 나가고 AI 멘트가 그걸 사실로 받는다.
        homework_today: normalizeNoneMarker(input.homeworkToday),
        progress: input.progress || null,
        exam_info: input.examInfo || null,
        homework_score: normalizeNoneMarker(input.homeworkScore),
        daily_test: input.dailyTest || null,
        check_test: input.checkTest || null,
        attitude: input.attitude || null,
        teacher_name: shownTeacher,
        notes: input.notes || null,
        trend_note: input.trendNote || null,
        source: "admin",
        // 반 없는 보강만 앵커를 적는다('보낼 반'은 앵커의 복사본 — 게시된 행은 다시 적지 않는다, 회수가 옛 기록을 본다).
        ...(isMakeupRow ? { makeup_class_id: makeupAnchor } : {}),
        ...(isMakeupRow && makeupAnchor && !prior?.classnote_sent_at ? { classnote_class_id: makeupAnchor } : {}),
        ...mentPatch,
      },
      // 생성열 unit_key = coalesce(class_id::text, subject) — 0134a. 강사 경로와 같은 타깃.
      { onConflict: "tenant_id,student_id,report_date,unit_key" },
    )
    // teacher_name = 진도 점프 경고의 "같은 선생님" 축(2026-08-20) — 저장된 값을 그대로 되받아 넘긴다.
    // created_by = 보강 칸의 귀속 강사(소유자) 판정 재료(원스크린 훅과 같은 규칙 `resolveMakeupOwner`).
    .select("id, share_token, teacher_name, created_by")
    .single();
  if (error || !data) {
    // 먼저 바꿔 둔 반(claimMakeupAnchorChange)을 되돌린다 — 저장이 안 됐는데 반만 바뀌면 칸과 갈린다.
    if (prior && makeupAnchor && makeupAnchor !== priorAnchor)
      await claimMakeupAnchorChange({ tenantId: user.tenantId, reportId: prior.id, from: makeupAnchor, to: priorAnchor }).catch(() => undefined);
    return { ok: false, error: error?.message ?? "보고서 저장에 실패했습니다" };
  }

  // 진도 컨테이너 반영 — 비수학·진도없음·이미반영은 내부 skip. 실패해도 저장 유지(비치명적).
  try {
    await ingestReport(supabase, {
      id: data.id,
      tenantId: user.tenantId,
      studentId: input.studentId,
      reportDate,
      subject: input.subject || null,
      progress: input.progress || null,
      teacherName: data.teacher_name ?? null,
    });
  } catch {
    /* 진도 반영 실패는 저장을 막지 않음 */
  }

  /**
   * 🔴 보강 보고서 → 출석부 칸(원스크린 저장 훅과 **같은 함수**, 설계 h — 예전엔 관리자 작성 보강이 출결을 안 남겼다, C8).
   *  · 반 없는 보강 + 보강 반 = 그 반에 칸을 맞춘다(옮기고/세운다, 대신 보강이면 강사 몫 `taught_by`). 실패 = 저장 오류.
   *  · 반 없는 보강 + 보강 반 없음(반별 발송 대상이 아닌 과목·학원) = 종전 보이지 않는 보강 반(`ensureMakeupAttendanceForReport`).
   *  · 반이 붙은 보강(관리자가 그 반 보고서로 쓴 '정규+보강')은 대상이 아니다 — 보고서 반이 곧 그 반이고, 칸은 그 반 출결이 맡는다.
   * 귀속은 저장자(관리자)가 아니라 보고서 소유자(`created_by` → 표시 강사 이름, `pickMakeupOwner`).
   */
  if (isMakeupRow) {
    const owner = await resolveMakeupOwner({
      tenantId: user.tenantId,
      createdBy: (data.created_by as string | null | undefined) ?? null,
      teacherName: data.teacher_name ?? null,
      saver: { id: user.id, name: user.displayName ?? null },
    }).catch(() => null);
    if (makeupAnchor) {
      const fin = await finishMakeupAnchor(supabase, {
        tenantId: user.tenantId,
        reportId: data.id,
        studentId: input.studentId,
        date: reportDate,
        subject: input.subject,
        anchor: makeupAnchor,
        priorAnchor,
        move: anchorMove,
        ownerId: owner?.id ?? null,
        via: "admin_compose",
      });
      if (!fin.ok) return { ok: false, id: data.id, shareToken: data.share_token, error: fin.error };
    } else if (owner) {
      await ensureMakeupAttendanceForReport({
        tenantId: user.tenantId,
        teacherId: owner.id,
        teacherName: owner.name,
        studentId: input.studentId,
        subject: input.subject,
        date: reportDate,
      }).catch(() => undefined);
    }
  }

  /**
   * 감사로그 — 강사 경로(`saveLessonReport`)와 **같은 액션 키**를 쓰고 `via`로만 가른다.
   * "이 보고서를 누가 마지막으로 고쳤나"는 문이 어디였든 한 필터로 찾아야 하는 질문이라서다.
   * 🔴 여기는 **남의 학생** 보고서를 사무실이 직접 쓰는 자리다 — `lesson_reports`에 `updated_by`가
   *    없어 행만 봐서는 사무실이 손댔다는 사실이 전혀 안 남는다.
   * ⚠️ 내부 공용 함수라 저장·발송 두 진입점이 여기 한 번씩만 들른다(중복 없음).
   * ⚠️ 본문(notes)은 담지 않는다 — id·날짜·반이면 그 행을 되짚는다.
   */
  await logAction({
    action: "lesson_report_save",
    targetType: "lesson_report",
    metadata: {
      reportId: data.id,
      studentId: input.studentId,
      date: reportDate,
      subject: input.subject || null,
      classId: input.classId || null,
      via: "admin",
      ...(input.makeup ? { makeup: true } : {}),
      ...(isMakeupRow ? { makeupClassId: makeupAnchor } : {}),
    },
  });
  return { ok: true, id: data.id, shareToken: data.share_token, makeupClassId: makeupAnchor };
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
  // 🔴 저장 경로도 **발송 경로와 같은 반**을 붙여야 한다(적대 검수 확정 blocker).
  //    안 붙이면 '저장'은 class_id NULL 행을, '발송'은 반이 붙은 행을 만들어 **같은 수업에 2행**이 생긴다
  //    → 발송된 쪽엔 저장 때 붙인 첨부가 없고, 남은 고아 행은 벨이 '미발송'으로 재촉한다.
  //    (실측 2026-07-22: resolveReportClassId가 267 조합 중 266에서 반을 확정 — 예외가 아니라 기본 경로다.)
  const classId = input.classId ?? (await resolveReportClassId(supabase, {
    studentId: input.studentId,
    reportDate: resolveReportDate(input.reportDate),
    subject: input.subject,
    teacherName: input.teacherName,
  }));
  return upsertAdminReport(supabase, user, { ...input, classId });
}

/**
 * 관리자 직접 작성 + ClassNote 발송 — saveAndQueueClassnote(강사)와 **동일 가드 순서**:
 * 1) 인가 canWriteTenant  2) 저장 전 상태 pre-read(revoked/processing 보호)  3) upsert 저장
 * 4) dry-run 스위치 OFF → 'dry_run'(저장만)  5) 과목 게이트 → 'subject_off'  6) 동명이인 → 'name_conflict'(큐잉 차단)
 * 7) too_old → queued/too_old. 실제 게시는 로컬 워커가 'queued'를 폴링해 처리(비동기).
 */
export async function saveAndQueueAdminReport(
  input: AdminSaveReportInput,
): Promise<{
  ok: boolean;
  id?: string;
  shareToken?: string;
  status?: string;
  error?: string;
  /** status="needs_class"일 때 — 고를 수 있는 반. */
  candidates?: { id: string; name: string }[];
  /** status="needs_class"일 때 — 처음 골라 둘 반(메인 수업). */
  defaultClassId?: string | null;
  /** status="needs_class"일 때 — 보강 추가한 반인데 반 보드가 없어 다른 반으로 가야 한다(경고). */
  makeupClassName?: string | null;
}> {
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
  // 반 미정 보강 — 저장이 막혔다. 보낼 수 있는 반(학생이 다니는 같은 과목 반 · 반 보드 있음)을 후보로 돌려주면 화면이 고르게 하고,
  // 고른 반을 보강 반으로 실어 다시 보낸다(그 저장이 출석부 칸을 그 반에 세운다).
  if (!saved.ok && saved.needsAnchor) {
    const pick = await resolveMakeupSendClass(user.tenantId, input.studentId, reportDate, input.subject, null).catch(() => null);
    if (pick && !pick.ok && pick.reason === "choose")
      return { ok: false, status: "needs_class", candidates: pick.candidates, defaultClassId: pick.defaultId, makeupClassName: null, error: saved.error };
    return { ok: false, ...(pick && !pick.ok ? { status: "no_class" } : {}), error: pick && !pick.ok ? NO_SEND_CLASS_ERROR : saved.error };
  }
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "보고서 저장에 실패했습니다" };

  // 발송 안전 스위치(기본 OFF) — 원장 승인 전까지 저장만.
  const settings = await getTenantSettings();
  if (!classnoteSendOn(settings)) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "dry_run" };
  }
  // 과목 opt-in/화이트리스트 — 없으면 저장만.
  if (!isClassnoteSubjectEnabled(input.subject, settings.report.classnoteSubjects)) {
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "subject_off" };
  }
  // 보강 진행 여부 확인(원장 2026-10-27) — 보강이 든 보고서는 원스크린에서 '보강 했음/못 했음'을 고른 뒤에 보낸다(강사 경로와 같은 판정).
  if (
    input.makeup &&
    (await makeupCheckPending({
      tenantId: user.tenantId,
      studentId: input.studentId,
      date: reportDate,
      classId: classId ?? null,
      makeupClassId: saved.makeupClassId ?? null,
    }))
  ) {
    // 대기 중(queued) 재고 회수 — 안 지우면 거절 안내 직후 워커가 이전 대기분을 게시한다(아래 결석 게이트와 같다).
    if (prior?.classnote_status === "queued") {
      await supabase
        .from("lesson_reports")
        .update({ classnote_status: null, classnote_queued_at: null })
        .eq("id", saved.id)
        .eq("classnote_status", "queued");
    }
    return { ok: false, id: saved.id, shareToken: saved.shareToken, error: MAKEUP_CHECK_REQUIRED_ERROR };
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
    const { data: conflictRows } = await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "name_conflict",
        classnote_queued_at: null,
        classnote_error: "동명이인 감지 — 자동 발송 차단",
      })
      .eq("id", saved.id)
      // 그새 워커가 집었거나 보낸 행은 덮지 않는다 — 보낸 글을 '차단됨'으로 거짓 표시하지 않게(그 행을 '재발송'하면 중복 게시가 된다).
      .or(CLASSNOTE_REQUEUE_OK)
      .select("id");
    if (!conflictRows?.length) return await unqueuedStatus(supabase, saved.id, saved.shareToken);
    return { ok: true, id: saved.id, shareToken: saved.shareToken, status: "name_conflict" };
  }
  // 반별 발송(ClassNote 모듈 켜짐 · 수학은 늘 반별) — 🔴 원장 2026-09-30: 보고서 반 = 출석부 반 = 발송 반(원스크린과 같은 규칙).
  //  · 반이 붙은 보고서 = 그 반 보드로만. 이 학생이 받을 반 보드가 없으면 막는다(다른 반으로 보내지 않는다 — 반 보드 동기화 필요).
  //  · 반 없는 보강 = 보강 반(저장이 확인해 적은 앵커)의 반 보드로만. 보드가 없으면 반을 고르게 하고, 고른 반은 다시 저장을 지나
  //    새 보강 반이 된다(출석부 칸도 함께). 반 없는 정규 행(모호해 반을 못 정한 행)은 보낼 곳이 없다 — 막는다.
  const shownTeacher = input.teacherName?.trim() || user.displayName; // 보고서에 적히는 teacher_name과 같은 값(upsertAdminReport) — 경로 판정엔 더 쓰지 않는다(2026-11-05)
  const routeApplies = classRouteActive(settings, shownTeacher);
  let sendClassId: string | null = null;
  let sendClassVia: string | null = null;
  if (routeApplies && SEND_CLASS_SUBJECTS.has(input.subject)) {
    const unqueue = async () => {
      if (prior?.classnote_status === "queued")
        await supabase
          .from("lesson_reports")
          .update({ classnote_status: null, classnote_queued_at: null })
          .eq("id", saved.id)
          .eq("classnote_status", "queued");
    };
    const checkFail = {
      ok: false,
      id: saved.id,
      shareToken: saved.shareToken,
      status: "class_check_failed",
      error: "보낼 반을 확인하지 못해 발송하지 않았습니다 — 저장은 됐습니다. 다시 시도해 주세요",
    };
    if (classId) {
      const classLive = await classBoardLiveForStudent(user.tenantId, classId, input.studentId).catch(() => null);
      if (classLive === null) {
        await unqueue();
        return checkFail;
      }
      if (!classLive) {
        await unqueue();
        // 까닭을 가려 안내한다(원스크린과 같은 함수) — 기다리면 풀리는 까닭이면 그 반·학생의 동기화도 요청한다.
        const why = await explainBoardMissing(user.tenantId, classId, input.studentId, { request: true });
        return { ok: false, id: saved.id, shareToken: saved.shareToken, status: why.status, error: why.error };
      }
    } else if (!input.makeup) {
      await unqueue();
      return { ok: false, id: saved.id, shareToken: saved.shareToken, status: "no_class", error: NO_SEND_CLASS_ERROR };
    } else {
      let pick: Awaited<ReturnType<typeof resolveMakeupSendClass>>;
      try {
        pick = await resolveMakeupSendClass(user.tenantId, input.studentId, reportDate, input.subject, saved.makeupClassId ?? null);
      } catch {
        await unqueue();
        return checkFail;
      }
      if (!pick.ok) {
        await unqueue();
        return pick.reason === "choose"
          ? {
              ok: false,
              id: saved.id,
              shareToken: saved.shareToken,
              status: "needs_class",
              candidates: pick.candidates,
              defaultClassId: pick.defaultId,
              makeupClassName: pick.makeupClass?.name || null,
              error: pick.makeupClass
                ? `보강 반(${pick.makeupClass.name || "이름 없음"})에 이 학생의 ClassNote 반 보드가 없습니다 — 보강 반을 바꿔 주세요(저장은 됐습니다)`
                : "보강 반을 골라 주세요 — 저장은 됐습니다",
            }
          : { ok: false, id: saved.id, shareToken: saved.shareToken, status: "no_class", error: NO_SEND_CLASS_ERROR };
      }
      sendClassId = pick.classId;
      sendClassVia = pick.via;
    }
  }
  // too_old(전 달 1일 이전) 아니면 queued. 오늘 저장은 항상 통과하나 규약상 명시.
  const allowed = isClassnoteAllowed(reportDate);
  // 🔴 조건부 적재(compare-and-set) — 그새 워커가 집었거나 보냈으면 0행이고, 다시 올리지 않는다.
  const { data: queuedRows, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: allowed ? "queued" : "too_old",
      classnote_queued_at: allowed ? new Date().toISOString() : null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .eq("id", saved.id)
    .or(CLASSNOTE_REQUEUE_OK)
    .select("id");
  if (error) return { ok: false, error: humanizeDbError(error.message, "발송") };
  if (!queuedRows?.length) return await unqueuedStatus(supabase, saved.id, saved.shareToken);
  // 🔴 학부모에게 나가는 순간 — 위 조기 반환들(dry_run·subject_off·absent·name_conflict·already_sent·
  //    processing·revoked)은 아무것도 안 나간 것이라 여기 안 온다(강사 경로와 같은 규약).
  await logAction({
    action: "classnote_send",
    targetType: "lesson_report",
    metadata: {
      reportId: saved.id,
      studentId: input.studentId,
      date: reportDate,
      subject: input.subject,
      classId,
      ...(sendClassId ? { sendClassId, sendClassVia } : {}),
      via: "admin_compose",
      status: allowed ? "queued" : "too_old",
    },
  });
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
  /** 멘트 작성 방식(0214a) — 공용 본문의 판정(관리자가 직접 썼나/AI 자동작성인가). 대량은 신규 행만 만들어 sticky 불요. */
  mentSource?: MentSource;
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
  optoutSkipped?: number; // '수업보고서 미발송' 반이라 제외된 반 수(0174a) — 조용히 무시하지 않고 화면이 사유를 밝힌다
  overflow?: number; // 타깃 상한 초과로 잘린 수
  tooOld?: number; // 전 달 1일 이전 날짜라 발송 차단(too_old)된 수 — 개별/원스크린 경로와 동일 가드
  /** 반별 발송인데 보낼 반 보드가 없어 작성만 하고 큐에 안 올린 수(원장 2026-09-30) — 원스크린·직접 작성에서 반을 골라 보낸다. */
  noClass?: number;
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
  // ment_source probe(0214a)는 설정 조회와 독립 — 병렬(B4). 결과는 5단계(카드 작성)에서만 소비.
  const [settings, mentReady] = await Promise.all([getTenantSettings(), mentSourceColumnReady(supabase)]);
  const reportDate = resolveReportDate(input.reportDate); // 빈값·미래→오늘, 과거 그대로(아래 too_old 가드가 실발송 범위 강제)
  const allowedSubjects = settings.report.classnoteSubjects;

  // ── 1. 대상 (학생,과목,담당강사) 후보 해석 ──
  let targets: BulkTarget[] = [];
  let subjectOff = 0;
  let optoutSkipped = 0;
  // 감사로그 라벨용 이름 — 아래 조회에 컬럼만 얹어 모은다(추가 왕복 0). 대량 발송 한 줄에
  // "어느 반 · 누구에게 나갔나"가 없으면 되짚을 게 건수뿐이다.
  const sentClassNames: string[] = [];
  const studentNameById = new Map<string, string>();
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
    studentNameById.set(t.id as string, BULK_TEST_STUDENT_NAME);
  } else {
    const classIds = [...new Set(input.classIds ?? [])].slice(0, BULK_CLASS_CAP);
    if (!classIds.length) return { ok: false, error: "대상 반을 선택하세요" };
    // 🔴 서버 재검증(#77) — 화면에서 숨겨도 classIds를 직접 실어 보내면 통과한다. '수업보고서 미발송'
    //    반(0174a)은 **여기서 다시 거른다**. 조용히 빼지 않고 optoutSkipped로 사유를 돌려준다.
    const { data: classes } = await supabase
      .from("classes")
      .select("id, class_name, subject, teacher_id, report_optout")
      .in("id", classIds)
      .eq("is_active", true);
    optoutSkipped = (classes ?? []).filter((c) => c.report_optout === true).length;
    const sendableClasses = (classes ?? []).filter((c) => c.report_optout !== true);
    for (const c of sendableClasses) if (c.class_name) sentClassNames.push(c.class_name as string);
    const subjectByClass = new Map(sendableClasses.map((c) => [c.id as string, c.subject as string | null]));
    const teacherByClass = new Map(sendableClasses.map((c) => [c.id as string, c.teacher_id as string | null]));
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
    const students = await fetchInChunks<{ id: string; status: string; name: string | null }>(studentIds, (chunk) =>
      supabase.from("students").select("id, status, name").in("id", chunk),
    );
    const statusById = new Map(students.map((s) => [s.id, s.status]));
    for (const s of students) if (s.name) studentNameById.set(s.id, s.name);
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
  if (!targets.length) return { ok: true, queued: 0, conflicts: 0, skippedExisting: 0, subjectOff, optoutSkipped, overflow };

  // ── 2. 발송 안전 스위치(기본 OFF) — dry-run이면 저장/큐잉 없이 예정 인원만 반환 ──
  if (!classnoteSendOn(settings)) {
    return { ok: true, dryRun: true, wouldSend: targets.length, queued: 0, conflicts: 0, skippedExisting: 0, subjectOff, optoutSkipped, overflow };
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
  if (!fresh.length) return { ok: true, queued: 0, conflicts: 0, skippedExisting, subjectOff, optoutSkipped, overflow };

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
  if (!sendable.length) return { ok: true, queued: 0, conflicts: 0, skippedExisting, absent, subjectOff, optoutSkipped, overflow };

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
  // 멘트 작성 방식(0214a, mentReady는 함수 초입 병렬 probe) — 컬럼 없으면 생략(#95).
  // 대량은 기존 행을 전부 걸러낸(fresh) 신규 insert라 sticky 불요.
  const nowIso = new Date().toISOString();
  const rowsToAuthor = sendable.map((t) => ({
    tenant_id: user.tenantId,
    student_id: t.studentId,
    report_date: reportDate,
    subject: t.subject,
    class_id: t.classId, // 0134a — 반 단위(선택한 반). 테스트 학생 경로만 null.
    textbook: input.textbook?.trim() || null,
    makeup: input.makeup ?? false,
    homework_today: normalizeNoneMarker(input.homeworkToday), // 대량 작성도 같은 규약.
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
    ...(mentReady ? { ment_source: parseMentSource(input.mentSource) ?? null } : {}),
  }));
  // teacher_name까지 되받는다 — 진도 점프 경고의 "같은 선생님" 축(2026-08-20). 대량은 반 담당강사가
  // 행마다 달라 입력값을 다시 짝지으면 어긋나기 쉽다 → 저장된 값을 그대로 쓴다.
  const authored: { id: string; student_id: string; subject: string | null; teacher_name: string | null; class_id: string | null }[] = [];
  // ⚠️ 상태 확정 카운터를 **작성 루프보다 먼저** 선언한다 — 아래 감사로그 클로저가 중간 실패 경로에서도
  //    읽어야 하는데, 뒤에 선언하면 그 시점엔 TDZ라 로그 자체가 터진다.
  let conflicts = 0;
  let queued = 0;
  let tooOld = 0;
  let noClass = 0;
  const queuedIds: string[] = [];
  /**
   * 🔴 한 번 눌러 **최대 400명의 학부모에게** 같은 카드가 나가는 자리다 — 되돌릴 수 없으니 반드시 남긴다.
   * 🔴 **중간 실패 경로에서도** 부른다: 청크가 100건씩이라 3번째 청크가 실패해도 앞의 200건은 **이미
   *    학부모에게 나간다**. 성공 경로에만 달면 그 200건이 감사로그에 한 줄도 안 남는다(가장 되짚어야 할 사고).
   * ⚠️ 건별 400줄이 아니라 **한 줄 요약**(대량 처리 규약). 대신 되짚을 반 이름·학생 이름·건수를 담는다.
   * ⚠️ dry-run(발송 스위치 OFF)은 위에서 이미 반환했다 — 여기 오면 실제로 행을 만들었다는 뜻이다.
   * ⚠️ 본문(notes)은 담지 않는다(학부모에게 나간 문장 자체는 lesson_reports 행에 그대로 있다).
   */
  let bulkLogged = false;
  // 보강 반으로 '보낼 반'을 적은 행(감사로그 · logBulkSend가 읽으니 그보다 먼저 선언 — 원장 2026-09-30).
  const gateOut = { rewritten: [] as string[] };
  const logBulkSend = async (failed?: string) => {
    if (bulkLogged || authored.length === 0) return;
    bulkLogged = true;
    const queuedSet = new Set(queuedIds);
    const sentNames = authored
      .filter((r) => queuedSet.has(r.id))
      .map((r) => studentNameById.get(r.student_id))
      .filter((n): n is string => Boolean(n));
    await logAction({
      action: "classnote_bulk_send",
      targetType: "lesson_report",
      targetLabel: input.test ? `테스트(${BULK_TEST_STUDENT_NAME})` : sentClassNames.slice(0, 5).join(", ") || null,
      metadata: {
        date: reportDate,
        test: input.test ?? false,
        // 고른 반(미발송 반 제외 후) — 그 반에 재원생이 0명이면 실제 발송은 없을 수 있다(건수는 아래 필드).
        classIds: (input.classIds ?? []).slice(0, 20),
        classNames: sentClassNames.slice(0, 20),
        reportCount: authored.length,
        queued,
        studentNames: sentNames.slice(0, 20),
        conflicts,
        tooOld,
        ...(noClass ? { noClass } : {}),
        ...(gateOut.rewritten.length ? { makeupRewritten: gateOut.rewritten.slice(0, 50) } : {}),
        skippedExisting,
        absent,
        subjectOff,
        optoutSkipped,
        overflow,
        // 도중에 끊긴 발송 — 앞 청크는 이미 나갔다는 사실을 로그가 말해야 한다.
        ...(failed ? { failedMidway: true, error: failed } : {}),
      },
    });
  };
  for (let i = 0; i < rowsToAuthor.length; i += 100) {
    const { data, error } = await supabase
      .from("lesson_reports")
      .upsert(rowsToAuthor.slice(i, i + 100), { onConflict: "tenant_id,student_id,report_date,unit_key" })
      .select("id, student_id, subject, teacher_name, class_id");
    if (error) {
      // 앞 청크가 이미 행을 만들었을 수 있다(발송 상태는 아직 안 붙었지만 내용은 DB에 있다).
      await logBulkSend(humanizeDbError(error.message, "조회"));
      return { ok: false, error: humanizeDbError(error.message, "조회") };
    }
    authored.push(...((data ?? []) as typeof authored));
  }

  const conflictIds = authored.filter((r) => conflicted.has(r.student_id)).map((r) => r.id);
  // 보낼 반 게이트(미발송 일괄 발송·재발송과 같은 함수, 원장 2026-09-30) — 반별 발송인데 그 반에 이 학생이 받을 반 보드가
  // 없으면 **작성만 하고 큐에 올리지 않는다**(워커가 1인 보드로 흘리지 않게). 조회 실패 = 대상 행 전부 제외(fail-closed).
  const routeRows = authored.filter((r) => !conflicted.has(r.student_id) && isSendClassRouteRow(settings, r));
  let noClassIds: Set<string>;
  try {
    noClassIds = await blockedForNoSendClass(user.tenantId, routeRows.map(sendClassRow), gateOut);
  } catch {
    noClassIds = new Set(routeRows.map((r) => r.id));
  }
  noClass = noClassIds.size;
  const queueIds = authored.filter((r) => !conflicted.has(r.student_id) && !noClassIds.has(r.id)).map((r) => r.id);

  // ── 6. 상태 확정 — 동명이인 name_conflict / too_old(전 달 1일 이전) / 나머지 queued. .is(null) 경합 이중방어. ──
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
    if (allowed) queuedIds.push(...(data ?? []).map((r) => r.id as string));
    if (error) {
      // 🔴 여기서 끊겨도 **앞 청크는 이미 큐에 올라가 학부모에게 나간다** — 로그 없이 끝내면 안 된다.
      await logBulkSend(humanizeDbError(error.message, "발송"));
      return { ok: false, error: humanizeDbError(error.message, "발송") };
    }
    if (allowed) queued += (data ?? []).length;
    else tooOld += (data ?? []).length;
  }

  // ── 7. 진도 컨테이너 반영(수학·진도 있을 때만, 비치명적). 10건씩 동시. ──
  const queuedIdSet = new Set(queueIds);
  const subjectById = new Map(authored.map((r) => [r.id, r.subject]));
  const teacherById = new Map(authored.map((r) => [r.id, r.teacher_name]));
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
          teacherName: teacherById.get(r.id) ?? null,
        }).catch(() => {}),
      ),
    );
  }

  await logBulkSend();
  return { ok: true, queued, conflicts, skippedExisting, absent, subjectOff, optoutSkipped, overflow, tooOld, noClass };
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
    sendEnabled: classnoteSendOn(settings),
  };
}

/**
 * 관리자 직접 작성의 **보낼 반 고르기** 재료(원장 2026-09-30 *"학생 고르고 난 후에 반 고르기 나오는 식으로"*).
 * - `applies=false` = 반별 발송 대상이 아니다(ClassNote 모듈 꺼짐·경로 '기존'·수학 아님) — 화면에 아무것도 안 띄운다.
 * - `needed=false` = 보고서 반에 살아 있는 반 보드가 있다 — 그 반으로 간다(`reportClassName`만 보여 준다).
 * - `needed=true` = 고를 반 목록(`candidates`)과 기본값(`defaultId` = 메인 수업). 비어 있으면 발송 불가(`NO_SEND_CLASS_ERROR`).
 * 서버 발송(saveAndQueueAdminReport)이 **같은 함수로 다시** 확인한다 — 이건 화면 안내일 뿐이다([[#77]]).
 */
export async function getAdminSendClassOptions(args: {
  studentId: string;
  reportDate?: string;
  subject: string;
  teacherName?: string;
  makeup?: boolean;
}): Promise<{
  ok: boolean;
  applies?: boolean;
  needed?: boolean;
  reportClassName?: string | null;
  candidates?: { id: string; name: string }[];
  defaultId?: string | null;
  blockedReason?: string | null;
  /** 막힌 까닭이 '배정 중·새 반·학부모 가입 대기'다 — 발송을 누르면 서버가 막으면서 그 반·학생의 동기화를 요청한다(버튼을 잠그지 않는다). */
  requestable?: boolean;
  /** 보강 추가한 반(0171a)으로 간다 — `needed=false`와 함께(`reportClassName` = 그 반). */
  viaMakeup?: boolean;
  /** 보강 추가한 반인데 이 학생의 반 보드가 없어 다른 반으로 가야 한다 — 그 반 이름(경고 한 줄). */
  makeupClassName?: string | null;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!args.studentId || !args.subject) return { ok: true, applies: false };
  const settings = await getTenantSettings();
  const routeApplies = classRouteActive(settings, args.teacherName?.trim() || user.displayName);
  if (!routeApplies || !SEND_CLASS_SUBJECTS.has(args.subject)) return { ok: true, applies: false };
  const supabase = await createClient();
  const reportDate = resolveReportDate(args.reportDate);
  try {
    // 발송 경로와 같은 반 판정 — 발송이 쓰는 resolveReportClassId(보강 여부와 무관, saveAndQueueAdminReport와 동일).
    const classId = await resolveReportClassId(supabase, {
      studentId: args.studentId,
      reportDate,
      subject: args.subject,
      teacherName: args.teacherName,
    });
    // 🔴 원장 2026-09-30: 보고서 반 = 출석부 반 = 발송 반 — 발송(saveAndQueueAdminReport)과 같은 판정.
    if (classId) {
      const classLive = await classBoardLiveForStudent(user.tenantId, classId, args.studentId);
      if (classLive === null) return { ok: false, error: "보낼 반을 확인하지 못했습니다 — 다시 시도해 주세요" };
      const { data } = await supabase.from("classes").select("class_name").eq("id", classId).maybeSingle();
      const reportClassName = (data?.class_name as string | undefined) ?? null;
      // 반 보드가 없으면 다른 반으로 보내지 않는다 — 고를 반 없이 막는 사유만(반 보드 동기화 필요).
      // 까닭을 가려 적는다(미리 보기라 동기화는 요청하지 않는다 — 요청은 실제로 보낼 때).
      if (!classLive) {
        const why = await explainBoardMissing(user.tenantId, classId, args.studentId, { request: false });
        return { ok: true, applies: true, needed: true, candidates: [], defaultId: null, blockedReason: why.error, requestable: why.requestable, reportClassName };
      }
      return { ok: true, applies: true, needed: false, reportClassName };
    }
    if (!args.makeup)
      return { ok: true, applies: true, needed: true, candidates: [], defaultId: null, blockedReason: NO_SEND_CLASS_ERROR };
    // 반 없는 보강 — 보강 반(강사가 원스크린에서 정해 둔 앵커)이 곧 발송 반이다. 없거나 보드가 없으면 보강 반을 고른다(고른 반 = 새 보강 반).
    const makeupClassId = await reportMakeupClassId(user.tenantId, { studentId: args.studentId, reportDate, subject: args.subject });
    const pick = await resolveMakeupSendClass(user.tenantId, args.studentId, reportDate, args.subject, makeupClassId);
    if (pick.ok) {
      const { data } = await supabase.from("classes").select("class_name").eq("id", pick.classId).maybeSingle();
      return { ok: true, applies: true, needed: false, viaMakeup: true, reportClassName: (data?.class_name as string | undefined) ?? null };
    }
    const makeupClassName = pick.makeupClass?.name || null;
    if (!pick.candidates.length)
      return { ok: true, applies: true, needed: true, candidates: [], defaultId: null, blockedReason: NO_SEND_CLASS_ERROR, makeupClassName };
    return { ok: true, applies: true, needed: true, candidates: pick.candidates, defaultId: pick.defaultId, blockedReason: null, makeupClassName };
  } catch {
    return { ok: false, error: "보낼 반을 확인하지 못했습니다 — 다시 시도해 주세요" };
  }
}
