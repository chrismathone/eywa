// 활동 로그(activity_log) 표시 헬퍼 — 순수 함수(서버/클라 공용). DB 트리거가 남긴 원시 diff를 사람이 읽는 요약으로.
// 운영 enum 라벨(과목/학년 등)과 무관한 '컬럼 이름' 매핑이라 하드코딩 예외 아님(테넌트 설정 대상 아님).
import { normalizeRefund, refundFieldList } from "@/features/billing/refund-request";
import { reasonDisplay } from "@/features/withdrawals/types";
import { reasonDetailOf } from "@/features/withdrawals/reason-detail";

export type ActivityOp = "INSERT" | "UPDATE" | "DELETE";

/** 테이블 → 한글 도메인 라벨. */
export const ACTIVITY_TABLE_LABEL: Record<string, string> = {
  students: "학생",
  classes: "반",
  class_schedules: "시간표",
  enrollments: "수강",
  invoices: "수납",
  expenses: "지출",
  student_grades: "성적",
  exams: "시험",
  level_tests: "레벨테스트",
  student_consultations: "학생상담",
  enrollment_consultations: "신규 콜&상담",
  textbook_orders: "교재",
  users: "직원",
  academy_documents: "문서",
  meeting_minutes: "회의록",
  grade_goals: "성적목표",
  grade_comments: "학습코멘트",
  // 0084a 확장분
  attendance_records: "출결",
  lesson_reports: "수업리포트",
  student_memos: "학생메모",
  classrooms: "강의실",
  // ⚠️ 화면 라벨과 맞춘 이름이다 — 수납관리 안에서 이 표는 내내 "교재 단가표"였고,
  //    2026-09-16부터 "교재목록"은 **다른 표**(textbooks, 0266a)의 이름이다. 되돌리지 말 것.
  textbook_catalog: "교재 단가표",
  tuition_catalog: "수강료항목",
  tuition_quotes: "수강료견적",
  notice_popups: "공지팝업",
  announcements: "공지",
  staff_leaves: "휴가",
  payroll_records: "급여",
  reenrollment_campaign_targets: "재등록캠페인",
  english_levels: "영어레벨",
  intake_tokens: "QR접수링크",
  kiosk_devices: "키오스크",
};

const OP_LABEL: Record<ActivityOp, string> = { INSERT: "생성", UPDATE: "수정", DELETE: "삭제" };

