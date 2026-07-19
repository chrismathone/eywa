"use server";

// 수업보고서(발송 관리) — ClassNote 발송 큐 관리 액션(재발송·멈춤복구). 쓰기는 lesson_reports 메뉴 권한(위임 반영).
// edutrix retrySelectedClassNoteReports/resetStuckClassNoteReports 이식. 과거일 재발송 사고 방지(isClassnoteAllowed).
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isClassnoteAllowed, isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { absenceKeyOf, getAbsenceBlockedKeys } from "@/features/onescreen/server/absence-gate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { STUCK_MINUTES } from "../classnote-queue";
import { IMPORT_FILTER, type ReportListFilters, type ReportListRow } from "../report-filters";

/**
 * 실패/오래됨 보고서 재발송 — queued로 되돌려 워커가 다시 잡게 한다. retry_count·error 초기화.
 * **과거일(전 달 1일 이전)은 재차단**(isClassnoteAllowed) — 옛 보고서 대량 오발송 방지(edutrix 사고 교훈).
 */
export async function retryClassnote(
  ids: string[],
): Promise<{ ok: boolean; requeued?: number; skipped?: number; absentSkipped?: number; dryRun?: boolean; error?: string }> {
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
  const { data: rows } = await supabase
    .from("lesson_reports")
    .select("id, report_date, subject, student_id, makeup")
    .in("id", ids.slice(0, 200))
    .not("classnote_status", "is", null)
    .neq("source", "edutrix_import")
    .is("revoked_at", null);
  // 발송 안전 스위치·허용 과목 — allowed 계산 전에 설정 조회(과목 게이트에 필요).
  const settings = await getTenantSettings();
  const allowed = (rows ?? []).filter(
    (r) =>
      isClassnoteAllowed(r.report_date as string) &&
      isClassnoteSubjectEnabled(r.subject as string | null, settings.report.classnoteSubjects),
  );
  const skipped = (rows?.length ?? 0) - allowed.length;
  if (allowed.length === 0) return { ok: true, requeued: 0, skipped };

  // 발송 안전 스위치 — 기본 OFF(dry-run). 원장 승인 전까지 실제 재발송(queued) 안 함.
  if (!settings.report.classnoteSendEnabled) {
    return { ok: true, requeued: 0, skipped, dryRun: true };
  }

  // 결석 게이트(#77) — 보고서 날짜에 결석으로 기록된 학생은 재발송도 차단(발송 후 출결이 결석으로
  // 정정된 건 포함). 보강 보고서(makeup)는 게이트 제외. 조회 실패 = fail-closed(아무것도 재큐잉 안 함).
  let requeueIds: string[];
  let absentSkipped: number;
  try {
    const gateTargets = allowed.filter((r) => !r.makeup);
    const blocked = await getAbsenceBlockedKeys(
      supabase,
      user.tenantId,
      gateTargets.map((r) => ({
        studentId: r.student_id as string,
        reportDate: (r.report_date as string).slice(0, 10),
        subject: r.subject as string | null,
      })),
    );
    requeueIds = allowed
      .filter(
        (r) =>
          r.makeup ||
          !blocked.has(
            absenceKeyOf({
              studentId: r.student_id as string,
              reportDate: (r.report_date as string).slice(0, 10),
              subject: r.subject as string | null,
            }),
          ),
      )
      .map((r) => r.id as string);
    absentSkipped = allowed.length - requeueIds.length;
  } catch {
    return { ok: false, error: "출결 확인에 실패했습니다 — 다시 시도하세요" };
  }
  if (requeueIds.length === 0) return { ok: true, requeued: 0, skipped, absentSkipped };

  const { error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
      classnote_retry_count: 0,
      classnote_error: null,
    })
    .in("id", requeueIds);
  if (error) return { ok: false, error: error.message };
  return { ok: true, requeued: requeueIds.length, skipped, absentSkipped };
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
  const { data: rows } = await supabase
    .from("lesson_reports")
    .select("id, report_date, subject, student_id, makeup")
    .in("id", capped)
    .is("classnote_status", null)
    .or("source.is.null,source.neq.edutrix_import")
    .is("revoked_at", null);

  const settings = await getTenantSettings();
  const eligible = (rows ?? []).filter(
    (r) =>
      isClassnoteAllowed(r.report_date as string) &&
      isClassnoteSubjectEnabled(r.subject as string | null, settings.report.classnoteSubjects),
  );
  if (eligible.length === 0) return { ok: true, queued: 0, conflicts: 0, skipped: capped.length };

  // 발송 안전 스위치 — 기본 OFF(dry-run). 어떤 행도 변경하지 않고 반환(동명이인 마킹도 안 함).
  if (!settings.report.classnoteSendEnabled) {
    return { ok: true, queued: 0, conflicts: 0, skipped: capped.length - eligible.length, dryRun: true };
  }

  // 결석 게이트(#77) — 보고서 날짜에 결석으로 기록된 학생은 관리자 최초 발송에서도 제외(원스크린
  // 클라 게이트·detectUnsentReports와 동일 규약). 보강 보고서(makeup)는 게이트 제외.
  // 조회 실패 = fail-closed(아무것도 큐잉 안 함).
  let sendable: typeof eligible;
  try {
    const gateTargets = eligible.filter((r) => !r.makeup);
    const blocked = await getAbsenceBlockedKeys(
      supabase,
      user.tenantId,
      gateTargets.map((r) => ({
        studentId: r.student_id as string,
        reportDate: (r.report_date as string).slice(0, 10),
        subject: r.subject as string | null,
      })),
    );
    sendable = eligible.filter(
      (r) =>
        r.makeup ||
        !blocked.has(
          absenceKeyOf({
            studentId: r.student_id as string,
            reportDate: (r.report_date as string).slice(0, 10),
            subject: r.subject as string | null,
          }),
        ),
    );
  } catch {
    return { ok: false, error: "출결 확인에 실패했습니다 — 다시 시도하세요" };
  }
  const absentSkipped = eligible.length - sendable.length;
  if (sendable.length === 0) return { ok: true, queued: 0, conflicts: 0, skipped: capped.length - absentSkipped, absentSkipped };

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
    if (error) return { ok: false, error: error.message };
    queued = (data ?? []).length;
  }
  return { ok: true, queued, conflicts, skipped: capped.length - queued - conflicts - absentSkipped, absentSkipped };
}

