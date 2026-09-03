import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchInChunks } from "@/lib/supabase/batch";
import { collectAuditNameIds, systemActorMatches, SYSTEM_ACTOR_PREFIX } from "../describe";

// 운영 감사로그 액션 키 + 라벨 — logAction 호출부와 뷰어 필터가 공유.
// ⚠️ 새 logAction 액션 키는 반드시 여기 등록(안 하면 뷰어에 영문 키 원문 노출) + describe.ts에 상세 한글화 추가.
export const AUDIT_ACTIONS = {
  // ── 학원 설정 감사 커버리지(2026-08-27 원장 점검) — 연동·프롬프트·강의실 수정·팝업 수정이
  //    통째로 무기록이었다. 특히 연동은 user_integrations에 updated_by조차 없어 흔적이 0이었다.
  integration_sync_toggle: "makeedu 자동 동기화 토글",
  integration_sheets_toggle: "구글 시트 내보내기 토글",
  integration_sheet_target: "구글 시트 대상 지정",
  integration_sync_now: "makeedu 지금 동기화",
  sheets_sync_now: "구글 시트 내보내기 실행",
  intake_push_enqueue: "makeedu 상담 역동기화",
  kiosk_device_register: "키오스크 기기 등록",
  kiosk_device_revoke: "키오스크 기기 폐기",
  kakao_channel_save: "카카오 알림톡 채널 설정",
  ai_prompt_save: "AI 프롬프트 저장",
  ai_prompt_reset: "AI 프롬프트 기본값 복원",
  classroom_update: "강의실 수정",
  notice_popup_update: "팝업 공지 수정",
  notice_popup_toggle: "팝업 공지 노출 전환",
  consultation_merge: "등록상담 병합",
  staff_role_change: "역할 변경",
  staff_delete: "직원 삭제",
  staff_password_reset: "직원 비밀번호 재설정",
  staff_email_change: "직원 이메일 변경",
  staff_name_change: "직원 이름 변경",
  staff_contract_extend: "근로계약 기입",
  staff_contract_update: "근로계약 수정",
  staff_contract_delete: "근로계약 삭제",
  staff_contract_pdf_extract: "근로계약 PDF 추출",
  staff_contract_file_add: "계약서 파일 첨부",
  class_review_create: "수업 평가 참관 생성",
  class_review_submit: "수업 평가 채점 제출",
  class_review_delete: "수업 평가 삭제",
  class_review_observer_replace: "수업 평가 평가자 변경",
  class_review_template_save: "수업 평가 문항 편집",
  class_review_template_delete: "수업 평가 문항 세트 삭제",
  // 운영 스크립트(scripts/staff-access/create-test-staff)가 직접 POST하는 액션 — 서버 액션이 아니라
  // logAction 스캔에 안 잡혀 라벨 없이 영문 "staff_create"가 화면에 그대로 떠 있었다(2026-08-20).
  staff_create: "직원 계정 생성",
  staff_intake_token_create: "직원 등록 QR 생성",
  staff_intake_token_toggle: "직원 등록 QR 열기·닫기",
  staff_intake_token_delete: "직원 등록 QR 삭제",
  staff_create_from_intake: "QR로 직원 등록",
  staff_contract_file_delete: "계약서 파일 삭제",
  // 본인이 자기 계정을 바꾼 경우(/me) — 위의 staff_*(관리자가 남의 계정을 바꿈)와 구분해 읽힌다.
  self_password_change: "내 비밀번호 변경",
  self_email_change: "내 이메일 변경",
  self_report_name_change: "수업보고서 발송용 이름 변경",
  invoice_create: "청구서 생성",
  exam_create: "시험 등록",
  exam_delete: "시험 삭제",
  exam_scores: "성적 일괄입력",
  payroll_upsert: "급여 정산",
  withdrawal_update: "퇴원 사유",
  student_import: "학생 일괄 등록",
  class_end_term: "반 종강 처리",
  class_reopen_term: "반 종강 취소",
  class_archive: "반 폐지",
  class_unarchive: "반 폐지 취소",
  class_handover_schedule: "담임 인수인계 예약",
  class_handover_cancel: "담임 인수인계 취소",
  class_update: "반 정보 수정",
  class_handover_apply: "담임 인수인계 적용",
  class_handover_bulk: "담임 일괄 인계(퇴사)",
  class_delegate: "반 임시 위임(결근 대체)",
  class_delegate_revoke: "반 임시 위임 해제",
  classroom_auto_assign: "강의실 자동배정",
  owner_settings_update: "학원 설정 변경",
  owner_subject_absorb: "과목 흡수·삭제",
  owner_subject_delete: "과목 삭제(미사용)",
  owner_integration_groups_update: "통합뷰 그룹 설정",
  owner_teacher_view_order_update: "강사뷰 강사 순서",
  notice_popup_create: "팝업 공지 생성",
  notice_popup_delete: "팝업 공지 삭제",
  classroom_create: "강의실 추가",
  classroom_delete: "강의실 삭제",
  classroom_archive: "강의실 숨김",
  classroom_restore: "강의실 복원",
  intake_token_create: "QR 접수 링크 생성",
  resume_view_unlock: "이력서 열람(재인증)",
  staff_create_from_resume: "이력서 → 직원 등록",
  staff_link_from_resume: "이력서 → 직원 연결",
  staff_roster_import: "직원명부 시트 이관",
  staff_roster_import_revert: "직원명부 이관 되돌림",
  classnote_notice_send: "학부모 공지 발송",
  classnote_notice_edit: "학부모 공지 수정",
  classnote_notice_delete: "학부모 공지 삭제",
  classnote_notice_revoke: "학부모 공지 게시취소",
  classnote_report_recall: "수업보고서 회수",
  ecs_attendance_clear: "출석 취소(ECS)",
  operating_periods_save: "세션 기간 저장",
  calendar_event_create: "일정 등록",
  calendar_event_update: "일정 수정",
  calendar_event_delete: "일정 삭제",
  calendar_tag_create: "캘린더 태그 추가",
  calendar_tag_update: "캘린더 태그 수정",
  calendar_tag_delete: "캘린더 태그 삭제",
  approval_submit: "전자결재 기안",
  approval_decide: "전자결재 처리",
  approval_withdraw: "전자결재 회수",
  approval_comment: "전자결재 댓글",
  approval_comment_delete: "전자결재 댓글 삭제",
  // 학생 기록 변경 전수 감사(2026-08-18) — "퇴원을 누가 했는지 역검수가 안 된다"(원장). 상태 전환·정보
  // 수정·삭제·수강 종료·관리 도구 일괄 처리까지 **학생 레코드를 바꾸는 모든 경로**가 actor를 남긴다.
  student_create: "학생 등록",
  student_update: "학생 정보 수정",
  student_delete: "학생 영구 삭제",
  student_withdraw: "학생 퇴원 처리",
  student_hold: "학생 휴원 처리",
  student_restore: "학생 재원 복구",
  enrollment_end: "수강 종료",
  enrollment_delete: "수업 이력 삭제",
  student_bulk_withdraw: "학생 일괄 퇴원(데이터 정리)",
  student_bulk_delete: "학생 일괄 삭제(데이터 정리)",
  // 2차 확장(2026-08-18 원장 "모든 행동에 기록이 남도록 범인 찾기 가능하게") — 수강을 바꾸는 나머지 경로.
  enrollment_assign: "반 배정",
  enrollment_move: "반 이동",
  enrollment_move_batch: "반 이동(시간표 일괄)",
  // 예약된(아직 시작 안 한) 수강 변경을 배너에서 고치거나 되돌린 기록 — 되돌릴 수 없는 이력이 아니라
  // "누가 언제 예약을 손댔나"의 역검수용이다(학생 기록을 바꾸는 경로는 전부 감사로그를 남긴다).
  enrollment_reschedule: "예약 변경(날짜·반)",
  enrollment_schedule_cancel: "예약 취소",
  enrollment_days_update: "등원 요일 수정",
  enrollment_dates_update: "수강 기간 수정",
  student_merge: "학생 병합",
  // 보강 빼기(2026-08-18) — 출결 보강 칸 + 저장된 보강 보고서를 지우는 경로. 기록을 없애는 동작이라
  // 누가 지웠는지가 특히 중요하다(원장 "다 삭제" 지시로 보고서 삭제까지 열렸다).
  makeup_remove: "보강 빼기(출결·보고서 삭제)",
  // 셔틀(0225a, 원장 2026-08-19) — 편성은 학생 등하원 동선이라 "누가 언제 뺐는지"가 사고 시 유일한
  // 역검수 근거다(정류장을 노선에서 빼면 배정 학생이 함께 사라진다). 등하원 기록도 남긴다.
  shuttle_stop_create: "셔틀 정류장 추가",
  shuttle_stop_update: "셔틀 정류장 수정",
  shuttle_stop_archive: "셔틀 정류장 정리",
  shuttle_vehicle_create: "셔틀 차량 추가",
  shuttle_vehicle_update: "셔틀 차량 수정",
  shuttle_run_create: "셔틀 회차 추가",
  shuttle_run_update: "셔틀 회차 수정",
  shuttle_run_delete: "셔틀 회차 삭제",
  shuttle_run_stop_add: "셔틀 노선에 정류장 추가",
  shuttle_run_stop_remove: "셔틀 노선에서 정류장 제거",
  shuttle_rider_assign: "셔틀 학생 배정",
  shuttle_rider_move: "셔틀 학생 정류장 이동",
  shuttle_rider_remove: "셔틀 학생 배정 해제",
  shuttle_boarding_record: "셔틀 등하원 기록",
  shuttle_boarding_clear: "셔틀 등하원 기록 삭제",
  shuttle_ride_exception_set: "셔틀 일회성 탑승 변경",
  shuttle_ride_exception_clear: "셔틀 일회성 탑승 변경 되돌림",
  shuttle_trip_start: "셔틀 운행 출발",
  shuttle_trip_end: "셔틀 운행 종료",
  shuttle_trip_reopen: "셔틀 운행 종료 되돌림",
  shuttle_stop_location: "셔틀 정류장 위치 지정",
  // '다른 강사 뷰'(열람 전용, 2026-08-19) — 누가 누구의 강사뷰를 열람했는지. 대상 강사에겐 안 보이는
  // 기능이라(원장 지시) 이 로그가 유일한 역검수 근거다.
  teacher_view_impersonate: "다른 강사 뷰 열람",
  staff_teacher_view_access: "강사뷰 접근 토글 변경",
  // 🔴 **화면 글자만** 바뀐다 — 담임·원어민 판정과 무관한 축이다(0248a 주석).
  staff_teacher_view_lang: "강사 화면 기본 언어 변경",
  // 회의록(2026-08-25 원장 제보 "감사로그에 녹음 관련 이력이 하나도 없다") — 빠뜨린 게 아니라
  // **처음부터 배선이 없던 영역**이었다(액션 9개 중 logAction 0). 🔴 특히 meeting_delete는 녹음·전사·
  // AI 분석이 통째로 사라지는데 누가 지웠는지 역추적할 방법이 0이었다(학생 퇴원 사고와 같은 모양).
  // 전사·재분석 재실행은 외부 API를 다시 태우는 일(비용)이라 반드시 남긴다.
  // ⚠️ 메모장 저장(updateMeetingNotepad)은 **일부러 안 남긴다** — 글 쓰는 중 반복해서 눌리는 칸이라
  //    남기면 감사로그가 그 한 사람 타이핑으로 뒤덮여 정작 삭제 같은 줄이 묻힌다.
  meeting_create_audio: "회의 녹음 업로드",
  meeting_create_text: "회의록 작성(메모)",
  meeting_delete: "회의록 삭제",
  meeting_retry_transcribe: "회의 전사 다시 실행",
  meeting_regenerate_analysis: "회의 AI 분석 다시 생성",
  meeting_title_update: "회의록 제목 수정",
  meeting_speakers_update: "회의 화자·직원 연결",
  meeting_report_edit: "회의 AI 리포트 수정",
  // 학생상담(같은 배선 누락, 액션 5개 중 0) — 위 consultation_merge(등록상담 병합)와 다른 화면이라
  // student_ 접두로 갈라 둔다. AI 케어 분석은 유료 호출이라 회의 재분석과 같은 결로 남긴다.
  student_consultation_create: "학생상담 기록 작성",
  student_consultation_update: "학생상담 기록 수정",
  student_consultation_delete: "학생상담 기록 삭제",
  student_consultation_follow_up: "학생상담 후속조치 처리",
  student_care_analysis: "AI 케어 분석 실행",
  // 시간표(개발중) 월별 계획(0232a) — class_schedules와 분리된 별도 표라, 본 시간표 감사 키와 섞이지
  // 않게 timetable_plan_ 접두로 갈라 둔다("계획"이라는 말을 라벨에 반드시 남길 것 — 원장이 감사로그에서
  // 본 시간표가 바뀐 줄로 읽으면 안 된다).
  timetable_plan_seed: "시간표 계획 만들기(현재 시간표 복사)",
  timetable_plan_copy: "시간표 계획 달 복사",
  timetable_plan_month_delete: "시간표 계획 달 삭제",
  timetable_plan_slot_upsert: "시간표 계획 칸 저장",
  timetable_plan_slot_delete: "시간표 계획 칸 삭제",
  timetable_plan_sheet_import: "시간표 계획 시트에서 가져오기",

  // 수학 강사 시트(MCS) — 학생별 월간 목표. 실제 진도는 원스크린이 쓰므로 여기 안 온다(읽기 전용 화면).
  mcs_goal_update: "수학 시트 학생 월간 목표 저장",

  // 재고관리(0242a) — 자산 등록/수정/상태 · 대여 시작/반납 · 실사 기록 · 소모품 수량. 상세는 describe.ts.
  inventory_asset_create: "자산 등록",
  inventory_asset_update: "자산 수정",
  inventory_asset_status: "자산 상태 변경",
  inventory_loan_out: "자산 대여 시작",
  inventory_loan_return: "자산 반납",
  inventory_audit: "자산 실사 기록",
  inventory_supply_update: "소모품 수량 수정",
  inventory_excel_import: "재고관리 엑셀 반영",
  // 분류(0247a) — 엑셀에 없는 분류를 적으면 확인 뒤 자동으로 만들어진다(삭제·이름변경 경로는 아직 없다).
  inventory_category_create: "자산 분류 추가",
} as const;
export type AuditActionKey = keyof typeof AUDIT_ACTIONS;