/** 자주 나오는 컬럼 → 한글. 없으면 원본 컬럼명 노출(폴백). */
const COLUMN_LABEL: Record<string, string> = {
  name: "이름", display_name: "이름", grade: "학년", school: "학교", status: "상태",
  // 계정 보기 설정 — 0444a부터 트리거가 안 남긴다. 그 전에 쌓인 줄이 영문 칸 이름으로 뜨지 않게.
  ui_prefs: "화면 보기 설정",
  phone: "연락처", parent_phone: "학부모연락처", student_phone: "학생연락처", home_phone: "집전화",
  price: "금액", amount_total: "금액", amount: "금액", discount: "할인", due_date: "납기", period: "청구월",
  book_name: "교재명", class_name: "반이름", subject: "과목", teacher_id: "담당강사",
  classroom_id: "강의실", room: "강의실", start_time: "시작", end_time: "종료", day_of_week: "요일",
  registered_at: "등록", paid_at: "납부", ordered_at: "주문", system_role: "역할", job_title: "직급",
  email: "이메일", memo: "메모", notes: "메모", score: "점수", max_score: "만점", exam_date: "시험일",
  title: "제목", category: "분류", restricted: "열람제한", is_active: "활성", closed_at: "종강",
  withdrawn_at: "퇴원일", withdrawal_reason: "퇴원사유", withdrawal_detail: "세부 사유", withdrawal_memo: "종료 메모", registration_date: "등록일", exam_name: "시험명",
  // 등록상담(enrollment_consultations)
  prospect_name: "상담자", prospect_grade: "학년", prospect_school: "학교", parent_name: "학부모",
  parent_request: "요청사항", learning_history: "학습이력", career_goal: "희망진로", siblings: "형제자매",
  siblings_details: "형제자매", safety_notes: "안전메모", consultation_path: "유입경로", outcome: "상담결과",
  registration_status: "등록상태", payment_amount: "결제금액", payment_date: "결제일", registrar: "등록자",
  counselor: "상담자", non_registration_reason: "미등록사유", follow_up_date: "후속일", follow_up_content: "후속내용",
  gender: "성별", birth_date: "생년월일", parent_relation: "보호자관계", address: "주소", address_detail: "상세주소",
  // 원생 보호자2(s2_0024) — 원생 수정 화면의 칸 이름 그대로
  parent2_name: "보호자2 이름", parent2_phone: "보호자2 연락처", parent2_relation: "보호자2 관계",
  student_type: "학생유형", received_date: "접수일", consultation_date: "상담일", shuttle_bus_request: "셔틀요청",
  consulted_at: "상담일시", english_name: "영문이름", blood_type: "혈액형", zip_code: "우편번호",
  privacy_agreement: "개인정보동의", installment_agreement: "분납동의", processing_status: "처리상태",
  // 공통 추가
  teacher_name: "강사명", student_name: "학생", subject_progress: "진도", subject_details: "과목상세",
  homework: "과제", attendance_status: "출결", start_date: "시작일", end_date: "종료일",
  // 0084a 확장분(출결/리포트/메모/카탈로그/견적/공지/휴가/급여/캠페인/QR)
  session_date: "수업일", note: "메모", homework_required: "과제부여", homework_done: "과제완료",
  access_method: "기록방식", report_date: "리포트일", progress: "진도", homework_score: "과제점수",
  daily_test: "데일리테스트", check_test: "체크테스트", attitude: "태도", content: "내용", pinned: "고정",
  // 리포트 리치 필드(0089a·0091a·0096a) — colLabel 폴백으로 raw 영문 노출되던 갭(2026-07-10 리뷰 적발)
  homework_today: "오늘과제", textbook: "교재명", trend_note: "학습추세", exam_info: "시험정보", makeup: "보강",
  capacity: "정원", publisher: "출판사", book_detail: "교재상세", grade_level: "학년",
  expense_date: "지출일", vendor: "거래처", department: "부서", author: "작성자",
  payment_method: "결제수단", approval_status: "결재상태", line_items: "품목",
  body: "내용", audience: "대상", link_url: "링크", link_label: "링크명", priority: "우선순위",
  starts_at: "시작", ends_at: "종료", consultant: "상담담당", courses: "수강과정", extras: "추가항목",
  discounts: "할인", total_amount: "총액", leave_type: "휴가유형", starts_on: "시작일", ends_on: "종료일",
  reason: "사유", approved_by: "승인자", approved_at: "승인일시",
  base_amount: "기본급", hours_worked: "근무시간", hourly_amount: "시급정산", bonus: "상여",
  deduction: "공제", total: "합계", trigger_reason: "사유", contacted_at: "연락일", decided_at: "결정일",
  abbreviation: "약어", full_name: "이름", color: "색상", sort_order: "정렬", expires_at: "만료일",
  // 렌더 전수감사(2026-07-08)에서 원문 노출 확인분 — 수납 결제 상세·퇴원 메타·오디오 파이프라인(과거 행)
  amount_paid: "납부액", amount_discount: "할인액", billed_at: "청구일", card_company: "카드사",
  discount_reason: "할인사유", cash_receipt_number: "현금영수증", points_used: "적립금사용",
  withdrawal_metadata: "퇴원정보", is_transferred: "반이동", classnote_name: "클래스노트이름",
  request_date: "신청일", transcription: "전사", speaker_labels: "화자구분", audio_path: "오디오",
  audio_duration_sec: "오디오길이(초)", audio_size_bytes: "오디오용량",
  // 원생상담 반 매핑(0318a) — class_id는 uuid라 "반 변경"으로 축약된다(unreadableDiff).
  class_id: "반", class_source: "반 정하는 방식",
  // redact 대상 컬럼(트리거 0081a·0084a) — "X 변경"으로만 뜨므로 라벨 없으면 영문 그대로 노출된다
  hourly_rate: "시급", monthly_base: "월급여", form_data: "서식내용", print_payload: "인쇄본",
  ai_summary: "AI요약", share_token: "공유링크", token: "토큰", token_hash: "토큰",
  attachments: "첨부", payload: "내용",
};

