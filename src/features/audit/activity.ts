// 활동 로그(activity_log) 표시 헬퍼 — 순수 함수(서버/클라 공용). DB 트리거가 남긴 원시 diff를 사람이 읽는 요약으로.
// 운영 enum 라벨(과목/학년 등)과 무관한 '컬럼 이름' 매핑이라 하드코딩 예외 아님(테넌트 설정 대상 아님).

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
  enrollment_consultations: "등록상담",
  textbook_orders: "교재",
  users: "직원",
  academy_documents: "문서",
  meeting_minutes: "회의록",
  grade_goals: "성적목표",
  grade_comments: "학습코멘트",
};

const OP_LABEL: Record<ActivityOp, string> = { INSERT: "생성", UPDATE: "수정", DELETE: "삭제" };

/** 자주 나오는 컬럼 → 한글. 없으면 원본 컬럼명 노출(폴백). */
const COLUMN_LABEL: Record<string, string> = {
  name: "이름", display_name: "이름", grade: "학년", school: "학교", status: "상태",
  phone: "연락처", parent_phone: "학부모연락처", student_phone: "학생연락처", home_phone: "집전화",
  price: "금액", amount_total: "금액", amount: "금액", discount: "할인", due_date: "납기", period: "청구월",
  book_name: "교재명", class_name: "반이름", subject: "과목", teacher_id: "담당강사",
  classroom_id: "강의실", room: "강의실", start_time: "시작", end_time: "종료", day_of_week: "요일",
  registered_at: "등록", paid_at: "납부", ordered_at: "주문", system_role: "역할", job_title: "직급",
  email: "이메일", memo: "메모", notes: "메모", score: "점수", max_score: "만점", exam_date: "시험일",
  title: "제목", category: "분류", restricted: "열람제한", is_active: "활성", closed_at: "종강",
  withdrawn_at: "퇴원일", withdrawal_reason: "퇴원사유", registration_date: "등록일", exam_name: "시험명",
  // 등록상담(enrollment_consultations)
  prospect_name: "상담자", prospect_grade: "학년", prospect_school: "학교", parent_name: "학부모",
  parent_request: "요청사항", learning_history: "학습이력", career_goal: "희망진로", siblings: "형제자매",
  siblings_details: "형제자매", safety_notes: "안전메모", consultation_path: "유입경로", outcome: "상담결과",
  registration_status: "등록상태", payment_amount: "결제금액", payment_date: "결제일", registrar: "등록자",
  counselor: "상담자", non_registration_reason: "미등록사유", follow_up_date: "후속일", follow_up_content: "후속내용",
  gender: "성별", birth_date: "생년월일", parent_relation: "보호자관계", address: "주소", address_detail: "상세주소",
  student_type: "학생유형", received_date: "접수일", consultation_date: "상담일", shuttle_bus_request: "셔틀요청",
  consulted_at: "상담일시", english_name: "영문이름", blood_type: "혈액형", zip_code: "우편번호",
  privacy_agreement: "개인정보동의", installment_agreement: "분납동의", processing_status: "처리상태",
  // 공통 추가
  teacher_name: "강사명", student_name: "학생", subject_progress: "진도", subject_details: "과목상세",
  homework: "과제", attendance_status: "출결", start_date: "시작일", end_date: "종료일",
};

const colLabel = (c: string) => COLUMN_LABEL[c] ?? c;

function shortVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "비움";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "object") return "(내용)";
  const s = String(v);
  return s.length > 24 ? s.slice(0, 24) + "…" : s;
}

export type ActivityChange = { redacted?: true; old?: unknown; new?: unknown };

const CHANGES_CAP = 8; // 변경 목록 최대 표시 개수(초과분은 "외 N건")

/**
 * 활동 1건을 머리말 + 변경 목록으로 구조화 — 뷰어가 변경 1건이면 인라인, 여러 건이면 줄바꿈 리스트로.
 * 예: head="등록상담 「이주아」 수정", changes=["형제자매 있음→비움","희망진로 신약개발연구원→비움","과목상세 변경"].
 * INSERT/DELETE는 changes=[](머리말만).
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

  const all = Object.entries(changed as Record<string, ActivityChange>);
  const changes = all.slice(0, CHANGES_CAP).map(([col, ch]) => {
    if (ch && typeof ch === "object" && "redacted" in ch && ch.redacted) return `${colLabel(col)} 변경`;
    const c = ch as ActivityChange;
    return `${colLabel(col)} ${shortVal(c.old)}→${shortVal(c.new)}`;
  });
  const more = all.length - Math.min(all.length, CHANGES_CAP);
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