export const auditActionLabel = (a: string): string =>
  (AUDIT_ACTIONS as Record<string, string>)[a] ?? a;

type LogArgs = {
  action: AuditActionKey | string;
  targetType?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * 고가치 mutation을 감사로그에 기록(INSERT-only). 서버 액션 본 작업 성공 후 호출.
 * RLS createClient라 tenant_id=actor.tenantId 행만 INSERT(정책 통과). best-effort: 실패해도 본 작업 안 막음.
 */
export async function logAction(args: LogArgs): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const supabase = await createClient();
    await supabase.from("audit_logs").insert({
      tenant_id: user.tenantId,
      actor_id: user.id,
      actor_name: user.displayName,
      action: args.action,
      target_type: args.targetType ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? null,
    });
  } catch {
    // 감사 기록 실패는 본 작업을 막지 않음
  }
}

export type AuditLogRow = {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditLogsPageResult = {
  rows: AuditLogRow[];
  total: number;
  /** 조회 실패 원문(있으면 화면이 한글 배너+툴팁으로 표면화). 🔴 실패를 "0건"으로 위장하지 말 것 — 감사로그는 "없다"가 곧 답인 화면이라(예: "이 사람이 퇴원 처리한 기록 없음") 특히 해롭다(#89·B3). */
  error?: string;
  /** 이름 선해석이 limit에 걸려 잘렸으면 true — "김" 같은 흔한 글자 검색은 결과가 불완전할 수 있다. */
  nameLookupTruncated?: boolean;
};

/** 검색어·라벨 공통 정규화 — `,`·`(`·`)`는 or() 문법 구분자라 공백 치환(제거하면 "김,민"→"김민" 오검색) + 대소문자 무시. 라벨 쪽도 같은 규칙이어야 화면 라벨 "출석 취소(ECS)" 복붙이 찾힌다. */
function normalizeSearch(s: string): string {
  return s.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// 이름 선해석 상한 — "이" 검색 실측(학생 100+직원 14)에서 or 파라미터 4.2KB로 정상 동작 확인(414 여유).
// 직원(users)은 총원이 이 값 미만이라 이론상 최악(100+100)은 현실에서 안 나온다.
const NAME_LOOKUP_LIMIT = 100;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 형식 + 실존(2026-13-45 같은 값 거부 — timestamptz 파싱 에러가 400→"0건" 위장이 되는 것 방지). */
function isValidYmd(s: string | undefined): s is string {
  return typeof s === "string" && YMD.test(s) && !Number.isNaN(Date.parse(s));
}

export async function getAuditLogsPage(
  filter: { action?: string; q?: string; dateFrom?: string; dateTo?: string },
  page = 1,
  pageSize = 50,
): Promise<AuditLogsPageResult> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("audit_logs")
    .select("id, actor_name, action, target_type, target_label, metadata, created_at", {
      count: "exact",
    });
  if (filter.action && filter.action !== "all") q = q.eq("action", filter.action);
  // 기간 필터(달력) — 입력은 KST 날짜라 created_at(timestamptz) 경계에 +09:00을 명시(서버 UTC 오프셋 무관).
  let dateFrom = isValidYmd(filter.dateFrom) ? filter.dateFrom : undefined;
  let dateTo = isValidYmd(filter.dateTo) ? filter.dateTo : undefined;
  // 시작>종료 역전은 스왑 — 안내 없는 빈 결과("조건에 맞는 기록 없음")로 두지 않는다.
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00+09:00`);
  if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59.999+09:00`);

  // 텍스트 검색(원장 2026-08-18) — 실행자·대상 라벨 + 한글 액션 라벨 + **이름→id 선해석**.
  // 선해석이 필요한 이유: 학생 관련 로그(student_withdraw 등)는 이름이 화면에서만 보이고 DB엔
  // metadata의 uuid뿐이라, 라벨 ilike만으론 "엄채율" 검색이 그 행들을 못 찾는다. 학생·직원 이름을
  // 먼저 id로 풀어 metadata->>studentId/userId 매치에 넣는다(마이그레이션 0 — PostgREST 필터만).
  const rawQ = (filter.q ?? "").trim();
  const term = rawQ.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  // 구분자만 친 검색(","·"()" 등)은 정규화 후 빈 문자열 — 무필터 전체 목록으로 새지 않게 빈 결과로.
  if (rawQ && !term) return { rows: [], total: 0 };
  let nameLookupTruncated = false;
  let lookupError: string | undefined;
  if (term) {
    const [stuRes, usrRes] = await Promise.all([
      supabase.from("students").select("id").ilike("name", `%${term}%`).limit(NAME_LOOKUP_LIMIT),
      supabase.from("users").select("id").ilike("display_name", `%${term}%`).limit(NAME_LOOKUP_LIMIT),
    ]);
    // 선해석 실패 = 이름 매치 차원이 조용히 빠진 불완전 검색 — 삼키지 않고 표면화(B3 "?? []로 error 삼키기 금지").
    if (stuRes.error || usrRes.error) lookupError = (stuRes.error ?? usrRes.error)?.message;
    const ors = [`actor_name.ilike.*${term}*`, `target_label.ilike.*${term}*`];
    const lcTerm = term.toLowerCase();
    const actionKeys = Object.entries(AUDIT_ACTIONS)
      .filter(([, label]) => normalizeSearch(label).includes(lcTerm))
      .map(([key]) => key);
    if (actionKeys.length > 0) ors.push(`action.in.(${actionKeys.join(",")})`);
    // 실행자도 같은 규약 — 화면엔 "시스템 · 수업 평가 권한 부여"로 보이는데 DB엔 `system:grant-class-review`라
    // 보이는 대로 검색하면 0건이 나온다(액션 라벨 → 키 역인덱스와 같은 결).
    const sysActors = systemActorMatches(term);
    if (sysActors.allSystem) ors.push(`actor_name.ilike.${SYSTEM_ACTOR_PREFIX}*`);
    else for (const name of sysActors.names) ors.push(`actor_name.eq.${name}`);
    const studentIds = (stuRes.data ?? []).map((r) => r.id as string);
    if (studentIds.length > 0) {
      ors.push(`metadata->>studentId.in.(${studentIds.join(",")})`);
      ors.push(`metadata->>mergedStudentId.in.(${studentIds.join(",")})`);
      // 일괄 로그(metadata.studentIds 배열)도 학생 이름으로 찾히게 — cs(contains)는 id마다 조건 1개라
      // 소수 매치(=정확한 이름 검색)일 때만 편성. 흔한 글자 광역 검색은 개별 매치가 어차피 무의미하다.
      if (studentIds.length <= 10)
        for (const id of studentIds) ors.push(`metadata->studentIds.cs.["${id}"]`);
    }
    if (studentIds.length >= NAME_LOOKUP_LIMIT) nameLookupTruncated = true;
    const userIds = (usrRes.data ?? []).map((r) => r.id as string);
    if (userIds.length > 0) {
      ors.push(`metadata->>userId.in.(${userIds.join(",")})`);
      // 인수인계(newTeacherId)·담임 위임(delegateUserId)도 강사 이름 검색으로 찾히게(표시 측 collectAuditNameIds와 대칭).
      ors.push(`metadata->>newTeacherId.in.(${userIds.join(",")})`);
      ors.push(`metadata->>delegateUserId.in.(${userIds.join(",")})`);
    }
    if (userIds.length >= NAME_LOOKUP_LIMIT) nameLookupTruncated = true;
    q = q.or(ors.join(","));
  }

  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) return { rows: [], total: 0, error: error.message, nameLookupTruncated };
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetLabel: r.target_label,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
    error: lookupError,
    nameLookupTruncated,
  };
}