/**
 * 영문 enum 값 → 한글(값 전체가 정확히 일치할 때만). 컬럼 무관 전역 매핑 — 실데이터 감사(2026-07-08)에서
 * "상태 active→inactive"·"unpaid→paid"·"비움→card" 같은 원문 노출을 확인해 도입. 의미가 겹치는 값
 * (pending·enrolled 등)은 모든 맥락에서 무난히 읽히는 일반어를 택했다. 미등록 값은 원문 노출(폴백).
 */
const VALUE_LABEL: Record<string, string> = {
  // 상태 공통
  pending: "대기", active: "활성", inactive: "비활성", completed: "완료", failed: "실패", idle: "대기",
  // 학생 상태
  prospect: "잠재", consulted: "상담완료", enrolled: "등록", on_hold: "휴원", withdrawn: "퇴원",
  // 수납/교재
  unpaid: "미납", partial: "부분납", paid: "완납", refunded: "환불", void: "무효",
  requested: "신청", ordered: "주문",
  // 결제수단
  card: "카드", transfer: "계좌이체", cash: "현금", other: "기타",
  // 출결
  present: "출석", absent: "결석", late: "지각", excused: "인정결석", makeup: "보강", early_leave: "조퇴",
  manual: "수동", kiosk: "키오스크", auto: "자동",
  // 등록상담 outcome / 재등록 캠페인
  scheduled: "예약", ai_done: "AI 완료", declined: "거절", no_show: "노쇼", contacted: "연락완료",
  // 오디오 파이프라인(과거 행)
  uploaded: "업로드됨", transcribing: "전사중", analyzing: "분석중",
  // 역할
  master: "원장", admin: "관리자", manager: "매니저", teacher: "강사", counselor: "상담사",
  accountant: "회계", viewer: "열람", student: "학생",
  // 요일
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
  // 공지 대상
  all: "전체", staff: "직원", office: "운영진", teachers: "강사", counselors: "상담", accounting: "회계",
  // 청구 분류
  tuition: "수강료", material: "교재", exam: "시험",
};

const colLabel = (c: string) => COLUMN_LABEL[c] ?? c;

/**
 * 칸마다 다른 값 표 — 영문 키로 저장되는 퇴원 사유·세부 사유는 **그 칸에서만** 한글로(전역 `VALUE_LABEL`에 넣으면 다른 칸의
 * 같은 글자까지 바뀐다). 모르는 값은 `shortVal` 그대로.
 */
const COLUMN_VALUE: Record<string, (v: string) => string | null> = {
  withdrawal_reason: (v) => reasonDisplay(v),
  withdrawal_detail: (v) => reasonDetailOf(v)?.label ?? null,
};
function colVal(col: string, v: unknown): string {
  const map = Object.hasOwn(COLUMN_VALUE, col) ? COLUMN_VALUE[col] : undefined;
  const mapped = map && typeof v === "string" && v.trim() ? map(v.trim()) : null;
  return mapped ?? shortVal(v);
}

function shortVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "비움";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "object") return "(내용)";
  const s = String(v);
  if (VALUE_LABEL[s]) return VALUE_LABEL[s];
  // ISO 타임스탬프("2026-07-08T11:33:32.691+…") → KST 시각(paid_at 등 — 원문은 기계 문자열)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime()))
      return d.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      });
  }
  return s.length > 24 ? s.slice(0, 24) + "…" : s;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 사람이 못 읽는 diff(uuid id / 객체↔객체)는 old→new 대신 "변경"으로 축약할지 판정. */
