"use server";

// 수업보고서(발송 관리) — ClassNote 발송 큐 관리 액션(재발송·멈춤복구). 쓰기는 lesson_reports 메뉴 권한(위임 반영).
// edutrix retrySelectedClassNoteReports/resetStuckClassNoteReports 이식. 과거일 재발송 사고 방지(isClassnoteAllowed).
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { absenceKeyOf, getAbsenceBlockedKeys } from "@/features/onescreen/server/absence-gate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { SENT_STATUS_SUCCESS, UNREAD_MATCHABLE_OR } from "../unread-filter";
import { parseMentSource } from "@/features/onescreen/ment-source";
import { mentSourceColumnReady } from "@/features/onescreen/server/ment-source-db";
import { STUCK_MINUTES } from "../classnote-queue";
import { IMPORT_FILTER, UNSENT_FILTER, reportOrderSpecs, sortByRating, type ReportListFilters, type ReportListRow } from "../report-filters";
import { hasTextBesidesMarkers } from "@/features/report-templates/image-slots";
import { getClassnoteQueue, type ClassnoteQueueView } from "./queries";
import { loadRatingPoints, loadReportRatings } from "./report-ratings";
import type { ReportRating } from "../report-rating";
import { canViewReportRatings } from "./rating-access";
import { isSendClassRouteRow, sendClassRow } from "@/features/onescreen/send-class";
import { blockedForNoSendClass } from "@/features/onescreen/server/send-class";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { makeupUncheckedIds } from "@/features/attendance/server/makeup-check-gate";

/**
 * 실패/오래됨 보고서 재발송 — queued로 되돌려 워커가 다시 잡게 한다. retry_count·error 초기화.
 * **과거일(전 달 1일 이전)은 재차단**(isClassnoteAllowed) — 옛 보고서 대량 오발송 방지(edutrix 사고 교훈).
 */
/**
 * 🔴 **빈 멘트 절대 가드 — 관리자 큐잉 경로판**(2026-07-30 적대검증에서 뚫려 있던 구멍).
 *
 * 강사 경로(sendRow·queueClassnote·일괄 발송)는 전부 빈 멘트를 막는데, **관리자 발송 콘솔은 안 막았다.**
 * 예전엔 저장이 폴백 템플릿을 몰래 채워 넣어 `notes`가 늘 비어 있지 않았기 때문에 드러나지 않았을 뿐이다.
 * 그 몰래 채우기를 끊은 지금(같은 날 수리), 멘트 없는 행을 관리자가 큐에 올리면 **워커 최종 관문이 거절 →
 * `failed` + 담당 강사에게 발송 실패 알림**이 간다. 큐에 올리기 전에 여기서 걸러 "왜 안 나갔는지"로 돌려준다.
 * (#77 — 한 레코드의 모든 발송 표면이 같은 게이트를 통과해야 한다.)
 */
function hasMent(r: { notes?: string | null }): boolean {
  // 영어 글의 자리 줄(인재원 그림·사진·PDF, image-slots.ts)은 글자가 아니다 — 자리 줄뿐인 글은 빈 멘트다(강사 경로의
  // isSlotOnlyEnglishNotes·미발송 게이트 `hasSendableMent`와 **같은 함수**. 수학 글엔 자리 줄이 없어 결과가 같다).
  return hasTextBesidesMarkers(r.notes);
}

/** 사람이 다시 보낼 수 있는 상태 — 큐 카드(실패·기한 초과·사람 해결)와 목록 행 재발송이 같은 집합을 쓴다. */
const RETRIABLE_STATUSES = ["failed", "too_old", "name_conflict", "blocked_shared"] as const;