/**
 * 페이지 행들의 metadata에 든 학생/직원 uuid → 표시 이름 일괄 해석(상세 열 한글화).
 * best-effort: 조회 실패해도 뷰어를 막지 않음(이름만 빠진 채 표시).
 */
export async function getAuditNameMap(
  rows: Array<{ metadata: Record<string, unknown> | null }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { studentIds, userIds, classIds } = collectAuditNameIds(rows);
  if (studentIds.length === 0 && userIds.length === 0 && classIds.length === 0) return map;
  try {
    const supabase = await createClient();
    const [students, users, classes] = await Promise.all([
      fetchInChunks<{ id: string; name: string | null }>(studentIds, (c) =>
        supabase.from("students").select("id, name").in("id", c),
      ),
      fetchInChunks<{ id: string; display_name: string | null }>(userIds, (c) =>
        supabase.from("users").select("id, display_name").in("id", c),
      ),
      fetchInChunks<{ id: string; class_name: string | null }>(classIds, (c) =>
        supabase.from("classes").select("id, class_name").in("id", c),
      ),
    ]);
    for (const s of students) if (s.name) map.set(s.id, s.name);
    for (const u of users) if (u.display_name) map.set(u.id, u.display_name);
    for (const k of classes) if (k.class_name) map.set(k.id, k.class_name);
  } catch {
    // 이름 해석은 표시 보강일 뿐 — 실패 시 uuid 항목만 생략된 채 렌더
  }
  return map;
}