/**
 * 멈춤복구 — processing인데 STUCK_MINUTES 넘게 안 끝난 것(워커 크래시·PC 꺼짐)을 queued로 되돌려 재처리.
 */
export async function resetStuckClassnote(): Promise<{ ok: boolean; reset?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "보고서 관리 권한이 없습니다" };
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: "queued",
      classnote_queued_at: new Date().toISOString(),
      classnote_processing_at: null,
    })
    .eq("classnote_status", "processing")
    .lt("classnote_processing_at", cutoff)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, reset: (data ?? []).length };
}

const REPORT_PAGE_SIZE = 30;

/**
 * 보고서 목록 조회(수업보고서 Part C) — 강사·기간·상태·과목 필터 + 페이지네이션. 클라 필터 UI에서 호출(데이터 반환).
 * 읽기 게이트: lesson_reports 메뉴 접근(readonly 포함, canAccessTenant). RLS 테넌트 스코프.
 * 반 필터는 lesson_reports에 class_id가 없어 후속.
 */
export async function listReports(
  filters: ReportListFilters,
): Promise<{ ok: boolean; rows?: ReportListRow[]; total?: number; page?: number; pageSize?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) {
    return { ok: false, error: "보고서 관리 권한이 없습니다" };
  }
  const supabase = await createClient();
  const page = Math.max(0, filters.page ?? 0);

  let q = supabase
    .from("lesson_reports")
    .select("id, student_id, subject, report_date, created_at, classnote_sent_at, classnote_status, classnote_read_at, teacher_name, share_token, source", { count: "exact" })
    // 같은 수업일 내 최신 발송이 위로 — 이관분은 created_at이 cron 배치 시각으로 전부 동일(정렬 무의미)해
    // 실제 발송시각(classnote_sent_at) 우선 정렬. 미발송(sent_at NULL)은 NULLS LAST로 아래, created_at이 최종 tiebreak.
    .order("report_date", { ascending: false })
    .order("classnote_sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (filters.from) q = q.gte("report_date", filters.from);
  if (filters.to) q = q.lte("report_date", filters.to);
  // "이관" 필터는 source, 그 외는 classnote_status.
  if (filters.status === IMPORT_FILTER) q = q.eq("source", "edutrix_import");
  else if (filters.status) q = q.eq("classnote_status", filters.status);
  if (filters.teacher) q = q.eq("teacher_name", filters.teacher);
  if (filters.subject) q = q.eq("subject", filters.subject);
  // 읽음 필터 — "안읽음"은 판정 가능한 행만(발송 성공 + 매칭 키 + 읽음 없음). 매칭 키 없는 옛 이관분은
  // 동기화 불가 = "안읽음" 아님(report-filters.ts ReportListFilters.read 주석 참조).
  if (filters.read === "read") q = q.not("classnote_read_at", "is", null);
  else if (filters.read === "unread") {
    q = q
      .eq("classnote_status", "success")
      .is("classnote_read_at", null)
      // 매칭 가능: edutrix분은 edutrix_share_token 백필된 행만, native분(source≠edutrix_import, NULL 포함)은 항상
      .or("edutrix_share_token.not.is.null,source.is.null,source.neq.edutrix_import");
  }
  q = q.range(page * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE + REPORT_PAGE_SIZE - 1);

  const { data, count, error } = await q;
  if (error) return { ok: false, error: error.message };
  const list = data ?? [];
  const ids = [...new Set(list.map((r) => r.student_id as string))];
  const nameRows = await fetchInChunks<{ id: string; name: string }>(ids, (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const rows: ReportListRow[] = list.map((r) => ({
    id: r.id as string,
    studentName: nameById.get(r.student_id as string) ?? "(학생)",
    subject: r.subject as string | null,
    reportDate: r.report_date as string,
    createdAt: r.created_at as string | null,
    sentAt: r.classnote_sent_at as string | null,
    classnoteStatus: r.classnote_status as string | null,
    teacherName: r.teacher_name as string | null,
    shareToken: r.share_token as string | null,
    source: r.source as string | null,
    readAt: r.classnote_read_at as string | null,
  }));
  return { ok: true, rows, total: count ?? rows.length, page, pageSize: REPORT_PAGE_SIZE };
}