export async function retryClassnote(
  ids: string[],
): Promise<{
  ok: boolean;
  requeued?: number;
  skipped?: number;
  absentSkipped?: number;
  /** 반별 발송인데 보낼 반이 없어 다시 올리지 않은 건수(원장 2026-09-30) — 원스크린·직접 작성에서 반을 골라 보낸다. */
  noClass?: number;
  /** 보강 진행 여부 확인 전이라 다시 올리지 않은 보강 보고서 건수(원장 2026-10-27). */
  makeupUnchecked?: number;
  dryRun?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!ids?.length) return { ok: false, error: "대상이 없습니다" };
  const supabase = await createClient();

  // 대상 보고서 날짜·과목 조회(과거일 + 과목 게이트 재확인). RLS 테넌트 스코프.
  // P0-1(2026-07-10 병행 발송 적대 검증): "재발송"은 발송 이력이 있는 행만 — classnote_status IS NULL
  // (한 번도 큐에 안 오른 행)과 이관(edutrix_import, Edutrix가 이미 학부모에게 발송한 것)은 id를 직접
  // 넘겨도 서버에서 거부. 이관 2,324건(윈도 내)이 큐에 오르는 과거 대량 오발송 재연 벡터 차단.
  // 취소(revoked_at)된 행도 제외 — 워커가 영원히 클레임 안 해 좀비 queued가 되던 구멍.
  // ⚠️ 임베드는 FK 이름을 명시한다(#94). 학생 이름은 **감사로그 라벨용** — 일괄 재발송 한 줄에
  //    "누구에게 다시 나갔나"가 안 적히면 되짚을 방법이 건수뿐이다(recall-actions와 같은 규약).
  // B3 — 최대 200개 id를 한 `.in()`에 싣지 않고 청크로 나눈다. 조회가 실패하면 "0건 발송 대기"로
  //    성공처럼 보이지 않게 실패를 돌려준다(fetchInChunks는 error를 던진다).
  let rows;
  try {
    rows = await fetchInChunks(ids.slice(0, 200), (chunk) =>
      supabase
        .from("lesson_reports")
        .select("id, report_date, subject, class_id, makeup_class_id, student_id, makeup, notes, teacher_name, students!lesson_reports_student_id_fkey(name)")
        .in("id", chunk)
        // 🔴 재발송은 **끝나지 못한 행만**(적대적 리뷰) — 목록 스냅샷이 옛 '실패'를 들고 있는 사이 워커가 이미
        //    게시했거나(success) 게시 중(processing/queued)인 행을 다시 queued로 돌리면 학부모에게 **두 번** 나간다.
        .in("classnote_status", [...RETRIABLE_STATUSES])
        .neq("source", "edutrix_import")
        .is("revoked_at", null),
    );
  } catch {
    return { ok: false, error: "보고서를 불러오지 못했습니다 — 다시 시도하세요" };
  }
  // 발송 안전 스위치·허용 과목 — allowed 계산 전에 설정 조회(과목 게이트에 필요).
  const settings = await getTenantSettings();
  const allowed = (rows ?? []).filter(
    (r) =>
      hasMent(r) && // 빈 멘트 절대 가드(위 주석)
      isClassnoteAllowed(r.report_date as string) &&
      isClassnoteSubjectEnabled(r.subject as string | null, settings.report.classnoteSubjects),
  );
  const skipped = (rows?.length ?? 0) - allowed.length;
  if (allowed.length === 0) return { ok: true, requeued: 0, skipped };

  // 발송 안전 스위치 — 기본 OFF(dry-run). 원장 승인 전까지 실제 재발송(queued) 안 함.
  if (!classnoteSendOn(settings)) {
    return { ok: true, requeued: 0, skipped, dryRun: true };
  }

  // 결석 게이트(#77) — 보고서 날짜에 결석으로 기록된 학생은 재발송도 차단(발송 후 출결이 결석으로
  // 정정된 건 포함). 보강 보고서(makeup)는 게이트 제외. 조회 실패 = fail-closed(아무것도 재큐잉 안 함).
  let requeueIds: string[];
  let absentSkipped: number;
  try {
    const gateTargets = allowed.filter((r) => !r.makeup);
    // 반 단위 판정(0134a) — 보고서에 반이 있으면 그 반 출결만 본다(없으면 예전대로 과목 단위).
    const keyOf = (r: (typeof allowed)[number]) => ({
      studentId: r.student_id as string,
      reportDate: (r.report_date as string).slice(0, 10),
      subject: r.subject as string | null,
      classId: (r.class_id as string | null) ?? null,
    });
    const blocked = await getAbsenceBlockedKeys(supabase, user.tenantId, gateTargets.map(keyOf));
    requeueIds = allowed
      .filter((r) => r.makeup || !blocked.has(absenceKeyOf(keyOf(r))))
      .map((r) => r.id as string);
    absentSkipped = allowed.length - requeueIds.length;
  } catch {
    return { ok: false, error: "출결 확인에 실패했습니다 — 다시 시도하세요" };
  }
  // 보강 진행 여부 확인 전인 보강 보고서는 다시 올리지 않는다(원장 2026-10-27 — 원스크린 발송 게이트와 같은 판정, makeup-check-gate.ts).
  const uncheckedIds = await makeupUncheckedIds(user.tenantId, allowed.filter((r) => requeueIds.includes(r.id as string)));
  const makeupUnchecked = uncheckedIds.size;
  if (makeupUnchecked) requeueIds = requeueIds.filter((id) => !uncheckedIds.has(id));
  if (requeueIds.length === 0) return { ok: true, requeued: 0, skipped, absentSkipped, ...(makeupUnchecked ? { makeupUnchecked } : {}) };

  // 보낼 반 게이트(미발송 일괄 발송과 같은 함수) — 반별 발송인데 보낼 반이 없으면 다시 올리지 않는다(워커가 1인 보드로 흘리지 않게).
  const requeueSet = new Set(requeueIds);
  const routeRows = allowed.filter((r) => requeueSet.has(r.id as string) && isSendClassRouteRow(settings, r));
  // 보강 반으로 '보낼 반'을 적은 행(감사로그 — 원장 2026-09-30).
  const gateOut = { rewritten: [] as string[] };
  let noClassIds: Set<string>;
  try {
    noClassIds = await blockedForNoSendClass(user.tenantId, routeRows.map(sendClassRow), gateOut);
  } catch {
    noClassIds = new Set(routeRows.map((r) => r.id as string));
  }
  const noClass = noClassIds.size;
  if (noClass) requeueIds = requeueIds.filter((id) => !noClassIds.has(id));
  if (requeueIds.length === 0)
    return noClass && !absentSkipped && !skipped && !makeupUnchecked
      ? { ok: false, requeued: 0, noClass, error: "보낼 반이 없어 다시 보내지 않았습니다 — 원스크린·직접 작성에서 반을 골라 보내세요" }
      : { ok: true, requeued: 0, skipped, absentSkipped, noClass, ...(makeupUnchecked ? { makeupUnchecked } : {}) };

  const { data: requeuedRows, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .in("id", requeueIds)
    // 조회와 갱신 사이에 워커가 집어 간 행은 건드리지 않는다(같은 조건을 갱신에도 — 원자적으로).
    .in("classnote_status", [...RETRIABLE_STATUSES])
    .select("id");
  if (error) return { ok: false, error: humanizeDbError(error.message, "재발송") };
  // 실제로 갱신된 행만 센다(사이에 워커가 집어 간 행은 빠진다 — 감사로그·토스트 숫자가 거짓이 되지 않게).
  requeueIds = (requeuedRows ?? []).map((r) => r.id as string);
  if (requeueIds.length === 0) return { ok: true, requeued: 0, skipped, absentSkipped, noClass, ...(makeupUnchecked ? { makeupUnchecked } : {}) };
  // 🔴 학부모 게시판에 **글이 하나 더 붙는** 동작이라 반드시 남긴다. 일괄이므로 **한 줄 요약**
  //    (건별 N줄 금지) — 대신 되짚을 id·이름을 함께 담는다(재발송은 최대 200건이라 id는 50개로 자른다).
  const requeuedSet = new Set(requeueIds);
  const names = allowed
    .filter((r) => requeuedSet.has(r.id as string))
    .map((r) => (r.students as { name?: string } | null)?.name)
    .filter((n): n is string => Boolean(n));
  await logAction({
    action: "classnote_resend",
    targetType: "lesson_report",
    targetLabel: names.slice(0, 5).join(", ") || null,
    metadata: {
      via: "admin_console",
      reportCount: requeueIds.length,
      studentNames: names.slice(0, 20),
      reportIds: requeueIds.slice(0, 50),
      ...(requeueIds.length > 50 ? { reportIdsTruncated: requeueIds.length - 50 } : {}),
      skipped,
      absentSkipped,
      ...(noClass ? { noClass } : {}),
      ...(makeupUnchecked ? { makeupUnchecked } : {}),
      ...(gateOut.rewritten.length ? { makeupRewritten: gateOut.rewritten.slice(0, 50) } : {}),
    },
  });
  return { ok: true, requeued: requeueIds.length, skipped, absentSkipped, noClass, ...(makeupUnchecked ? { makeupUnchecked } : {}) };
}