function unreadableDiff(old: unknown, next: unknown): boolean {
  const isUuid = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
  if (isUuid(old) || isUuid(next)) return true; // teacher_id 등 — uuid→uuid는 정보가 아님
  // 객체 또는 JSON 직렬화 문자열(이중 인코딩 jsonb — invoices.line_items 실측) 둘 다 "내용"으로 취급.
  const contentish = (v: unknown) =>
    (typeof v === "object" && v !== null) || (typeof v === "string" && /^[[{]/.test(v.trim()));
  return contentish(old) && contentish(next); // "(내용)→(내용)" 무의미 → "변경"
}

export type ActivityChange = { redacted?: true; old?: unknown; new?: unknown };

const CHANGES_CAP = 8; // 변경 목록 최대 표시 개수(초과분은 "외 N건")

/**
 * 환불요청서 form_data(중첩 jsonb)를 필드별 한글 변경 문장으로 펼침 — "총환불금액 300000→250000" 등.
 * old/new를 정규화 후 같은 인덱스로 비교(refundFieldList가 고정 순서·한글 라벨 보장). 영문 컬럼명 미노출.
 * form_data는 환불요청서(form_type='refund_request')만 트리거가 redact 해제(0085a) — 그 외 폼은 redacted로 들어와 여기 안 옴.
 */
function refundFormChanges(oldV: unknown, newV: unknown): string[] {
  const fa = refundFieldList(normalizeRefund(oldV));
  const fb = refundFieldList(normalizeRefund(newV));
  const out: string[] = [];
  for (let i = 0; i < fa.length; i++) {
    const ov = fa[i].value.trim();
    const nv = fb[i].value.trim();
    if (ov !== nv) out.push(`${fa[i].label} ${shortVal(ov)}→${shortVal(nv)}`);
  }
  return out;
}

/**
 * 활동 1건을 머리말 + 변경 목록으로 구조화 — 뷰어가 변경 1건이면 인라인, 여러 건이면 줄바꿈 리스트로.
 * 예: head="등록상담 「이주아」 수정", changes=["형제자매 있음→비움","희망진로 신약개발연구원→비움","과목상세 변경"].
 * form_data(환불요청서)는 필드별로 펼쳐지고, 그 외 jsonb/uuid는 "…변경"으로 축약. INSERT/DELETE는 changes=[](머리말만).
 */
export function activityDetail(
  table: string,
  op: ActivityOp,
  targetLabel: string | null,
  changed: Record<string, ActivityChange> | unknown,
): { head: string; changes: string[] } {
  const domain = ACTIVITY_TABLE_LABEL[table] ?? table;
  const who = targetLabel ? `「${targetLabel}」` : "";
  const head = `${domain} ${who} ${OP_LABEL[op]}`.replace(/\s+/g, " ").trim();
  if (op !== "UPDATE" || !changed || typeof changed !== "object") return { head, changes: [] };

  const raw: string[] = [];
  for (const [col, ch] of Object.entries(changed as Record<string, ActivityChange>)) {
    if (ch && typeof ch === "object" && "redacted" in ch && (ch as ActivityChange).redacted) {
      raw.push(`${colLabel(col)} 변경`);
      continue;
    }
    const c = ch as ActivityChange;
    // 환불요청서 서식 내용: 중첩 form_data(0085a redact 해제분)를 필드별 한글 변경으로 펼침.
    if (col === "form_data") {
      const fields = refundFormChanges(c.old, c.new);
      raw.push(...(fields.length ? fields : [`${colLabel(col)} 변경`]));
      continue;
    }
    if (unreadableDiff(c.old, c.new)) {
      raw.push(`${colLabel(col)} 변경`);
      continue;
    }
    raw.push(`${colLabel(col)} ${colVal(col, c.old)}→${colVal(col, c.new)}`);
  }

  const changes = raw.slice(0, CHANGES_CAP);
  const more = raw.length - changes.length;
  if (more > 0) changes.push(`외 ${more}건`);
  return { head, changes };
}

export const activityOpLabel = (op: ActivityOp) => OP_LABEL[op];

/** user-agent → 짧은 기기 라벨. 예: "Windows · Chrome". 미상은 "기기 미상". */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "기기 미상";
  const os = /Windows/i.test(ua) ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Android/i.test(ua) ? "Android"
    : /Mac OS X|Macintosh/i.test(ua) ? "Mac"
    : /Linux/i.test(ua) ? "Linux" : null;
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Whale/i.test(ua) ? "웨일"
    : /SamsungBrowser/i.test(ua) ? "삼성"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Safari\//i.test(ua) ? "Safari" : null;
  return [os, browser].filter(Boolean).join(" · ") || "기기 미상";
}