/**
 * 관리자 최초 발송 — 강사가 저장만 하고 발송 버튼을 안 누른 보고서(**classnote_status IS NULL**)를
 * 관리자가 목록 탭에서 골라 큐에 올린다(2026-07-10 원장 요청 — 발송 트리거가 강사에게만 있던 갭 해소).
 *
 * **중복발송 방어(하드필터)**: 발송 이력이 있는 행(queued/processing/success/failed/too_old/name_conflict)은
 * id를 직접 넘겨도 select 단계에서 제외 — 이미 발송된 건이 이 경로로 재게시되는 일이 구조적으로 없다.
 * 재발송은 retryClassnote(큐 카드) 별도 버튼이 담당(역할 분리). 마지막 update에도 `.is(null)` 재확인을
 * 걸어 동시 더블클릭·타 관리자 경합에도 한 번만 큐잉된다.
 *
 * 나머지 가드는 강사 발송 경로(saveAndQueueClassnote)와 동일: 이관(edutrix_import, Edutrix가 이미 학부모에게
 * 발송 — 미발송 표시 4,813건이 최대 오발송 벡터) 제외 · 취소(revoked) 제외 · dry-run 스위치 · 과목 opt-in ·
 * too_old(전 달 1일 이전) · 동명이인은 name_conflict 마킹(자동 발송 차단, 이름 구분 후 재시도).
 */
export async function sendClassnoteForUnsent(ids: string[]): Promise<{
  ok: boolean;
  queued?: number;
  conflicts?: number;
  skipped?: number;
  absentSkipped?: number;
  /** 멘트가 비어 큐잉하지 않은 건수 — 워커가 어차피 거절하므로 미리 거른다(사유를 화면에 밝힌다). */
  emptyMent?: number;
  /**
   * 반별 발송인데 **보낼 반이 정해지지 않아** 큐잉하지 않은 건수(원장 2026-09-30 *"담당 반이 없으면 보고서 발송 불가능하게"*) —
   * 보고서 반에 살아 있는 반 보드가 없고 '보낼 반'(0303a)도 비어 있는 행. 원스크린·직접 작성에서 반을 골라 보낸다.
   */
  noClass?: number;
  /** 보강 진행 여부 확인 전이라 큐잉하지 않은 보강 보고서 건수(원장 2026-10-27) — 원스크린에서 '보강 했음/못 했음'을 고른 뒤 보낸다. */
  makeupUnchecked?: number;
  dryRun?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  if (!ids?.length) return { ok: false, error: "대상이 없습니다" };
  const supabase = await createClient();
  const capped = ids.slice(0, 200);

  // 대상 조회 — 미발송 native만. source NULL(구컬럼 이전 행)은 native로 간주(현 DB 0건, too_old가 최종 방어).
  // B3 — 청크 조회 + 실패는 실패로(위 retryClassnote와 같은 규약).
  let rows;
  try {
    rows = await fetchInChunks(capped, (chunk) =>
      supabase
        .from("lesson_reports")
        // 학생 이름은 감사로그 라벨용(위 retryClassnote와 같은 이유). 임베드엔 FK 이름 명시(#94).
        .select("id, report_date, subject, class_id, makeup_class_id, student_id, makeup, notes, teacher_name, students!lesson_reports_student_id_fkey(name)")
        .in("id", chunk)
        .is("classnote_status", null)
        .or("source.is.null,source.neq.edutrix_import")
        .is("revoked_at", null),
    );
  } catch {
    return { ok: false, error: "보고서를 불러오지 못했습니다 — 다시 시도하세요" };
  }

  const settings = await getTenantSettings();
  const withMent = (rows ?? []).filter(hasMent); // 빈 멘트 절대 가드(위 주석) — 큐에 올리기 전에 거른다
  const emptyMent = (rows?.length ?? 0) - withMent.length;
  const eligible = withMent.filter(
    (r) =>
      isClassnoteAllowed(r.report_date as string) &&
      isClassnoteSubjectEnabled(r.subject as string | null, settings.report.classnoteSubjects),
  );
  if (eligible.length === 0) return { ok: true, queued: 0, conflicts: 0, skipped: capped.length - emptyMent, emptyMent };

  // 발송 안전 스위치 — 기본 OFF(dry-run). 어떤 행도 변경하지 않고 반환(동명이인 마킹도 안 함).
  if (!classnoteSendOn(settings)) {
    return { ok: true, queued: 0, conflicts: 0, skipped: capped.length - emptyMent - eligible.length, dryRun: true, emptyMent };
  }

  // 결석 게이트(#77) — 보고서 날짜에 결석으로 기록된 학생은 관리자 최초 발송에서도 제외(원스크린
  // 클라 게이트·detectUnsentReports와 동일 규약). 보강 보고서(makeup)는 게이트 제외.
  // 조회 실패 = fail-closed(아무것도 큐잉 안 함).
  let sendable: typeof eligible;
  try {
    const gateTargets = eligible.filter((r) => !r.makeup);
    // 반 단위 판정(0134a) — 위 retryClassnote와 같은 규약.
    const keyOf = (r: (typeof eligible)[number]) => ({
      studentId: r.student_id as string,
      reportDate: (r.report_date as string).slice(0, 10),
      subject: r.subject as string | null,
      classId: (r.class_id as string | null) ?? null,
    });
    const blocked = await getAbsenceBlockedKeys(supabase, user.tenantId, gateTargets.map(keyOf));
    sendable = eligible.filter((r) => r.makeup || !blocked.has(absenceKeyOf(keyOf(r))));
  } catch {
    return { ok: false, error: "출결 확인에 실패했습니다 — 다시 시도하세요" };
  }
  const absentSkipped = eligible.length - sendable.length;
  // 보강 진행 여부 확인 전인 보강 보고서는 올리지 않는다(원장 2026-10-27 — 원스크린 발송 게이트와 같은 판정, makeup-check-gate.ts).
  const uncheckedIds = await makeupUncheckedIds(user.tenantId, sendable);
  const makeupUnchecked = uncheckedIds.size;
  if (makeupUnchecked) sendable = sendable.filter((r) => !uncheckedIds.has(r.id as string));
  // 반별 발송(ClassNote 모듈 켜짐 · 수학은 늘 반별) — 보낼 반 보드가 없는 행은 **큐에 올리지 않는다**(원스크린과 같은 규칙).
  // 일괄에선 행마다 반을 고를 수 없으니 이미 정해진 '보낼 반'(0303a)이 있을 때만 보낸다. 판정 실패 = fail-closed(그 행 제외).
  const routeRow = (r: (typeof sendable)[number]) => isSendClassRouteRow(settings, r);
  // 판정 = blockedForNoSendClass(재발송·멈춤 복구와 같은 함수). 조회 실패는 throw → 대상 행 전부 제외(fail-closed).
  // 보강 반으로 '보낼 반'을 적은 행(감사로그 — 원장 2026-09-30).
  const gateOut = { rewritten: [] as string[] };
  let noClassIds: Set<string>;
  try {
    noClassIds = await blockedForNoSendClass(user.tenantId, sendable.filter(routeRow).map(sendClassRow), gateOut);
  } catch {
    noClassIds = new Set(sendable.filter(routeRow).map((r) => r.id as string));
  }
  const noClass = noClassIds.size;
  if (noClass) sendable = sendable.filter((r) => !noClassIds.has(r.id as string));
  if (sendable.length === 0)
    return {
      ok: true, queued: 0, conflicts: 0, skipped: capped.length - emptyMent - absentSkipped - noClass - makeupUnchecked,
      absentSkipped, emptyMent, noClass, ...(makeupUnchecked ? { makeupUnchecked } : {}),
    };

  // 동명이인 감지 — 학생별 1회(중복 제거), 25명 청크로 버스트 제한(학생당 3쿼리).
  const studentIds = [...new Set(sendable.map((r) => r.student_id as string))];
  const conflicted = new Set<string>();
  for (let i = 0; i < studentIds.length; i += 25) {
    const results = await Promise.all(
      studentIds.slice(i, i + 25).map(async (sid) => [sid, await hasClassnoteNameCollision(supabase, sid)] as const),
    );
    for (const [sid, hit] of results) if (hit) conflicted.add(sid);
  }
  const conflictIds = sendable.filter((r) => conflicted.has(r.student_id as string)).map((r) => r.id as string);
  const queueIds = sendable.filter((r) => !conflicted.has(r.student_id as string)).map((r) => r.id as string);

  let conflicts = 0;
  if (conflictIds.length) {
    const { data } = await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "name_conflict",
        classnote_queued_at: null,
        classnote_error: "동명이인 감지 — 자동 발송 차단",
      })
      .in("id", conflictIds)
      .is("classnote_status", null)
      .select("id");
    conflicts = (data ?? []).length;
  }
  let queued = 0;
  let queuedIds: string[] = [];
  if (queueIds.length) {
    const { data, error } = await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "queued",
        classnote_queued_at: new Date().toISOString(),
        classnote_processing_at: null,
        classnote_retry_count: 0,
        classnote_error: null,
      })
      .in("id", queueIds)
      .is("classnote_status", null) // 경합 이중 방어 — 그 사이 큐잉/발송된 행은 건드리지 않음
      .select("id");
    if (error) return { ok: false, error: humanizeDbError(error.message, "발송") };
    queued = (data ?? []).length;
    queuedIds = (data ?? []).map((r) => r.id as string);
  }
  // 🔴 관리자가 **강사 대신** 학부모에게 내보낸 기록 — 일괄이라 한 줄 요약(건별 금지).
  //    동명이인 차단(name_conflict)도 상태를 바꾸는 쓰기라 아무것도 안 나갔어도 함께 남긴다.
  if (queued > 0 || conflicts > 0) {
    const queuedSet = new Set(queuedIds);
    const names = sendable
      .filter((r) => queuedSet.has(r.id as string))
      .map((r) => (r.students as { name?: string } | null)?.name)
      .filter((n): n is string => Boolean(n));
    await logAction({
      action: "classnote_send",
      targetType: "lesson_report",
      targetLabel: names.slice(0, 5).join(", ") || null,
      metadata: {
        via: "admin_console",
        reportCount: queued,
        studentNames: names.slice(0, 20),
        reportIds: queuedIds.slice(0, 50),
        ...(queuedIds.length > 50 ? { reportIdsTruncated: queuedIds.length - 50 } : {}),
        conflicts,
        absentSkipped,
        emptyMent,
        ...(noClass ? { noClass } : {}),
        ...(gateOut.rewritten.length ? { makeupRewritten: gateOut.rewritten.slice(0, 50) } : {}),
      },
    });
  }
  return {
    ok: true,
    queued,
    conflicts,
    // E13 — 멘트 미작성(emptyMent)은 따로 세므로 "제외"에서 뺀다(같은 건이 두 사유로 두 번 세지던 것).
    skipped: capped.length - emptyMent - queued - conflicts - absentSkipped - noClass - makeupUnchecked,
    absentSkipped,
    emptyMent,
    noClass,
    ...(makeupUnchecked ? { makeupUnchecked } : {}),
  };
}

/**
 * 멈춤복구 — processing인데 STUCK_MINUTES 넘게 안 끝난 것(워커 크래시·PC 꺼짐)을 queued로 되돌려 재처리.
 */
export async function resetStuckClassnote(): Promise<{
  ok: boolean;
  reset?: number;
  /** 반별 발송인데 보낼 반이 없어 queued 대신 failed로 내린 건수(원장 2026-09-30). */
  noClass?: number;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  // 발송 안전 스위치·ClassNote 모듈(재발송·최초 발송과 같은 판정) — 꺼진 지점은 어떤 행도 큐에 되돌리지 않는다(검토 2026-11-12).
  const settings = await getTenantSettings();
  if (!classnoteSendOn(settings)) return { ok: true, reset: 0, noClass: 0 };
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  // 보낼 반 게이트(미발송 일괄 발송·재발송과 같은 함수) — 반별 발송인데 보낼 반이 없는 멈춘 행은 queued로 되돌리지 않고
  // **failed + 한글 사유**로 내린다(재발송 카드에 뜨고, 반을 골라 보낼 때까지 1인 보드로 새지 않는다).
  // processing에 그대로 두면 영영 멈춰 있으니 어느 쪽으로든 내려야 한다.
  const { data: stuck, error: sErr } = await supabase
    .from("lesson_reports")
    .select("id, subject, class_id, student_id, teacher_name")
    .eq("classnote_status", "processing")
    .lt("classnote_processing_at", cutoff)
    .limit(500);
  if (sErr) return { ok: false, error: humanizeDbError(sErr.message, "복구") };
  const routeRows = (stuck ?? []).filter((r) => isSendClassRouteRow(settings, r));
  // 보강 반으로 '보낼 반'을 적은 행(감사로그 — 원장 2026-09-30).
  const gateOut = { rewritten: [] as string[] };
  let noClassIds: Set<string>;
  try {
    noClassIds = await blockedForNoSendClass(user.tenantId, routeRows.map(sendClassRow), gateOut);
  } catch {
    noClassIds = new Set(routeRows.map((r) => r.id as string));
  }
  const toQueue = (stuck ?? []).map((r) => r.id as string).filter((id) => !noClassIds.has(id));
  // B3 — 최대 500개 id라 100개씩 나눠 갱신한다(한 `.in()`에 실으면 414).
  const data: { id: string }[] = [];
  for (let i = 0; i < toQueue.length; i += 100) {
    const res = await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "queued",
        classnote_queued_at: new Date().toISOString(),
        classnote_processing_at: null,
      })
      .in("id", toQueue.slice(i, i + 100))
      // 조회와 갱신 사이에 워커가 끝낸 행은 건드리지 않는다(같은 조건을 갱신에도).
      .eq("classnote_status", "processing")
      .lt("classnote_processing_at", cutoff)
      .select("id");
    if (res.error) return { ok: false, error: humanizeDbError(res.error.message, "복구") };
    data.push(...((res.data ?? []) as { id: string }[]));
  }
  let failedNoClass = 0;
  const noClassList = [...noClassIds];
  for (let i = 0; i < noClassList.length; i += 100) {
    const { data: fRows, error: fErr } = await supabase
      .from("lesson_reports")
      .update({
        classnote_status: "failed",
        classnote_processing_at: null,
        classnote_error: "보낼 반이 없어 발송하지 않았습니다 — 원스크린·직접 작성에서 반을 골라 보내세요",
      })
      .in("id", noClassList.slice(i, i + 100))
      .eq("classnote_status", "processing")
      .lt("classnote_processing_at", cutoff)
      .select("id");
    if (fErr) return { ok: false, error: humanizeDbError(fErr.message, "복구") };
    failedNoClass += (fRows ?? []).length;
  }
  const reset = data.length;
  // 멈춘 건을 다시 큐에 올리는 일 = **워커가 다시 게시를 시도**한다(학부모 표면에 닿는다).
  // 되돌린 게 없으면 남기지 않는다(버튼을 눌러도 대상이 0이면 아무 일도 안 일어난 것이다).
  if (reset > 0 || failedNoClass > 0) {
    await logAction({
      action: "classnote_stuck_reset",
      targetType: "lesson_report",
      metadata: {
        reportCount: reset,
        reportIds: data.slice(0, 50).map((r) => r.id),
        stuckMinutes: STUCK_MINUTES,
        ...(failedNoClass ? { noClass: failedNoClass } : {}),
        ...(gateOut.rewritten.length ? { makeupRewritten: gateOut.rewritten.slice(0, 50) } : {}),
      },
    });
  }
  return { ok: true, reset, noClass: failedNoClass };
}

/**
 * 발송 큐 현황 재조회(카드 자동 갱신용) — '진행 중'(대기·처리중)이 남아 있는 동안에만 클라가 주기 호출한다.
 * 페이지 전체 router.refresh는 활성 탭의 무거운 조회(작성률·목록)까지 다시 도니, 큐 섹션만 이 액션으로 교체한다(B7 취지).
 * 읽기 전용 = 열람 권한(canAccessTenant)만. 실패·무권한은 null → 카드가 직전 값을 그대로 유지(화면 깜빡임·오표시 없음).
 */
export async function refreshClassnoteQueue(days = 3): Promise<ClassnoteQueueView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return null;
  // days는 클라가 넘기는 값 — 카드가 쓰는 범위(1~14일)로 조인다(주기 호출이라 창을 넓히면 그대로 부하가 된다).
  const window = Number.isFinite(days) ? Math.min(14, Math.max(1, Math.trunc(days))) : 3;
  return getClassnoteQueue(window);
}

const REPORT_PAGE_SIZE = 30;
/** 이름 검색이 한 번에 받아들이는 학생 수 상한 — 넘으면 자르지 않고 "더 좁히라"고 되돌린다(위 주석). */
const STUDENT_SEARCH_CAP = 100;

/**
 * 보고서 목록 조회(수업보고서 Part C) — 강사·기간·상태·과목 필터 + 페이지네이션. 클라 필터 UI에서 호출(데이터 반환).
 * 읽기 게이트: lesson_reports 메뉴 접근(readonly 포함, canAccessTenant). RLS 테넌트 스코프.
 * 반(0134a class_id)은 **표시 + 정렬**까지 열려 있다(`classes!…class_id_fkey` to-one 임베드). 반 **필터**는
 * distinct 목록이 필요한데 B2상 전건 스캔 금지라 filter-options RPC 확장이 선행이다 — 후속.
 */
export async function listReports(
  filters: ReportListFilters,
): Promise<{ ok: boolean; rows?: ReportListRow[]; total?: number; page?: number; pageSize?: number; showRating?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) {
    return { ok: false, error: "보고서 관리 권한이 없습니다" };
  }
  const supabase = await createClient();
  const page = Math.max(0, filters.page ?? 0);
  // ment_source(0214a) 적용 여부 — 미적용이면 select·필터에서 빼서 목록이 죽지 않게(#95, probe 캐시 왕복 0).
  // 평점(0450a)은 서버 공통 문(코드 표시 스위치 ∧ 지점 report_rating ∧ 쓰기 권한)을 통과할 때만 싣는다.
  // 꺼진 지점·권한 없는 사람은 표를 읽지도 않고 행에 평점 칸 자체가 없다(#77).
  const [mentReady, canSeeRatings] = await Promise.all([
    mentSourceColumnReady(supabase),
    canViewReportRatings(user.tenantId, user.systemRole),
  ]);

  // 학생 이름 검색 — 이름은 이 표에 없는 값(students 조인)이라 **먼저 id로 해석**한 뒤 거른다.
  // ⚠️ 상한을 두고 **넘치면 조용히 자르지 않고 되돌려 말한다** — 잘라 버리면 "그 학생 보고서가 없다"는
  //    거짓 결과가 되고([[#89]]), 거대 `.in()`은 URL 414로 실패한다(B3).
  let studentIds: string[] | null = null;
  if (filters.student?.trim()) {
    const term = filters.student.trim();
    const { data: matched, error: nameError } = await supabase
      .from("students")
      .select("id")
      .ilike("name", `%${term}%`)
      .limit(STUDENT_SEARCH_CAP + 1);
    if (nameError) return { ok: false, error: humanizeDbError(nameError.message, "학생 검색") };
    const sids = (matched ?? []).map((s) => s.id as string);
    if (sids.length > STUDENT_SEARCH_CAP)
      return { ok: false, error: `"${term}"에 해당하는 학생이 너무 많습니다 — 이름을 더 입력해 주세요` };
    if (!sids.length) return { ok: true, rows: [], total: 0, page, pageSize: REPORT_PAGE_SIZE, showRating: canSeeRatings };
    studentIds = sids;
  }
  // 반 필터(0134a class_id) — 옵션은 0147a RPC가 "실제 보고서가 붙은 반"만 준다.
  // ⚠️ uuid 형식을 먼저 검사한다: 잘못된 값이 오면 PostgREST가 22P02(invalid input syntax) **영문 원문**을
  //    내고 그게 그대로 토스트에 뜬다(UI에 raw 에러 노출 금지 규칙 위반). 형식이 아니면 한글로 되돌린다.
  if (filters.classId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.classId)) {
    return { ok: false, error: "반 필터 값이 올바르지 않습니다 — 뷰 설정에서 반을 다시 골라 주세요" };
  }
  // 멘트 작성 방식 필터(0214a) — 강사 필터와 조합해 "그 선생님이 직접 쓴 멘트만". 값은 신뢰 경계에서 정규화.
  let mentFilter: ReturnType<typeof parseMentSource> = undefined;
  if (filters.mentSource) {
    mentFilter = parseMentSource(filters.mentSource);
    if (!mentFilter) return { ok: false, error: "멘트 작성 방식 필터 값이 올바르지 않습니다 — 뷰 설정에서 다시 골라 주세요" };
    // 미적용 상태에서 걸면 존재하지 않는 컬럼으로 400이 난다 — 조용히 무시(=거짓 '전체')하지 않고 사유를 말한다([[#89]]).
    if (!mentReady) return { ok: false, error: "멘트 작성 방식 필터는 데이터베이스 업데이트(0214a) 적용 후 쓸 수 있습니다" };
  }

  // ⚠️ `classes!lesson_reports_class_id_fkey(...)` = to-one 임베드(0134a class_id FK). 조인 1회라 별도
  //    조회가 없고, 반 정렬(reportOrderSpecs "class")이 이 임베드를 정렬 키로 쓴다. 반 없는 행은 null.
  // ⚠️ **FK 이름을 반드시 붙일 것.** 0171a가 `makeup_class_id`(보강 앵커)를 더하면서 lesson_reports→classes
  //    FK가 2개가 됐다 — 힌트 없는 `classes(...)`는 PostgREST가 어느 FK인지 못 정해 **HTTP 300 PGRST201로
  //    쿼리 전체가 실패**한다("more than one relationship was found"). 2026-08-03 목록이 통째로 안 뜬 원인.
  //    새 FK를 lesson_reports에 더할 땐 이 임베드가 여전히 유일하게 해석되는지 확인할 것.
  // ⚠️ 반대로 **정렬 문자열엔 `!FK`를 넣으면 안 된다** — order 파서가 '!'를 못 읽어 PGRST100(400)이다.
  //    select만 힌트로 확정하면 `order=classes(class_name)`은 그 임베드를 가리켜 정상 동작(둘 다 실측).
  const listCols: string =
    "id, student_id, subject, report_date, created_at, classnote_sent_at, classnote_status, classnote_read_at, teacher_name, share_token, source, class_id" +
    (mentReady ? ", ment_source" : "") +
    ", classes!lesson_reports_class_id_fkey(class_name)";
  // 필터 = **한 곳** — 평소 목록과 평점 정렬(번호 목록 · 그 페이지 행)이 같은 필터를 지난다(한쪽만 고치면 정렬한 목록과 건수가 어긋난다).
  const filtered = (cols: string, opts?: { count: "exact" }) => {
    let q = supabase.from("lesson_reports").select(cols, opts);
    if (studentIds) q = q.in("student_id", studentIds);
    if (filters.from) q = q.gte("report_date", filters.from);
    if (filters.to) q = q.lte("report_date", filters.to);
    // "이관" 필터는 source, "미발송"은 NULL(등호로 못 잡는다), 그 외는 classnote_status.
    if (filters.status === IMPORT_FILTER) q = q.eq("source", "edutrix_import");
    else if (filters.status === UNSENT_FILTER)
      // 발송 이력이 없는 native 보고서 = 알림·발송 큐 카드가 말하는 '미발송'과 같은 집합(이관분 제외).
      q = q.is("classnote_status", null).or("source.is.null,source.neq.edutrix_import");
    else if (filters.status) q = q.eq("classnote_status", filters.status);
    if (filters.teacher) q = q.eq("teacher_name", filters.teacher);
    // 담임 이름 부분검색 — 이름이 이 표의 컬럼(teacher_name)이라 조인·id 해석 없이 한 줄이다.
    // ⚠️ `%`·`_`는 ilike 와일드카드라 그대로 넣으면 "김_정"이 뜻밖의 이름을 긁는다 → 이스케이프.
    if (filters.teacherName?.trim()) {
      const term = filters.teacherName.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
      q = q.ilike("teacher_name", `%${term}%`);
    }
    if (filters.subject) q = q.eq("subject", filters.subject);
    if (filters.classId) q = q.eq("class_id", filters.classId);
    if (mentFilter) q = q.eq("ment_source", mentFilter);
    // 읽음 필터 — "안읽음"은 판정 가능한 행만(발송 성공 + 매칭 키 + 읽음 없음). 매칭 키 없는 옛 이관분은
    // 동기화 불가 = "안읽음" 아님(report-filters.ts ReportListFilters.read 주석 참조).
    if (filters.read === "read") q = q.not("classnote_read_at", "is", null);
    else if (filters.read === "unread") {
      q = q
        .eq("classnote_status", SENT_STATUS_SUCCESS)
        .is("classnote_read_at", null)
        // 매칭 가능: edutrix분은 edutrix_share_token 백필된 행만, native분(source≠edutrix_import, NULL 포함)은 항상.
        // 🔴 절 문자열은 [`unread-filter.ts`](../unread-filter) 단일 소스 — 운영실 집계가 같은 값을 쓴다.
        .or(UNREAD_MATCHABLE_OR);
    }
    return q;
  };

  // select 문자열이 동적(ment_source 조건부, 0214a)이라 supabase-js 타입 파서가 못 읽는다(GenericStringError)
  // → 행 타입을 명시 캐스트. 아래 매핑이 실제 소비하는 컬럼만 적는다(select와 함께 고칠 것).
  type DbRow = {
    id: string;
    student_id: string;
    subject: string | null;
    report_date: string;
    created_at: string | null;
    classnote_sent_at: string | null;
    classnote_status: string | null;
    classnote_read_at: string | null;
    teacher_name: string | null;
    share_token: string | null;
    source: string | null;
    class_id: string | null;
    ment_source?: string | null;
    classes?: unknown;
  };
  let list: DbRow[];
  let total: number;
  if (filters.sort === "rating" && canSeeRatings) {
    // 평점 정렬(2026-10-26 원장) — 평점 표는 정책 0개(쓰기 권한자만 서버가 읽는다)라 PostgREST 임베드로 줄 세울 수 없다.
    // 그래서 ① 같은 필터의 보고서 번호 전부(fetchAllPaged — 1,000행 침묵 절단 방지 #54) ② 지점의 지금 기준 평점 전부를 받아
    // 서버에서 줄 세우고 ③ 그 페이지 30건만 다시 읽는다. 평점 없는 보고서는 방향과 무관하게 뒤(규약 ①).
    let order: { id: string; report_date: string; created_at: string | null }[];
    let points: Map<string, number>;
    try {
      [order, points] = await Promise.all([
        fetchAllPaged<{ id: string; report_date: string; created_at: string | null }>((from, to) =>
          filtered("id, report_date, created_at").order("id").range(from, to) as unknown as PromiseLike<{
            data: { id: string; report_date: string; created_at: string | null }[] | null;
            error: { message: string } | null;
          }>,
        ),
        loadRatingPoints(user.tenantId),
      ]);
    } catch (e) {
      return { ok: false, error: humanizeDbError(e instanceof Error ? e.message : String(e), "조회") };
    }
    const sorted = sortByRating(order, points, filters.dir ?? "asc");
    total = sorted.length;
    const pageIds = sorted.slice(page * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE + REPORT_PAGE_SIZE).map((r) => r.id);
    if (!pageIds.length) return { ok: true, rows: [], total, page, pageSize: REPORT_PAGE_SIZE, showRating: canSeeRatings };
    const { data, error } = await filtered(listCols).in("id", pageIds);
    if (error) return { ok: false, error: humanizeDbError(error.message, "조회") };
    const at = new Map(pageIds.map((id, i) => [id, i]));
    list = ((data ?? []) as unknown as DbRow[]).sort((x, y) => (at.get(x.id) ?? 0) - (at.get(y.id) ?? 0));
  } else {
    // 정렬은 **서버에서** — 30건씩 끊어 주는 목록이라 화면에서 정렬하면 그 페이지 안에서만 정렬된다.
    // 기본값·헤더 클릭 모두 순수 함수(reportOrderSpecs)가 결정(동률 tiebreak 포함 — 페이징 중복/누락 방지).
    // 평점 정렬을 볼 수 없는 계정이 'rating'을 보내면 기본 정렬로 돌아간다(reportOrderSpecs의 default).
    let q = filtered(listCols, { count: "exact" });
    for (const o of reportOrderSpecs(filters.sort, filters.dir)) {
      q = q.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
    }
    q = q.range(page * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE + REPORT_PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (error) return { ok: false, error: humanizeDbError(error.message, "조회") };
    list = (data ?? []) as unknown as DbRow[];
    total = count ?? list.length;
  }
  const ids = [...new Set(list.map((r) => r.student_id as string))];
  // 학생 이름과 평점은 서로 독립 — 함께 받는다(B4). 평점 조회는 실패해도 빈 값이라 목록을 막지 않는다.
  const [nameRows, ratingById] = await Promise.all([
    fetchInChunks<{ id: string; name: string }>(ids, (chunk) =>
      supabase.from("students").select("id, name").in("id", chunk),
    ),
    canSeeRatings
      ? loadReportRatings(user.tenantId, list.map((r) => r.id))
      : Promise.resolve(new Map<string, ReportRating>()),
  ]);
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  // to-one 임베드는 객체로 온다(실측). 관계 추론이 배열로 잡히는 경우까지 견디게 both를 받는다.
  const embeddedClassName = (v: unknown): string | null => {
    const one = Array.isArray(v) ? v[0] : v;
    return (one as { class_name?: string | null } | null)?.class_name ?? null;
  };
  const rows: ReportListRow[] = list.map((r) => ({
    id: r.id as string,
    studentName: nameById.get(r.student_id as string) ?? "(학생)",
    subject: r.subject as string | null,
    className: embeddedClassName((r as { classes?: unknown }).classes),
    reportDate: r.report_date as string,
    createdAt: r.created_at as string | null,
    sentAt: r.classnote_sent_at as string | null,
    classnoteStatus: r.classnote_status as string | null,
    teacherName: r.teacher_name as string | null,
    shareToken: r.share_token as string | null,
    source: r.source as string | null,
    readAt: r.classnote_read_at as string | null,
    // 0214a 미적용이면 select에 없어 undefined — 열 표시는 mentSourceReady(옵션)가 따로 게이트한다.
    mentSource: (r as { ment_source?: string | null }).ment_source ?? null,
    ...(canSeeRatings ? { rating: ratingById.get(r.id) ?? null } : {}),
  }));
  return { ok: true, rows, total, page, pageSize: REPORT_PAGE_SIZE, showRating: canSeeRatings };
}
