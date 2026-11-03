// 운영 감사로그(audit_logs) metadata → 한글 상세 — 순수 함수(서버/클라 공용, activity.ts와 동일 원칙).
// UI 규칙: raw JSON·uuid·영문 enum을 셀에 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { formatSettingChange, type SettingChange } from "@/features/owner/settings-diff";
import { SECTION_LABELS } from "@/features/owner/settings-types";
import { STEP_DECISION_LABEL, STEP_DECISIONS, type StepDecision } from "@/features/approvals/types";
import { formatSignedDays } from "@/features/leave/balance";
import { formatLeaveDays } from "@/features/leave/request-days";
import { STUDENT_STATUS_LABEL } from "@/features/students/status/status-labels";
import { STATUS_TEXT } from "@/features/attendance/cell-display";
import { ONBOARDING_ITEMS } from "@/features/newcomers/onboarding-items";
import { reasonDisplay } from "@/features/withdrawals/types";
import { reasonDetailOf } from "@/features/withdrawals/reason-detail";
import {
  BOARDING_STATUS_LABEL,
  DIRECTION_LABEL,
  RIDE_EXCEPTION_LABEL,
  SEASON_LABEL,
  isBoardingStatus,
  isDirection,
  isRideExceptionKind,
  isSeason,
} from "@/features/shuttle/types";
import { compactWeekdays } from "@/features/shuttle/roster";
import { workDaysLabel } from "@/features/staff/employment";
import {
  CONSULTATION_AUDIENCE_LABEL,
  CONSULTATION_CATEGORY_LABEL,
} from "@/features/consultations/labels";
import { meetingReportSectionLabel } from "@/features/meetings/report-sections";
import {
  TEXTBOOK_CHECK_LABEL,
  describeTextbookChanges,
  type TextbookFieldChange,
} from "@/features/billing/textbook-audit";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { MAKEUP_ACTION } from "@/features/makeups/status";
import { assetStatusLabel } from "@/features/inventory/status";
import { loanStatusLabel } from "@/features/inventory/loan-status";
import { assetCategoryLabel } from "@/features/inventory/category";
import { auditResultLabel } from "@/features/inventory/audit-result";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";

/** 대상 유형(target_type) → 한글 — 감사로그 '대상' 열 접두. 미등록 유형은 원문 폴백. */
export const AUDIT_TYPE_LABEL: Record<string, string> = {
  // 오늘 수학 사용 메뉴(2026-10-19) — 에이와 · 오늘 수학 어느 쪽에서 바꿔도 같은 대상.
  todays_math: "오늘 수학",
  // ── 2026-09-09 전수 보강 — 여기 없으면 감사로그 '대상' 열에 영문이 그대로 뜬다. ──
  expense: "지출결의서",
  refund_request: "환불 요청서",
  invoice_session_term: "청구 회차",
  payslip: "급여명세서",
  class_sheet_plan: "수업계획",
  // 강사 시트 칸 편집·Shouting·MP 토글(2026-09-14) — '대상' 이름은 반 이름 스냅샷.
  class_sheet: "강사 시트",
  announcement: "직원 공지",
  briefing: "일일 브리핑",
  document_category: "서식 분류",
  campaign_target: "재등록 캠페인 대상",
  notion_task: "Notion 업무",
  timetable: "시간표",
  staff: "직원",
  // 같은 "직원"이지만 호출부마다 target_type 표기가 달라 실제로 쌓여 있다(user 6행·users 3행) — 셋 다 한글로.
  user: "직원",
  users: "직원",
  student: "학생",
  academy_documents: "서식 문서",
  invoice: "청구서",
  textbook_order: "교재 신청",
  exam: "시험",
  // 2026-09-22 성적관리 개편 — 시험 행이 아니라 `학기·과목·시험 칸` 격자를 저장한다(옛 `exam` 행도 남아 있어 둘 다 둔다).
  grades: "성적",
  demo_roster: "데모 재원",
  payroll: "급여",
  class: "반",
  classroom: "강의실",
  tenant_settings: "학원 설정",
  staff_resume: "직원 이력서",
  intake_token: "QR 접수 링크",
  notice_popup: "팝업 공지",
  classnote_notice: "학부모 공지",
  classnote_sync: "ClassNote 반 보드 동기화",
  classnote_parent_reply: "ClassNote 학부모 답글",
  classnote_parent_reaction: "ClassNote 학부모 글 공감",
  operating_periods: "세션 기간",
  // 2026-08-17 원장 제보("대상이 attendance 등 날것으로 나옴") — 누락 유형 전수 추가(가드 테스트도 갱신).
  attendance: "출결",
  video_homework: "영상 과제",
  lesson_report: "수업보고서",
  approval_document: "결재 문서",
  enrollment_consultations: "신규 콜&상담",
  document: "문서",
  // 셔틀(0225a) — 없으면 감사로그 '대상' 열에 영문 "shuttle"이 그대로 뜬다(2026-08-17 원장 제보와 같은 증상).
  shuttle: "셔틀",
  // 캘린더(0218a) — 위와 같은 누락. 일정 삭제 로그의 대상이 영문 "calendar_event"로 떠 있었다.
  calendar_event: "일정",
  calendar_tag: "캘린더 태그",
  // 구글 캘린더 가져오기(시스템 직접 insert) — 가드가 `targetType:` 카멜 표기만 봐서 영문 "calendar"가 샜다(2026-09-10).
  calendar: "캘린더",
  // 회의록·학생상담(2026-08-25) — 없으면 '대상' 칸에 영문 "meeting"·"student_consultation"이 그대로 뜬다.
  meeting: "회의록",
  student_consultation: "학생 상담",
  // 연동·AI 프롬프트(2026-08-27 감사 커버리지 점검) — 없으면 '대상' 칸에 영문 키가 그대로 뜬다.
  integration: "외부 연동",
  ai_prompt: "AI 프롬프트",
  ment_style: "강사 말투",
  teacher_portfolio: "직원 포트폴리오",
  student_contribution: "원생 기여도",
  kiosk_device: "키오스크 기기",
  // 시간표(개발중) 월별 계획(0232a) — 화면은 2026-10-23 지웠지만 남은 과거 기록(08-31 2건)을 읽으려고 라벨은 둔다.
  // 본 시간표가 아니라 **계획**임이 '대상' 칸에서 바로 읽혀야 한다.
  timetable_plan: "시간표 계획",
  timetable_plan_slot: "시간표 계획 칸",
  // 시간표 연습실의 개인 사본 — 운영 시간표가 아니라 **연습본**임이 '대상' 칸에서 바로 읽혀야 한다.
  timetable_lab_draft: "시간표 연습본",
  timetable_memo_sheet: "시간표 메모 시트",
  timetable_cell_memo: "시간표 칸 메모",
  // 재고관리(0242a) — 없으면 '대상' 칸에 영문 "inventory_asset"이 그대로 뜬다.
  inventory_asset: "자산",
  inventory_loan: "자산 대여",
  inventory_audit: "자산 실사",
  inventory_supply: "소모품",
  inventory_vendor: "업체",
  inventory_category: "자산 분류",
  // 교재목록(0266a) — 없으면 '대상' 칸에 영문 "textbook"이 그대로 뜬다.
  textbook: "교재",
  help_post: "도움말 질문",
  help_answer: "도움말 답변",
  support_request: "개선요청",
  // 감사로그 빈틈 메우기(2026-10-15) — 수납 단가표·견적 · 직원 휴가.
  textbook_catalog: "교재 단가표",
  tuition_catalog: "수강료 단가",
  tuition_quote: "수강료 견적",
  staff_leave: "직원 휴가",
  withdrawal_report_archive: "퇴원보고서 원본 기록",
  makeup: "보강관리",
};

// 시험유형은 운영 enum이 아니라 코드 고정(CLAUDE.md) — exams 화면과 동일 라벨.
const EXAM_TYPE_LABEL: Record<string, string> = { weekly: "주간", mock: "모의", school: "학교" };

// 회의 처리 파이프라인 상태(코드 고정 enum, meeting_processing_status) — 라벨은 회의록 목록 화면과 같은 말.
// 🔴 없으면 재전사 로그 상세에 `failed`·`completed`가 영문 그대로 샌다.
const MEETING_STATUS_LABEL: Record<string, string> = {
  idle: "대기",
  uploaded: "업로드됨",
  transcribing: "전사 중",
  analyzing: "분석 중",
  completed: "완료",
  failed: "실패",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Meta = Record<string, unknown>;
/** uuid → 표시 이름(해석 실패 시 null). 서버가 페이지 단위로 일괄 조회해 만든 맵을 감싼다. */
export type AuditNameOf = (id: unknown) => string | null;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** 퇴원 세부 사유(영문 키) → `세부: 담당 강사 변경` — 모르는 키는 싣지 않는다(키 원문을 화면에 흘리지 않는다). */
const detailText = (v: unknown): string | null => {
  const label = reasonDetailOf(str(v))?.label;
  return label ? `세부: ${label}` : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const won = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : `${n.toLocaleString("ko-KR")}원`;
};
const roleKo = (v: unknown): string | null => {
  const s = str(v);
  return s ? ((ROLE_LABEL as Record<string, string>)[s] ?? s) : null;
};
const join = (...parts: Array<string | null>): string | null => {
  const out = parts.filter(Boolean);
  return out.length ? out.join(" · ") : null;
};

const HANGUL_RE = /[가-힣]/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 등록상담 진행 상태 → 한글(코드 고정 enum, 단일 소스 OUTCOME_PILL). 🔴 모르는 값은 null — 영문을 흘리지 않는다. */
const outcomeKo = (v: unknown): string | null => {
  const s = str(v);
  return s ? (OUTCOME_PILL[s]?.label ?? null) : null;
};

/** 바이트 → 사람이 읽는 크기. 0·비수는 null(없는 걸 "0B"로 적으면 노이즈). */
const fileSize = (v: unknown): string | null => {
  const n = num(v);
  if (n === null || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024)).toLocaleString("ko-KR")}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
};

/** 초 → "12분 30초"(1분 미만은 초만). 녹음 길이. */
const durationKo = (v: unknown): string | null => {
  const n = num(v);
  if (n === null || n <= 0) return null;
  const min = Math.floor(n / 60);
  const sec = Math.round(n % 60);
  if (min === 0) return `${sec}초`;
  return sec > 0 ? `${min}분 ${sec}초` : `${min}분`;
};

/** 글자 수 — 0이면 null(전사·메모가 아예 없던 건을 "0자"로 적지 않는다). */
const charsKo = (v: unknown, label: string): string | null => {
  const n = num(v);
  return n === null || n <= 0 ? null : `${label} ${n.toLocaleString("ko-KR")}자`;
};

/** 회의 녹음 업로드의 파일 출처(녹음 중단 진단 2026-10-29) — 복구본이면 '녹음 중단' 기록과 같은 녹음 id로 잇는다. */
const recordingOriginKo = (v: unknown): string | null => {
  const origin = v && typeof v === "object" ? (v as Record<string, unknown>).origin : null;
  return origin === "restored" ? "복구한 녹음" : origin === "recorded" ? "이 브라우저 녹음" : null;
};

/** 학생상담 분류·대상 — 🔴 미등록 키는 **null**(영문 원문을 흘리지 않는다). */
const consultCategoryKo = (v: unknown): string | null => {
  const s = str(v);
  return s ? (CONSULTATION_CATEGORY_LABEL[s] ?? null) : null;
};
const consultAudienceKo = (v: unknown): string | null => {
  const s = str(v);
  const label = s ? CONSULTATION_AUDIENCE_LABEL[s] : null;
  return label ? `대상 ${label}` : null;
};
/**
 * 학생상담 저장의 반(0318a) — `classId` 키가 metadata에 **있을 때만** 말한다(없으면 그 저장은 반을 다루지 않았다).
 * 바뀌었으면 `반 A → B`, 사람이 반을 비우면 `반 없음(직접 고름)`(상담 화면과 같은 말 — '미매핑' 같은 내부 말을 쓰지 않는다, 2026-10-21).
 * 이름은 저장 시점 이름(`className`)을 먼저 쓴다.
 */
const consultClassKo = (m: Meta, nameOf: AuditNameOf): string | null => {
  if (!("classId" in m)) return null;
  const name = (id: unknown, label: unknown) => str(label) ?? (str(id) ? nameOf(id) : null);
  const now = name(m.classId, m.className) ?? "없음";
  const how = m.classPick === "manual" ? "직접 고름" : m.classPick === "auto" ? "자동" : null;
  const tail = how ? `(${how})` : "";
  if ("prevClassId" in m) return `반 ${name(m.prevClassId, m.prevClassName) ?? "없음"} → ${now}${tail}`;
  return `반 ${now}${tail}`;
};

/**
 * 미등록 액션 폴백에서 **뜻이 분명한** 공통 키만 한글로 옮긴다. 값이 ""면 라벨 없이 값만.
 * ⚠️ 여기 없는 영문 키는 **숨긴다** — 뜻도 모르는 키를 `slot: observer`처럼 그대로 내보내는 것이
 *    곧 raw 코드 노출이다(CLAUDE.md 반복 지적). 원문 JSON은 뷰어 title 툴팁이 항상 보존한다.
 */
const FALLBACK_KEY_LABEL: Record<string, string> = {
  note: "",
  memo: "",
  email: "",
  name: "",
  title: "",
  reason: "사유",
  date: "날짜",
  from: "이전",
  to: "이후",
  // 수학 자동 시수(원장 2026-09-11, attendance/auto-units.ts) — 출결 저장 로그에 붙는다(단건 = 값 · 여러 칸 = 칸 수).
  autoUnits: "자동 시수",
  autoUnitsCells: "자동 시수 칸",
  // 강사 보기 저장이 손대지 않고 둔 자리(JJ·랩실) 행 수(원장 2026-09-12) — 출결 저장·지우기·메모 로그에 붙는다.
  skippedSeatRows: "건너뛴 자리 기록",
  // 강사 보기 빗금 칸 입력으로 다른 선생님 교시 행에 상태만 옮긴 행 수(원장 2026-09-14).
  ghostTransfer: "다른 선생님 교시로 옮긴 기록",
};

/** 폴백에서 **사람 id**에 붙일 라벨 — 이름만 서면 누구인지(학생? 강사?) 모른다. `라벨: 이름`으로 적는다. */
const FALLBACK_ID_LABEL: Record<string, string> = {
  // 출석부 강사 전체 보기에서 온 출결 저장(attendance_cell·attendance_range, 2026-09-11) — 시수를 그 강사 몫에만 나눴다.
  scopeTeacherId: "강사 보기",
};

/**
 * 운영 스크립트가 남긴 실행자 식별자(`system:grant-class-review`) → 한글.
 * 실측 8종(2026-08-20) + 저장소에 남아 있는 스크립트 전수. 미등록 `system:*`도 접두를 그대로
 * 내보내지 않고 "시스템 스크립트"로 접는다(새 스크립트가 생겨도 영문이 안 샌다).
 */
export const SYSTEM_ACTOR_PREFIX = "system:";
const SYSTEM_ACTOR_LABEL: Record<string, string> = {
  "teacher-portfolio": "직원 포트폴리오 매일 집계",
  // 마감한 달에 바뀐 규칙을 얹는 운영 스크립트(원장 지시 때만 — 2026-10-14 강사 탓이 아닌 사유).
  "teacher-portfolio-rule-patch": "직원 포트폴리오 마감 달 규칙 반영",
  "teacher-portfolio-recompute": "직원 포트폴리오 지난달 다시 집계",
  "grant-class-review": "직원 평가 권한 부여",
  "grant-seat-attendance": "자리 출석부 권한 부여",
  "narrow-staff-menu": "직원관리 권한 조정",
  "create-test-staff": "테스트 직원 생성",
  "delete-test-staff": "테스트 직원 삭제",
  "register-kimjuhyun": "직원 등록",
  "qa-temp-account": "QA 임시 계정",
  "debug-contract-upload": "계약서 업로드 점검",
  "reset-staff-password": "직원 비밀번호 재설정",
  "backfill-math-auto-units": "수학 출석 시수 자동값 보정",
  // 주간 cron(/api/cron/ment-style-rebuild) — 세션이 없어 logActionAs로 남긴다.
  "ment-style-rebuild": "강사 말투 주간 갱신",
  // 슬랙 발송기(/api/cron/slack-dispatch · 응답 뒤 poke) — 토큰이 죽어 연결을 '끊김'으로 바꿀 때.
  "slack-dispatch": "슬랙 발송기",
  // ClassNote 지금 반 보드 동기화(0313a) — 연동 PC 워커가 실행 결과를 직접 남긴다.
  "classnote-sync-now": "ClassNote 반 보드 동기화(연동 PC)",
  "classnote-auto-sync": "ClassNote 반 보드 자동 동기화(연동 PC)",
  // ClassNote 학부모 답글(0317a) — 연동 PC 워커가 게시·수정·삭제 결과를 직접 남긴다.
  "classnote-parent-reply": "ClassNote 학부모 답글(연동 PC)",
  // 원생 통계 '지난 기록' 다시 세기(메이크에듀 재구성 · 에이와 밤 집계 손 실행) — 원장 지시 때만(2026-10-29).
  "student-history-rebuild": "원생 통계 지난 기록 다시 세기",
  // 반미정 영상의 반을 담임 배정·숙제로 정한 정리 스크립트(2026-10-29).
  "video-unknown-class-fix": "반미정 영상 반 정리",
};
const SYSTEM_ACTOR_FALLBACK = "시스템 스크립트";

/** 감사로그 '실행자' 열 표시 — 사람 이름은 그대로, 스크립트 식별자만 한글로. */
export function auditActorName(actorName: string | null): string | null {
  const s = str(actorName);
  if (!s) return null;
  if (!s.startsWith(SYSTEM_ACTOR_PREFIX)) return s;
  const label = SYSTEM_ACTOR_LABEL[s.slice(SYSTEM_ACTOR_PREFIX.length).trim()];
  return label ? `시스템 · ${label}` : SYSTEM_ACTOR_FALLBACK;
}

/**
 * 화면에 보이는 한글 실행자명으로 검색이 되게 — 검색어 → 실제 `actor_name` 원문.
 * (액션 라벨을 키로 되돌리는 기존 검색 규약과 같은 결. 안 하면 "시스템 · 수업 평가 권한 부여"를
 *  그대로 복사해 검색했을 때 0건이 나온다.)
 * `allSystem`이면 접두 매치(`system:*`)로 미등록 스크립트까지 함께 찾는다.
 */
export function systemActorMatches(term: string): { names: string[]; allSystem: boolean } {
  const t = term.trim().toLowerCase();
  // 한 글자는 안 본다 — "스" 한 글자가 "시스템"에 걸려 스크립트 행 전부를 결과에 얹으면 검색이 무뎌진다.
  if (t.length < 2) return { names: [], allSystem: false };
  if (SYSTEM_ACTOR_FALLBACK.includes(t) || "시스템".includes(t)) return { names: [], allSystem: true };
  const names = Object.entries(SYSTEM_ACTOR_LABEL)
    .filter(([, label]) => label.toLowerCase().includes(t))
    .map(([key]) => `${SYSTEM_ACTOR_PREFIX}${key}`);
  return { names, allSystem: false };
}

/** 페이지 행들의 metadata에서 이름 해석이 필요한 학생/직원/반 uuid 수집(일괄 조회용). */
export function collectAuditNameIds(rows: Array<{ metadata: Meta | null }>): {
  studentIds: string[];
  userIds: string[];
  classIds: string[];
} {
  const students = new Set<string>();
  const users = new Set<string>();
  const classes = new Set<string>();
  for (const r of rows) {
    const m = r.metadata;
    if (!m) continue;
    const sid = str(m.studentId);
    if (sid && UUID_RE.test(sid)) students.add(sid);
    // scopeTeacherId = 출석부 강사 전체 보기의 주인(출결 저장 로그, 2026-09-11).
    for (const key of ["userId", "newTeacherId", "delegateUserId", "scopeTeacherId", "teacherId"]) {
      const uid = str(m[key]);
      if (uid && UUID_RE.test(uid)) users.add(uid);
    }
    // fromClassId·toClassId = 보강 반 바꾸기(makeup_class_change, 2026-09-30)의 옛 반·새 반.
    for (const key of ["classId", "fromClassId", "toClassId", "absentClassId"]) {
      const cid = str(m[key]);
      if (cid && UUID_RE.test(cid)) classes.add(cid);
    }
    // 여러 반을 한 줄에 남기는 일괄 기록(원스크린 일괄 입력, 2026-10-15) — 배열도 이름으로 읽는다(앞 50개).
    // ⚠️ 이름으로 쓰는 분기가 있는 배열만 모은다 — 옛 일괄 로그의 `studentIds`까지 모으면 한 쪽에 조회가 수천 건이 된다.
    const classList = m.classIds;
    if (Array.isArray(classList)) {
      for (const v of classList.slice(0, 50)) {
        const id = str(v);
        if (id && UUID_RE.test(id)) classes.add(id);
      }
    }
  }
  return { studentIds: [...students], userIds: [...users], classIds: [...classes] };
}

/**
 * '대상' 열 라벨 한글화 — 원문이 **설정 섹션 키**(`permissions`)·**과목 키**(`english`)·**uuid**일 때만
 * 손댄다. 그 외(사람·반·문서 이름)는 **원문 그대로** — 건드리면 실제 이름이 사라진다.
 * null이면 뷰어가 metadata 이름 보충(`auditTargetName`) → "—" 순으로 떨어진다.
 *
 * 배경(2026-08-20 원장 제보): `tenant_settings|permissions`·`tenant_settings|english` 행이 화면에서
 * "학원 설정permissions"·"학원 설정english"로 붙어 보였다. uuid 폴백(approval_withdraw·classroom_delete가
 * 이름을 못 구하면 id를 그대로 싣는다)도 같은 raw 노출이라 함께 접는다 — 원문은 뷰어 title 툴팁에 남긴다.
 */
export function auditTargetLabel(
  targetType: string | null,
  targetLabel: string | null,
  ctx: { subjectLabel: (key: string) => string },
): string | null {
  const label = str(targetLabel);
  if (!label) return null;
  if (UUID_RE.test(label)) return null;
  if (targetType !== "tenant_settings") return label;
  const section = (SECTION_LABELS as Record<string, string>)[label];
  if (section) return section;
  // 과목 키 — labelOf는 **미등록 키를 그대로 되돌려주므로** 결과가 같으면 원문으로 둔다(지어내지 않는다).
  const subject = ctx.subjectLabel(label);
  return subject === label ? label : subject;
}

/** targetLabel이 빈 행(퇴원 사유·인수인계 취소 등)의 '대상' 열을 metadata의 학생/직원/반 이름으로 보충. */
export function auditTargetName(metadata: Meta | null, nameOf: AuditNameOf): string | null {
  if (!metadata) return null;
  return (
    nameOf(metadata.studentId) ?? nameOf(metadata.userId) ?? nameOf(metadata.newTeacherId) ?? nameOf(metadata.classId)
  );
}

/** 회차 행이 만들어진 계기(`term-materialize.ts` `MaterializeReason`) → 한글. 🔴 모르는 값은 null — 영문을 흘리지 않는다. */
const MATERIALIZE_REASON_KO: Record<string, string> = {
  confirm: "개별 확정",
  confirm_selected: "선택 일괄 확정",
  confirm_class: "반 일괄 확정",
  allocate: "수납 배분",
};

/**
 * 감사로그 1건의 metadata를 한글 상세 문장으로. null = 표기할 상세 없음("—").
 * 모르는 액션은 uuid를 걸러낸 키값 나열 폴백(원문 JSON은 뷰어가 title 툴팁으로 보존).
 */
export function auditDetail(
  action: string,
  metadata: Meta | null,
  ctx: { nameOf: AuditNameOf; subjectLabel: (key: string) => string },
): string | null {
  const m = metadata ?? {};
  switch (action) {
    // 원스크린 일괄 입력(2026-10-15) — 방식 · 날짜 · 몇 행 · 어느 반 · 어떤 칸. 글 내용은 기록에 없다(bulk-log-actions.ts).
    case "onescreen_trend_optout": {
      const cleared = num(m.cleared);
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        m.on === true ? "미발송 켬" : m.on === false ? "미발송 끔" : null,
        cleared && cleared > 0 ? `안 나간 보고서 ${cleared}건 추세 비움` : null,
      );
    }
    case "onescreen_bulk_apply": {
      const FIELD: Record<string, string> = {
        today: "진도", textbook: "교재", homeworkToday: "오늘 과제", attitude: "태도", homework: "과제", note: "특이사항",
        dailyScore: "데일리 점수", dailyMax: "데일리 문항수", checkScore: "체크 점수", checkMax: "체크 문항수",
        videoHomework: "영상 과제", videoSubmitLink: "영상 링크", videoHomeworkDue: "영상 마감",
      };
      const classes = Array.isArray(m.classIds) ? m.classIds.map((id) => ctx.nameOf(id)).filter((n): n is string => !!n) : [];
      const fields = Array.isArray(m.fields) ? m.fields.map((f) => FIELD[String(f)]).filter((f): f is string => !!f) : [];
      const rows = num(m.rows);
      return join(
        m.mode === "copy" ? "맨 위 행 복사" : "직접 입력",
        str(m.date),
        rows != null ? `${rows}행` : null,
        classes.length ? `반 ${classes.join("·")}` : null,
        fields.length ? `칸 ${fields.join("·")}` : null,
      );
    }
    // 학생 상세의 성적·레벨테스트·목표·학습 코멘트(감사로그 빈틈 메우기 2026-10-15) — 누구 · 과목 · 날짜. 점수·본문은 기록에 없다.
    case "student_grade_create":
    case "student_grade_delete":
    case "student_level_test_create":
    case "student_level_test_delete":
    case "student_goal_create":
    case "student_goal_delete":
    case "student_grade_comment_create":
    case "student_grade_comment_update":
    case "student_grade_comment_delete": {
      const subject = str(m.subject);
      return join(ctx.nameOf(m.studentId), subject ? ctx.subjectLabel(subject) : null, str(m.date));
    }
    // 켜고 끄는 기록(2026-10-15) — 기본 분기는 불리언을 숨겨 방향이 사라진다.
    case "student_memo_pin":
      return join(ctx.nameOf(m.studentId), m.pinned === true ? "고정" : m.pinned === false ? "고정 해제" : null);
    case "progress_anomaly_resolve":
      return join(ctx.nameOf(m.studentId), m.resolved === true ? "이상 없음으로 확인" : m.resolved === false ? "확인 되돌림" : null);
    case "textbook_catalog_toggle":
    case "tuition_catalog_toggle":
      return m.active === true ? "사용으로" : m.active === false ? "중지로" : null;
    case "shuttle_run_stop_time":
      return str(m.atTime) ? `정류장 시각 ${str(m.atTime)}` : "정류장 시각 지움";
    case "shuttle_run_stop_reorder":
      return num(m.stops) != null ? `정류장 ${num(m.stops)}곳 순서` : null;
    case "shuttle_rider_weekdays": {
      const days = Array.isArray(m.weekdays) ? compactWeekdays(m.weekdays.map(String)) : "";
      return join(ctx.nameOf(m.studentId), days || null);
    }
    case "enrollment_consultation_report_edit":
      return join("AI 분석 한 섹션 수정", num(m.chars) != null ? `${num(m.chars)}자` : null);
    // 보강 칸 ↔ 결석 연결 — 시수까지 고치는 연결과 메모만 붙이는 연결(memoOnly)이 같은 키다.
    case "attendance_makeup_link":
      return join(
        ctx.nameOf(m.studentId),
        str(m.absentDate) ? `결석 ${str(m.absentDate)}${ctx.nameOf(m.absentClassId) ? ` ${ctx.nameOf(m.absentClassId)}` : ""}` : null,
        str(m.makeupDate) ? `보강 ${str(m.makeupDate)}${ctx.nameOf(m.classId) ? ` ${ctx.nameOf(m.classId)}` : ""}` : null,
        m.memoOnly === true ? "메모만 연결" : num(m.units) != null ? `보강 칸 시수 ${num(m.units)}` : null,
        m.alreadyLinked === true ? "이미 연결됨" : null,
      );
    case "makeup_case_command":
      return join(MAKEUP_ACTION[String(m.command)] ?? null, ctx.nameOf(m.studentId));
    // 숙제 영상 제출 링크(0325a) — 어느 반 · 어디서 만든 링크 · 언제까지 / 몇 개 끊었나 / 어느 폴더에 얼마나.
    case "lesson_report_video_link_issue":
      return join(
        ctx.nameOf(m.classId),
        m.origin === "report" ? "수업보고서 발송용" : m.origin === "site" ? "올리기 사이트에서 번호·이름으로 엶" : "학생 상세에서 복사",
        // 올리기 사이트에서 고른 숙제(2026-10-03) — 어느 수업의 숙제인가.
        str(m.homeworkDate) ? `${str(m.homeworkDate)} 수업 숙제` : null,
        // 사이트 링크는 같은 반의 가장 늦은 숙제까지 산다 — 고른 숙제의 기한으로 읽히지 않게 '링크'를 붙인다.
        str(m.lastDay) ? (m.origin === "site" ? `링크 ${str(m.lastDay)}까지` : `${str(m.lastDay)}까지`) : null,
      );
    case "lesson_report_video_link_revoke":
      return join(ctx.nameOf(m.classId), `쓰는 중인 링크 ${num(m.revoked) ?? 0}개 끊음`);
    case "lesson_report_video_link_upload": {
      const bytes = num(m.bytes);
      return join(ctx.nameOf(m.classId), str(m.folder), bytes === null ? null : `${Math.max(1, Math.round(bytes / 1048576))}MB`);
    }
    case "session_term_delete": {
      const sessions = num(m.sessionsBefore);
      return join(str(m.period), ctx.nameOf(m.classId), sessions === null ? "미확정 회차 삭제" : `확정 ${sessions}시수 삭제`, won(m.amountBefore), str(m.note) ? `메모: ${str(m.note)}` : null);
    }
    case "session_term_create": {
      // 출석부 줄에 맞춰 생긴 회차 행 — 어느 달·어느 반·어느 저장이 만들었나·예정 시수(기록만 있는 줄은 예정이 없다).
      const reason = str(m.reason);
      const cls = ctx.nameOf(m.classId);
      const planned = num(m.plannedSessions);
      return join(
        str(m.period),
        cls ? `${cls} 반` : null,
        reason && MATERIALIZE_REASON_KO[reason] ? `${MATERIALIZE_REASON_KO[reason]} 때 생성` : null,
        planned === null ? "예정 없음(기록만)" : `예정 ${planned}시수`,
      );
    }
    case "session_term_monthly_units": {
      const sessions = num(m.sessions);
      const amount = won(m.amountPreserved);
      return join(sessions === null ? null : `확정 ${sessions}시수`, amount ? `월 금액 ${amount} 유지` : null);
    }
    case "session_terms_refresh": {
      const refreshed = num(m.refreshed);
      const removed = num(m.removed);
      const notes = arr(m.removedNotes)
        .map((n) => (n && typeof n === "object" ? str((n as Meta).note) : null))
        .filter((v): v is string => !!v);
      return join(
        refreshed === null ? null : `계획 ${refreshed}건 갱신`,
        removed ? `빠진 반 ${removed}건 정리` : null,
        notes.length ? `메모와 함께 지움: ${notes.slice(0, 3).map((n) => `"${n}"`).join(" · ")}${notes.length > 3 ? ` 외 ${notes.length - 3}건` : ""}` : null,
      );
    }
    case "session_term_confirm_selected": {
      // 학생마다 시수·단가가 다를 수 있다 — 같은 조합끼리 세어 한 줄로(`7시수 × 21,250원 5명 · 4시수 × 21,250원 1명`).
      const combos = new Map<string, number>();
      for (const it of arr(m.items)) {
        if (!it || typeof it !== "object") continue;
        const sessions = num((it as Meta).sessions);
        const price = won((it as Meta).unitPrice);
        if (sessions === null || !price) continue;
        // 단위는 행마다(`items[].pricingMode`) — 옛 모양은 묶음에 하나(`pricingMode`)였다.
        const mode = str((it as Meta).pricingMode) ?? str(m.pricingMode);
        const key = mode === "monthly" ? `${sessions}시수 · 월 ${price}` : `${sessions}시수 × ${price}`;
        combos.set(key, (combos.get(key) ?? 0) + 1);
      }
      const count = num(m.confirmedCount);
      const skipped = num(m.skipped);
      const failed = num(m.failedCount);
      const comboText = [...combos].slice(0, 3).map(([k, n]) => `${k} ${n}명`).join(" · ");
      return join(
        count === null ? null : `선택 ${count}명 확정`,
        comboText ? `${comboText}${combos.size > 3 ? ` 외 ${combos.size - 3}가지` : ""}` : null,
        skipped ? `건너뜀 ${skipped}명` : null,
        failed ? `실패 ${failed}명` : null,
      );
    }
    case "session_term_unconfirm_class": {
      // 지우기 전 값을 조합별로 세어 한 줄로(`7시수 × 21,250원 5명 · 4시수 × 21,250원 1명`) — 무엇을 지웠는지가 이 로그의 전부다.
      const combos = new Map<string, number>();
      for (const it of arr(m.items)) {
        if (!it || typeof it !== "object") continue;
        const sessions = num((it as Meta).sessionsBefore);
        const price = won((it as Meta).unitPriceBefore);
        if (sessions === null || !price) continue;
        const key = str((it as Meta).pricingMode) === "monthly" ? `${sessions}시수 · 월 ${price}` : `${sessions}시수 × ${price}`;
        combos.set(key, (combos.get(key) ?? 0) + 1);
      }
      const count = num(m.unconfirmedCount);
      const skipped = num(m.skipped);
      const failed = num(m.failedCount);
      const comboText = [...combos].slice(0, 3).map(([k, n]) => `${k} ${n}명`).join(" · ");
      return join(
        count === null ? null : `${count}명 확정 해제`,
        comboText ? `해제 전 ${comboText}${combos.size > 3 ? ` 외 ${combos.size - 3}가지` : ""}` : null,
        skipped ? `건너뜀 ${skipped}명` : null,
        failed ? `실패 ${failed}명` : null,
      );
    }
    case "session_term_receipt_allocate_free": {
      // 자유 배분(0279a) — 수업 청구액 중 얼마를 몇 반에 나눴나(받은 돈보다 많이 줄 수 없다 · 덜 준 건 남은 금액으로).
      const total = num(m.tuitionTotal);
      const sum = num(m.allocatedTotal);
      // 0원으로 실은 확정 반은 세지 않는다 — "몇 반에 나눴나"는 금액을 받은 반 수다.
      const n = arr(m.allocations).filter((a) => (num((a as { amount?: unknown })?.amount) ?? 0) > 0).length;
      return join(str(m.period), total !== null && sum !== null ? `수업 청구액 ${won(total)} 중 ${won(sum)} 배분${total > sum ? `(남김 ${won(total - sum)})` : ""}` : null, n ? `${n}개 반` : null);
    }
    case "session_term_receipt_allocate_auto": {
      // 시수 확정 뒤 자동 재확정(2026-10-06) — 몇 반을 그대로 두고, 새로 확정한 반 몇을 비어 있던 항목에 붙였나.
      const linked = arr(m.linkedTermIds).length;
      const kept = Math.max(0, arr(m.allocations).length - linked);
      return join(kept ? `${kept}개 반 배분 유지` : null, linked ? `새로 확정한 ${linked}개 반을 남은 수업 항목에 연결` : null);
    }
    case "session_term_carry_sync": {
      // 받은 금액 이월만큼 확정 시수를 올린 자동 조정 — 누구의 어느 달 줄이 몇 시수에서 몇 시수로, 이월 얼마 때문에.
      const before = num(m.sessionsBefore);
      const after = num(m.sessions);
      return join(
        str(m.period),
        str(m.studentName),
        before !== null && after !== null ? `확정 시수 ${before} → ${after}` : null,
        won(m.carryAmount) ? `받은 이월 ${won(m.carryAmount)} 반영` : null,
      );
    }
    case "session_term_money_carryover":
    case "session_term_money_carryover_cancel": {
      // 금액 이월(0278a) — 어느 달 어느 반에서 얼마를 다음 달 어느 반으로. 이름은 저장 시점 스냅샷(반 이름이 바뀌어도 그대로 읽힌다).
      const from = str(m.fromClassName);
      const before = num(m.amountBefore);
      if (action === "session_term_money_carryover_cancel") {
        return join(str(m.period), from ? `${from} 반` : null, `이월 취소${before ? `(${won(before) ?? ""} → ${str(m.toClassNameBefore) ?? "다음 달"})` : ""}`);
      }
      const to = str(m.toClassName);
      return join(
        str(m.period),
        from ? `${from} 반` : null,
        `${won(m.amount) ?? "?"} → ${str(m.toPeriod) ?? "다음 달"}${to ? ` ${to} 반` : ""}`,
        before ? `종전 ${won(before)}` : null,
        str(m.note) ? `메모 "${str(m.note)}"` : null,
      );
    }
    case "session_term_note": {
      const note = str(m.note);
      const before = str(m.noteBefore);
      if (note) return before ? `메모 "${before}" → "${note}"` : `메모 "${note}"`;
      return before ? `메모 "${before}" 지움` : null;
    }
    case "todays_math_menus_update": {
      // 출처 = 에이와(원장이 학원 설정에서) · 오늘 수학(지점관리) · 오늘 수학 관리자(열어 둔 메뉴를 바꿈 — 그 결과 지점 메뉴가 달라짐).
      const from = ({ eywa: "에이와에서", todays_math: "오늘 수학에서", todays_math_admin: "오늘 수학 관리자가" } as Record<string, string>)[str(m.source) ?? ""] ?? null;
      const on = arr(m.turnedOn).filter((v): v is string => typeof v === "string");
      const off = arr(m.turnedOff).filter((v): v is string => typeof v === "string");
      return join(from, on.length ? `켬: ${on.join(", ")}` : null, off.length ? `끔: ${off.join(", ")}` : null) || null;
    }
    case "owner_settings_update": {
      const s = str(m.section);
      const label = s ? ((SECTION_LABELS as Record<string, string>)[s] ?? s) : null;
      // 무엇이 바뀌었는지(2026-08-27~) — 저장 시점에 굳힌 한글 요약이라 과거 행도 그대로 읽힌다.
      // ⚠️ 이 키가 없는 옛 행은 종전대로 섹션명만 나온다(빈칸으로 만들지 않는다).
      const changes = arr(m.changes)
        .map((c) => (c && typeof c === "object" ? formatSettingChange(c as SettingChange) : null))
        .filter((v): v is string => !!v);
      const others = num(m.others);
      const detail = changes.length
        ? `${changes.slice(0, 6).join(" · ")}${changes.length > 6 ? ` 외 ${changes.length - 6}건` : ""}${
            others ? ` (그 외 ${others}건)` : ""
          }`
        : null;
      if (label) return detail ? `「${label}」 ${detail}` : `「${label}」 설정 저장`;
      // 권한 스크립트가 남긴 행에는 section이 없고 **한글 note가 통째로** 들어 있다(누가 어떤 메뉴를
      // 누구에게 열었는지가 여기에만 있다). 종전엔 이걸 버려서 화면엔 "설정 저장"만 떴다.
      const note = str(m.note);
      if (note) return note;
      // note 없이 명단만 남긴 스크립트(narrow-staff-menu) — 이름이면 몇 명 + 앞 3명, uuid면 인원만.
      const grants = arr(m.grants).map(str).filter((v): v is string => !!v);
      if (grants.length) {
        const named = grants.filter((g) => !UUID_RE.test(g));
        const sample = named.length ? ` (${named.slice(0, 3).join(", ")}${named.length > 3 ? " 외" : ""})` : "";
        return `개인 예외 ${grants.length}명${sample}`;
      }
      return "설정 저장";
    }
    case "sync_agent_manage":
      return str(m.summary) ?? "연동 PC 설정 변경";
    case "integration_sync_toggle":
    case "integration_sheets_toggle":
      return m.enabled === true ? "켜기" : m.enabled === false ? "끄기" : null;
    case "integration_sheet_target": {
      // 시트 ID는 외부 문서 식별자라 값 자체를 남기지 않는다(설정 변경 요약과 같은 규약).
      return m.cleared === true ? "대상 시트 해제" : "대상 시트 지정";
    }
    case "integration_video_drive_setting":
      return m.enabled === true ? join("저장 폴더 지정", str(m.folderName)) : "연결 해제";
    case "integration_video_drive_account":
      return join(m.intent === "reconnect" ? "Google 계정 다시 연결" : "Google 계정 연결", str(m.email));
    case "integration_sync_now":
      return "지금 동기화 실행";
    case "data_export_download":
      // 조건(쿼리스트링) 원문은 영문 키라 문장에 싣지 않는다 — 뷰어 title 툴팁(원문 JSON)으로만.
      return m.filtered === true ? "조건 걸어 받음" : "전체 받음";
    case "timetable_memo_sheet_save": {
      // 글자 내용은 싣지 않는다(판 크기만) — 판에 무엇을 적었는지는 시간표 화면에서 본다.
      const parts = [
        num(m.rows) !== null && num(m.cols) !== null ? `${num(m.rows)}행 × ${num(m.cols)}열` : null,
        num(m.cells) !== null ? `칸 ${num(m.cells)}개` : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    case "timetable_cell_memo_add":
      return "새 메모";
    case "timetable_cell_memo_update":
    case "timetable_cell_memo_delete": {
      // 칸 자리는 '대상' 칸이 보여 준다 — 여기선 바뀌기 전 글 앞부분만(전문은 원문 툴팁).
      const before = str(m.before);
      const head = before && before.length > 40 ? `${before.slice(0, 40)}…` : before;
      return head ? `이전 내용 "${head}"` : "";
    }
    case "timetable_lab_draft_save":
    case "timetable_lab_draft_overwrite":
    case "timetable_lab_draft_delete": {
      // 연습본 이름은 '대상' 칸이 보여 준다 — 여기선 규모만(운영 시간표는 안 바뀐다).
      const parts = [
        num(m.classCount) !== null ? `반 ${num(m.classCount)}개` : null,
        num(m.lessonCount) !== null ? `수업 ${num(m.lessonCount)}개` : null,
        num(m.studentCount) !== null ? `학생 ${num(m.studentCount)}명` : null,
      ].filter(Boolean);
      return parts.length ? `개인 연습본 · ${parts.join(" · ")}` : "개인 연습본";
    }
    case "slack_connection_token": {
      // 토큰(비밀)은 애초에 metadata에 없다 — 연결된 워크스페이스 이름만.
      const team = str(m.team);
      return team ? `워크스페이스 ${team}` : "토큰 등록";
    }
    case "slack_connection_disconnect":
      return "연결 해제";
    case "slack_connection_sample": {
      const sent = num(m.sent);
      const failed = num(m.failed);
      return `샘플 알림 ${sent ?? 0}통 보냄${failed ? ` · ${failed}곳 실패` : ""}`;
    }
    case "slack_schedule_update": {
      const dnd = m.dndEnabled === true ? `방해금지 ${str(m.dndStart) ?? "?"}~${str(m.dndEnd) ?? "?"}` : "방해금지 끔";
      return join(dnd, m.weekendQuiet === true ? "주말 조용히" : null, str(m.digestAt) ? `요약 ${str(m.digestAt)}` : null);
    }
    case "slack_rule_save": {
      // 켜짐·꺼짐을 늘 적고, 저장 전 모습(`before`, 2026-09-29~)이 있으면 **바뀐 것만** '전 → 후'로(원장 *"on/off 이런것도 말해야지"*).
      const targetsOf = (v: unknown) => arr(v).map(str).filter((x): x is string => !!x);
      const targetText = (t: string[]) => (t.length ? `${t.slice(0, 3).join(", ")}${t.length > 3 ? ` 외 ${t.length - 3}곳` : ""}` : "보낼 곳 없음");
      const onOff = (v: unknown) => (v === false ? "꺼짐" : "켜짐");
      const shapeText = (v: unknown) => (v === "detailed" ? "자세히" : "짧게");
      const timingText = (v: unknown) => (v === "digest" ? "요약으로만" : "바로");
      const b = m.before && typeof m.before === "object" ? (m.before as Meta) : null;
      const diff = (label: string, before: string, after: string) => (before === after ? null : `${label} ${before} → ${after}`);
      if (b) {
        const pingText = (v: unknown) => (v === "here" ? "@here" : v === "channel" ? "@channel" : "호출 없음");
        const changed2 = (x: unknown, y: unknown) => JSON.stringify(x ?? null) !== JSON.stringify(y ?? null);
        const changes = [
          diff("", onOff(b.enabled), onOff(m.enabled))?.trim() ?? null,
          changed2(b.name, m.name) ? `이름 ${str(b.name) ?? "?"} → ${str(m.name) ?? "?"}` : null,
          // 개수가 같아도 종류가 바뀌었을 수 있다(typeSig).
          changed2(b.typeSig, m.typeSig) || changed2(b.typeCount, m.typeCount)
            ? `종류 ${num(b.typeCount) ?? "?"}종 → ${num(m.typeCount) ?? "?"}종${num(b.typeCount) === num(m.typeCount) ? "(교체)" : ""}`
            : null,
          // 보낼 곳은 식별(targetSig)로 판정 — 채널 이름만 바뀐 것은 변경이 아니다.
          (b.targetSig !== undefined ? changed2(b.targetSig, m.targetSig) : changed2(b.targets, m.targets))
            ? `보낼 곳 ${targetText(targetsOf(b.targets))} → ${targetText(targetsOf(m.targets))}`
            : null,
          diff("모양", shapeText(b.template), shapeText(m.template)),
          diff("언제", timingText(b.timing), timingText(m.timing)),
          b.ping !== undefined ? diff("호출", pingText(b.ping), pingText(m.ping)) : null,
          b.mention !== undefined && changed2(b.mention, m.mention) ? `담당자 멘션 ${m.mention === true ? "켬" : "끔"}` : null,
          // '누가'(0311a) — 옛 기록(before에 actorCount 없음)은 비교하지 않는다.
          b.actorCount !== undefined && (changed2(b.actorCount, m.actorCount) || changed2(b.actorSig, m.actorSig))
            ? `보낼 사람(발동자) ${num(b.actorCount) ?? 0} → ${num(m.actorCount) ?? 0}명${num(b.actorCount) === num(m.actorCount) ? "(교체)" : ""}`
            : null,
          b.excludeCount !== undefined && changed2(b.excludeCount, m.excludeCount) ? `제외할 사람 ${num(b.excludeCount) ?? 0} → ${num(m.excludeCount) ?? 0}명` : null,
          b.digestAt !== undefined && changed2(b.digestAt, m.digestAt) ? `요약 시각 ${str(b.digestAt) ?? "기본"} → ${str(m.digestAt) ?? "기본"}` : null,
          b.honorDnd !== undefined && changed2(b.honorDnd, m.honorDnd) ? `방해금지 ${m.honorDnd === true ? "지킴" : "무시"}` : null,
        ];
        const changed = changes.filter((c): c is string => !!c);
        return join(
          changed.length ? `수정: ${changed.join(" · ")}` : "수정(설정 그대로)",
          changes[0] ? null : onOff(m.enabled),
        );
      }
      const targets = targetsOf(m.targets);
      return join(
        m.created === true ? "새 규칙" : "수정",
        onOff(m.enabled),
        m.source === "activity" ? "활동 기록" : "알림",
        num(m.typeCount) !== null ? `${num(m.typeCount)}종` : null,
        num(m.actorCount) ? `보낼 사람(발동자) ${num(m.actorCount)}명` : null,
        targets.length ? `→ ${targetText(targets)}` : null,
        m.template === "detailed" ? "자세히" : m.template === "short" ? "짧게" : null,
        m.timing === "digest" ? "요약으로만" : null,
      );
    }
    case "slack_resend": {
      const n = num(m.count);
      return n === null ? "실패 건 다시 보내기" : `실패 ${n}건 다시 보내기`;
    }
    case "slack_connection_broken":
      return m.code === "missing_scope" ? "앱 권한 부족 — 권한 추가 후 새 토큰 필요" : "토큰이 거절됨 — 새 토큰 필요";
    case "slack_link_owner": {
      const n = num(m.count);
      return n === null ? "이메일 일치 후보 연결" : `이메일 일치 후보 ${n}명 연결`;
    }
    case "makeedu_paid_recovery": {
      const count = num(m.count);
      return count === null ? "수납 입력값 복구" : `수납 ${count}건 복구 · 환불·확정·배분값 보존`;
    }
    case "sheets_sync_now": {
      const rows = num(m.rows);
      return rows === null ? "시트 내보내기 실행" : `시트 내보내기 실행 (${rows.toLocaleString("ko-KR")}행)`;
    }
    case "intake_push_enqueue": {
      const n = num(m.count);
      return n === null ? "상담 역동기화 요청" : `상담 ${n}건 역동기화 요청`;
    }
    case "ai_prompt_save":
      return "프롬프트 저장(새 버전)";
    case "ai_prompt_reset":
      return "기본 프롬프트로 복원";
    case "teacher_portfolio_refresh": {
      const teachers = num(m.teachers);
      const closed = Array.isArray(m.closedMonths) ? m.closedMonths.filter((v): v is string => typeof v === "string") : [];
      return join(
        m.trigger === "cron" ? "매일 자동 집계" : "지금 집계",
        teachers === null ? null : `강사 ${teachers}명`,
        closed.length ? `마감 ${closed.join(", ")}` : null,
      );
    }
    case "student_contribution_refresh":
      return join(m.trigger === "cron" ? "매일 자동 집계" : "지금 집계", `원생 ${num(m.students) ?? 0}명`, `저장 ${num(m.written) ?? 0}건`, `마감 ${num(m.closed) ?? 0}건`);
    case "student_contribution_settings_save":
      return join("지난 실적까지 현재 배점 적용", `지점 합계 ${num(m.beforeTotal) ?? 0} → ${num(m.afterTotal) ?? 0}`);
    case "student_parent_events_import":
      return join("운영 스크립트 실행 · 원장 승인", `행사 ${num(m.events) ?? 0}개`, `학생 ${num(m.students) ?? 0}명`, `학생별 참석 ${num(m.studentEvents) ?? 0}건`, "배점은 별도 활성화");
    case "student_parent_events_revoke":
      return join("운영 스크립트 실행 · 원장 승인", "연결 취소 · 원본 보존", str(m.reason), "점수는 다음 집계에서 정정");
    case "student_contribution_summary_generate": {
      const outcome = ({ saved: "저장 완료", failed: "생성 실패", quota: "일일 한도 도달", busy: "중복 요청 중단",
        unavailable: "요약 조건 미충족", input_limit: "입력량 제한", source_changed: "원본 변경으로 저장 중단" } as Record<string, string>)[str(m.outcome) ?? ""] ?? "결과 확인 필요";
      return join(outcome, m.providerRequested === true ? "AI 요청함" : "AI 요청 전", num(m.itemCount) === null ? null : `발췌 ${num(m.itemCount)}건`, str(m.model) || null);
    }
    case "student_contribution_signal_cancel":
    case "student_contribution_signal_rejudge":
      return typeof m.reason === "string" ? m.reason : null;
    case "student_history_rebuild": {
      const what = { makeedu: "메이크에듀 줄 다시 세기", aywa: "에이와 밤 집계 손 실행", revert: "되돌리기" }[String(m.kind)] ?? null;
      return join(what, typeof m.rows === "number" ? `${m.rows}줄` : null, typeof m.note === "string" ? m.note : null);
    }
    case "video_unknown_class_fix": {
      const how = { 담임배정: "담임 배정", 숙제: "영상 숙제", 반하나: "그날 반 하나", revert: "되돌리기" }[String(m.how)] ?? null;
      return join(how ? `${how}로` : null, typeof m.className === "string" ? m.className : null, typeof m.postedOn === "string" ? `${m.postedOn} 영상` : null);
    }
    case "student_contribution_referral_backfill":
    case "student_contribution_referral_link":
      return join(m.source === "backfill" ? "지난 소개 자동 연결" : "소개자 직접 확인", typeof m.evidence === "string" ? m.evidence : null);
    case "teacher_evaluation_satisfaction": {
      const kind = { apply: "글 반영", dismiss: "글 무시", cancel: "글 반영 취소", claim_add: "클레임·칭찬 넣기", claim_cancel: "클레임·칭찬 취소" }[String(m.kind)] ?? null;
      const points = num(m.points);
      const day = typeof m.postedOn === "string" ? m.postedOn : typeof m.occurredOn === "string" ? m.occurredOn : null;
      return join(kind, m.verdict === "plus" ? "가점" : m.verdict === "minus" ? "감점" : null, points === null ? null : `${points > 0 ? "+" : ""}${points}점`, day);
    }
    case "teacher_portfolio_recompute": {
      const months = Array.isArray(m.months) ? m.months.filter((v): v is string => typeof v === "string") : [];
      const closed = num(m.closedRows);
      const open = num(m.openRows);
      return join(months.length ? `${months[0]} ~ ${months.at(-1)}` : null, closed === null ? null : `마감 ${closed}행`, open ? `집계 중 ${open}행` : null);
    }
    case "teacher_portfolio_rule_patch": {
      const months = Array.isArray(m.months) ? m.months.filter((v): v is string => typeof v === "string") : [];
      const rows = num(m.rows);
      const excused = num(m.excused);
      return join(months.length ? months.join(", ") : null, rows === null ? null : `${rows}행`, excused === null ? null : `감점 뺀 퇴원 ${excused}건`);
    }
    case "teacher_evaluation_settings_save": {
      const enabled = num(m.enabled);
      const maxTotal = num(m.maxTotal);
      return join(enabled === null ? null : `지표 ${enabled}개`, maxTotal === null ? null : `만점 ${maxTotal}점`);
    }
    case "teacher_evaluation_preset_save":
    case "teacher_evaluation_preset_delete":
      return typeof m.name === "string" ? `‘${m.name}’` : null;
    case "teacher_evaluation_entries_save": {
      const saved = num(m.saved);
      const cleared = num(m.cleared);
      return join(saved ? `${saved}칸 입력` : null, cleared ? `${cleared}칸 비움` : null);
    }
    case "ment_style_rebuild": {
      const built = num(m.built);
      const unchanged = num(m.unchanged);
      const insufficient = num(m.insufficient);
      const rejected = num(m.rejected);
      const failed = num(m.failed);
      return join(
        m.trigger === "cron" ? "주간 자동 갱신" : "지금 갱신",
        built === null ? null : `갱신 ${built}명`,
        unchanged ? `변동 없음 ${unchanged}명` : null,
        insufficient ? `표본 부족 ${insufficient}명` : null,
        rejected ? `반려 ${rejected}명` : null,
        failed ? `실패 ${failed}명` : null,
      );
    }
    case "classroom_update": {
      const from = str(m.from);
      const to = str(m.to);
      const cap = str(m.capacity);
      return join(from && to && from !== to ? `이름 ${from} → ${to}` : null, cap ? `정원 ${cap}` : null);
    }
    case "notice_popup_update":
      return "내용 수정";
    case "notice_popup_toggle":
      return m.active === true ? "노출 켜기" : m.active === false ? "노출 끄기" : null;
    case "owner_subject_absorb": {
      const moved = num(m.moved);
      return moved === null ? "연결 데이터 이동" : `연결 데이터 ${moved.toLocaleString("ko-KR")}건 이동`;
    }
    case "owner_subject_delete": {
      const key = str(m.key);
      return key ? `과목 「${ctx.subjectLabel(key)}」 설정에서 제거(사용 데이터 없음)` : null;
    }
    case "staff_role_change": {
      const from = roleKo(m.from);
      const to = roleKo(m.to);
      return from && to ? `역할 ${from} → ${to}` : null;
    }
    case "staff_delete": {
      const r = roleKo(m.role);
      // 스크립트 삭제 행은 role 대신 함께 지운 문서 수를 남긴다 — 데이터가 사라진 사실이라 꼭 보인다.
      const docs = num(m.docs);
      return join(r ? `삭제 당시 역할: ${r}` : null, docs ? `문서 ${docs}건 함께 삭제` : null);
    }
    case "staff_protected_refused": {
      const what = m.attempt === "role" ? "역할 변경" : m.attempt === "delete" ? "삭제" : "재직 상태 변경";
      return `보호 계정 ${what} 시도 — 거절`;
    }
    case "staff_status_change": {
      const label = (v: unknown) =>
        v === "active" ? "재직" : v === "inactive" ? "퇴사" : v === "pending" ? "대기" : null;
      const from = label(m.from);
      const to = label(m.to);
      return to ? (from && from !== to ? `재직 상태 ${from} → ${to}` : `재직 상태 ${to}`) : null;
    }
    case "staff_teacher_view_access": {
      // '강사뷰 접근'(다른 강사 뷰 열람) 토글 — 대상은 targetLabel(직원 이름)이 이미 보여준다.
      return m.enabled === true ? "허용으로 변경" : m.enabled === false ? "차단으로 변경" : null;
    }
    case "staff_teacher_view_lang": {
      // 강사 화면 기본 언어(0248a) — **화면 글자만** 바뀐다(권한·담임·시수 무관).
      // 🔴 이 로그를 담임/원어민 판정 변경으로 읽지 말 것(축이 다르다 — 0248a 주석).
      const label = (v: unknown) => (v === "ko" ? "한국어" : v === "en" ? "English" : "지정 없음");
      return `강사 화면 기본 언어: ${label(m.from)} → ${label(m.to)}`;
    }
    case "staff_password_reset": {
      const mode = str(m.mode);
      if (mode === "temp") return "임시 비밀번호 발급";
      if (mode === "custom") return "비밀번호 직접 설정";
      return null; // 비밀번호 자체는 metadata에 없다(있어서도 안 된다)
    }
    case "self_password_change":
      return null; // metadata 없음 — 대상 열이 본인 이름을 보여준다
    case "staff_email_change":
    case "self_email_change": {
      const from = str(m.from);
      const to = str(m.to);
      return from && to ? `${from} → ${to}` : (to ?? null);
    }
    case "self_report_name_change": {
      const name = str(m.reportName);
      return name ? `발송용 이름 "${name}"` : "발송용 이름 해제(실명으로 발송)";
    }
    case "staff_contract_extend": {
      const seq = num(m.seq);
      const start = str(m.startDate);
      const end = str(m.endDate);
      return join(seq === null ? null : `${seq}차 계약`, start && end ? `${start} ~ ${end}` : null);
    }
    case "staff_contract_update": {
      // kind='note'(시트 이관 이력 줄)는 차수가 없다 — 영문 "note"를 그대로 내보내지 않는다.
      const isNote = str(m.kind) === "note";
      const seq = num(m.seq);
      const start = str(m.startDate);
      const end = str(m.endDate);
      return join(
        isNote ? "이력 줄" : seq === null ? null : `${seq}차 계약`,
        start && end ? `${start} ~ ${end}` : null,
      );
    }
    case "staff_contract_delete": {
      const seq = num(m.seq);
      return seq === null ? null : `${seq}차 계약 삭제`;
    }
    case "staff_contract_file_add":
    case "staff_contract_file_delete": {
      const name = str(m.fileName);
      return name ? `파일 ${name}` : null;
    }
    case "staff_contract_pdf_extract": {
      // metadata.filled = 추출된 필드 키 배열(영문) — 개수만 보여주고 키 자체는 노출하지 않는다.
      const n = Array.isArray(m.filled) ? m.filled.length : null;
      return n === null ? null : `PDF에서 항목 ${n}개 추출`;
    }
    case "invoice_manual_void": {
      const w = won(m.amountTotal);
      return join(ctx.nameOf(m.studentId), str(m.period), w ? `청구액 ${w} 취소` : "취소");
    }
    case "invoice_manual_paid": {
      const to = won(m.paidTo);
      const method = str(m.method);
      const METHOD: Record<string, string> = { card: "카드", transfer: "계좌이체", cash: "현금", other: "기타" };
      return join(ctx.nameOf(m.studentId), str(m.period), to ? `수납 ${to} 완납` : "완납", method ? METHOD[method] ?? null : null);
    }
    case "invoice_create": {
      const w = won(m.amountTotal);
      return join(ctx.nameOf(m.studentId), w ? `청구액 ${w}` : null);
    }
    case "exam_create": {
      const subject = str(m.subject);
      const type = str(m.examType);
      return join(subject ? ctx.subjectLabel(subject) : null, type ? `${EXAM_TYPE_LABEL[type] ?? type} 시험` : null);
    }
    case "exam_delete":
      return null; // metadata = 시험 uuid뿐(삭제되어 해석 불가)
    case "exam_scores": {
      const saved = num(m.saved);
      const students = num(m.students);
      const same = num(m.todaysMathSame);
      if (saved === null && students === null) return null;
      return join(`학생 ${students ?? "?"}명 중 점수 ${saved ?? "?"}건 저장`, same ? `오늘 수학 결과와 같은 값 ${same}건` : null);
    }
    // 수업보고서 저장 — 종전처럼 기본 분기(학생 · 반 · 날짜 …)를 그대로 쓰고, 오늘 수학 출처 표시만 덧붙인다(2026-10-18).
    // 🔴 이 case가 기본 분기를 가로채면 옛 기록까지 상세 칸이 빈다 — 표시 키만 떼어 기본 분기로 돌린다.
    case "lesson_report_save": {
      const { todaysMathSame, ...rest } = m;
      const same = Array.isArray(todaysMathSame) ? todaysMathSame.map((w) => ({ daily: "일일", check: "확인" } as Record<string, string>)[String(w)]).filter(Boolean) : [];
      return join(auditDetail("lesson_report_save:base", rest, ctx), same.length ? `${same.join("·")}테스트가 오늘 수학 결과와 같은 값` : null);
    }
    case "class_salary_update": {
      const fmt = (v: unknown): string | null => {
        if (!v || typeof v !== "object") return null;
        const o = v as Record<string, unknown>;
        const rate = num(o.commissionRate);
        return join(str(o.salaryGroup) ? `과정 ${str(o.salaryGroup)}` : "과정 자동", rate === null ? "배분율 기본" : `배분율 ${rate}%`);
      };
      const before = fmt(m.before);
      const after = fmt(m.after);
      return after ? (before ? `${before} → ${after}` : `새 설정: ${after}`) : null;
    }
    case "session_splits_save": {
      const cb = won(m.confirmedBefore);
      const ca = won(m.confirmedAfter);
      const saved = num(m.saved);
      return join(
        str(m.period),
        saved === null ? null : `분배 ${saved}건 저장`,
        m.beforeKnown === false ? (ca ? `청구 기준 합계 ${ca}` : null) : cb && ca ? `청구 기준 합계 ${cb} → ${ca}` : null,
      );
    }
    case "payroll_jj_units_take":
    case "payroll_jj_units_return": {
      const units = num(m.units);
      // 회차 확정의 JJ실 줄에서 준 것 — 날짜가 여럿일 수 있고(첫 날 외 N일) 학생 수로 적는다.
      const dates = Array.isArray(m.dates) ? m.dates.filter((x): x is string => typeof x === "string") : [];
      const students = num(m.students);
      return join(
        dates.length > 1 ? `${dates[0]} 외 ${dates.length - 1}일` : str(m.date),
        students ? `${students}명` : ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        `${ctx.nameOf(m.userId) ?? "선생님"} ${action === "payroll_jj_units_take" ? "몫으로 줌" : "몫에서 되돌림"}${units ? ` · ${units}시수` : ""}`,
        // 저장이 도중에 실패해 그 묶음의 일부만 반영됐다 — 적힌 시수 전부가 옮겨진 것은 아니다.
        m.partial === true ? "일부만 반영" : null,
      );
    }
    case "payroll_seat_share_set": {
      // 회차 확정의 자리 몫 줄 — 그 달 그 반의 자리(JJ실·랩실) 몫에서 선생님 몫으로 돌린 시수(반 전체 값 · 따로 정한 학생 수).
      // 학생별 값만 바꾼 저장도 드러나게 앞뒤 값이 다른 학생 수를 적는다(반 전체 값은 그대로일 수 있다).
      const units = num(m.units);
      const own = num(m.students);
      const before = (m.before ?? {}) as Record<string, unknown>;
      const was = num(before.units);
      const map = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      const now = map(m.studentUnits);
      const prev = map(before.studentUnits);
      const moved = now && prev ? [...new Set([...Object.keys(now), ...Object.keys(prev)])].filter((id) => now[id] !== prev[id]).length : 0;
      return join(
        str(m.period),
        ctx.nameOf(m.classId),
        `${ctx.nameOf(m.userId) ?? "선생님"} 몫으로 반 전체 ${was ?? 0} → ${units ?? 0}시수`,
        own ? `따로 정한 학생 ${own}명` : null,
        moved ? `학생별 값 ${moved}명 바뀜` : null,
      );
    }
    case "payroll_sheet_visible_set":
      return join(str(m.period), ctx.nameOf(m.userId), m.visible === true ? "선생님 출석부에 보이게 켬" : "선생님 출석부에서 감춤");
    case "payroll_sheet_levels_set": {
      const levels = Array.isArray(m.levels) ? m.levels.filter((x): x is string => typeof x === "string") : [];
      return join(ctx.nameOf(m.userId), levels.length > 0 ? `${levels.join("·")} 학생만` : "모든 학년");
    }
    case "payroll_sheet_special_scope_set":
      return join(ctx.nameOf(m.userId), m.includeSpecial === true ? "특강은 학년 제한 없이 포함" : "특강도 대상 학년만 포함");
    case "payroll_contract_work_days_set": {
      const days = Array.isArray(m.workDays) ? m.workDays.filter((x): x is string => typeof x === "string") : [];
      return join(ctx.nameOf(m.userId), days.length > 0 ? `근로 요일 ${workDaysLabel(days)}` : "근로 요일 정하지 않음(모든 요일)");
    }
    case "payroll_mark_paid":
    case "payroll_auto_compute":
    case "payroll_upsert": {
      const w = won(m.total);
      return join(ctx.nameOf(m.userId), w ? `지급 합계 ${w}` : null);
    }
    case "withdrawal_update": {
      const reason = reasonDisplay(str(m.reason));
      return join(ctx.nameOf(m.studentId), reason ? `사유: ${reason}` : null, detailText(m.detail));
    }
    case "withdrawal_consultation_step": {
      const STEP: Record<string, string> = {
        adminCalledParent: "관리자 학부모 통화",
        teacherCalledParent: "강사 학부모 통화",
        talkedWithStudent: "학생 면담",
      };
      const step = STEP[str(m.step) ?? ""] ?? null;
      return join(ctx.nameOf(m.studentId), step ? `${step} ${m.done ? "체크" : "해제"}` : null);
    }
    case "intake_token_toggle": {
      const a = str(m.change);
      if (a === "close") return "링크 닫기";
      if (a === "reopen") return "링크 다시 열기";
      if (a === "expire") {
        const d = str(m.expiresOn);
        return d ? `만료일 ${d}로 변경` : "만료일 변경";
      }
      return null;
    }
    // 교재 신청 전수 감사(2026-09-09) — 금액 수정의 '범인 찾기'가 목적이라 **전후 값**을 그대로 적는다.
    case "textbook_order_update": {
      const changes = Array.isArray(m.changes) ? (m.changes as TextbookFieldChange[]) : null;
      return join(str(m.target), describeTextbookChanges(changes));
    }
    case "textbook_order_create":
    case "textbook_order_delete": {
      // 만든·지운 시점의 값(금액 포함)을 남긴다 — 지워지면 행에서 되짚을 수 없다.
      const price = typeof m.price === "number" ? `${m.price.toLocaleString("ko-KR")}원` : null;
      const count = typeof m.count === "number" && m.count > 1 ? `${m.count}명 일괄` : null;
      return join(str(m.target), price, count);
    }
    case "textbook_order_check": {
      const label = TEXTBOOK_CHECK_LABEL[str(m.field) ?? ""] ?? str(m.field);
      return join(str(m.target), label ? `${label} ${m.checked ? "체크" : "해제"}` : null);
    }
    // 학생 기록 변경 전수 감사(2026-08-18) — 누가·언제·어느 학생을 바꿨는지 역검수용.
    case "student_withdraw": {
      const reason = reasonDisplay(str(m.reason));
      return join(
        ctx.nameOf(m.studentId),
        // 퇴원 예약(미래 퇴원일 — 그날 cron이 처리) · 예약이 그날 적용된 것 — 원장 2026-09-28.
        m.scheduled ? "퇴원 예약" : m.applied === "scheduled" ? "예약된 퇴원 적용" : null,
        str(m.date) ? `퇴원일 ${str(m.date)}` : null,
        reason ? `사유: ${reason}` : null,
        detailText(m.detail),
        str(m.memo),
      );
    }
    // 퇴원보고서를 거치지 않은 퇴원·새 퇴원 예약(0454a DB 트리거) — 막지 않고 남긴다. 무엇이 · 언제로.
    case "student_withdrawn_without_report": {
      const date = str(m.date);
      const prev = str(m.previousDate);
      const what =
        m.kind === "schedule"
          ? join("퇴원 예약", date ? `예약일 ${date}` : null)
          : m.kind === "reschedule"
            ? join("퇴원 예약일 변경", prev && date ? `${prev} → ${date}` : date)
            : join("퇴원", date ? `퇴원일 ${date}` : null);
      return join(ctx.nameOf(m.studentId), what, "퇴원보고서 없음");
    }
    // 옛 퇴원 기록의 빈 사유 채움(원장 승인 행만 · 적용 스크립트) — 누구 · 어떤 사유로.
    case "withdrawal_reason_restore": {
      if (m.reverted) return join(ctx.nameOf(m.studentId), "복원한 사유를 되돌림");
      const reason = reasonDisplay(str(m.reason));
      return join(ctx.nameOf(m.studentId), reason ? `사유: ${reason}` : null, detailText(m.detail), str(m.memo));
    }
    case "student_hold":
    case "student_restore": {
      // 휴원 메모는 여기 말고 남는 자리가 없다(enrollments·students에 칸이 없다) — 적혔으면 보여 준다.
      if ("cancelledWithdrawal" in m)
        return join(ctx.nameOf(m.studentId), "퇴원 예약 취소", str(m.cancelledWithdrawal) ? `예약일 ${str(m.cancelledWithdrawal)}` : null);
      return join(ctx.nameOf(m.studentId), str(m.memo));
    }
    case "student_siblings_update": {
      const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "").join(", ") : "");
      return join(
        ctx.nameOf(m.studentId),
        names(m.added) ? `형제 지정 ${names(m.added)}` : null,
        names(m.excluded) ? `형제 아님 ${names(m.excluded)}` : null,
        names(m.removed) ? `형제 해제 ${names(m.removed)}` : null,
      );
    }
    case "student_english_name_update":
      return join(ctx.nameOf(m.studentId), `영문 이름 ${str(m.before) || "없음"} → ${str(m.after) || "없음"}`);
    case "student_update": {
      const from = str(m.statusFrom);
      const to = str(m.statusTo);
      const statusChanged =
        from && to && from !== to
          ? `상태 ${STUDENT_STATUS_LABEL[from] ?? from} → ${STUDENT_STATUS_LABEL[to] ?? to}`
          : null;
      return join(
        ctx.nameOf(m.studentId),
        statusChanged,
        // 수정 폼으로 건·푼 퇴원 예약(원장 2026-09-28) — 상태가 그대로여도 남는다.
        str(m.scheduledWithdrawal) ? `퇴원 예약 ${str(m.scheduledWithdrawal)}` : null,
        str(m.cancelledWithdrawal) ? `퇴원 예약 취소(예약일 ${str(m.cancelledWithdrawal)})` : null,
      );
    }
    case "student_create": {
      return ctx.nameOf(m.studentId) ?? str(m.studentName);
    }
    case "student_delete": {
      // 삭제된 학생은 uuid로 이름을 되찾을 수 없다 — 기록 시점의 이름을 metadata에 실어 보존.
      return str(m.studentName) ?? ctx.nameOf(m.studentId);
    }
    // 인재원 학습 계정 짝(2026-09-10) — **어느 계정**이 걸렸고 끊겼는지(대상 열이 학생 이름이다). 끊은 기록도 옛 계정을
    // 싣는다 — 잘못 이은 짝을 나중에 되짚는 게 이 로그의 목적이다. 인재원 이름이 로그인 아이디 그대로면 한 번만 적는다.
    case "student_ijw_link":
    case "student_ijw_link_bulk":
    case "student_ijw_unlink": {
      const id = str(m.ijwId);
      if (!id) return null;
      const name = str(m.ijwName);
      return name && name !== id ? `인재원 계정 ${id}(${name})` : `인재원 계정 ${id}`;
    }
    // 인재원에 학교·학년·생일 보내기(2026-10-08) — 몇 명 보냈고 인재원이 몇 명 반영했나.
    case "ijw_profile_push": {
      const n = (v: unknown) => (Array.isArray(v) ? v.length : Number(v) || 0);
      const parts = [`보냄 ${n(m.sent)}명`, `반영 ${n(m.updated)}명`];
      if (n(m.notFound)) parts.push(`인재원에 없는 아이디 ${n(m.notFound)}개`);
      if (n(m.invalid)) parts.push(`못 읽은 값 ${n(m.invalid)}개`);
      return parts.join(" · ");
    }
    // 수강 단위 대기/해제(2026-09-07 시간표 드래그 · 2026-09-16 휴원 다이얼로그 부분 휴원) —
    // "어느 반이 언제 멈췄고 언제 다시 돌았나"가 이 로그의 목적이다(enrollments엔 담을 칸이 없다).
    case "enrollment_hold":
    case "enrollment_resume": {
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        str(m.date) ? `기준일 ${str(m.date)}` : null,
      );
    }
    case "enrollment_end": {
      const reason = reasonDisplay(str(m.reason));
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        str(m.date) ? `종료일 ${str(m.date)}` : null,
        reason ? `사유: ${reason}` : null,
        detailText(m.detail),
      );
    }
    // 처리 결과(2026-10-23) = 이 동작으로 학생 퇴원·수강 종료가 끝났는지 · 처리 예약인지 + 끝난 수업(요청 때 반 이름). 옛 기록은 결과 칸이 없다.
    // 2026-11-03: 날짜 이름 = 마지막 수업일 · 작성 요청은 관리자 승인 생략 보고서(작성 강사 · 과목) · 취소는 '환불 진행 전 확인'을 받은 데스크 요청서 수.
    case "withdrawal_report_update": {
      const ended = Array.isArray(m.endedClasses) ? m.endedClasses.flatMap((v) => str(v) ?? []) : [];
      const skipped = Array.isArray(m.managerSkipped) ? m.managerSkipped.flatMap((v) => str(v) ?? []) : [];
      const notified = Array.isArray(m.deskRefundsNotified) ? m.deskRefundsNotified.length : 0;
      return join(str(m.operation), str(m.result), str(m.date) ? `마지막 수업일 ${str(m.date)}` : null, ended.length ? `끝난 수업 ${ended.join("·")}` : null,
        skipped.length ? `관리자 승인 생략 ${skipped.join(", ")}` : null, notified ? `데스크 환불 ${notified}건 '환불 진행 전 확인' 알림` : null);
    }
    // 퇴원보고서 환불 승인(2026-10-29) — 어느 달 청구 · 금액 · 마지막 수업일 · 데스크 단계(2026-11-03 — 환불이 끝나야 처리하는지).
    // 만든 환불 요청서는 refund_request_create에 같은 documentId로 남는다(데스크 단계에 못 이으면 refund_request_delete로 되돌린 기록).
    case "withdrawal_refund_approve":
      return join(Array.isArray(m.items) ? `${m.items.slice(0, 3).map(String).join(", ")}${m.items.length > 3 ? ` 외 ${m.items.length - 3}건` : ""}` : str(m.invoicePeriod) ? `${str(m.invoicePeriod)} 청구` : null, str(m.totalAmount), str(m.effectiveDate) ? `마지막 수업일 ${str(m.effectiveDate)}` : null, str(m.deskStep), "환불 요청서 작성");
    // 잘못 만든 수업 이력 **삭제**(원장·super_admin) — 행이 사라지므로 이 로그가 유일한 흔적이다.
    // metadata.snapshot에 삭제된 행 전체가 들어 있다(뷰어 title 툴팁의 원문 JSON으로 확인).
    case "enrollment_delete": {
      const cls = str(m.className) ?? ctx.nameOf(m.classId);
      const snap = (m.snapshot ?? {}) as Meta;
      const start = str(snap.startDate);
      const end = str(snap.endDate);
      const period = start ? (end ? `${start} ~ ${end}` : `${start}부터`) : null;
      return join(ctx.nameOf(m.studentId), cls, period, "삭제됨(복구는 감사로그 원문 참조)");
    }
    case "student_bulk_withdraw":
    case "student_bulk_delete": {
      const n = num(m.count);
      return n === null ? null : `${n}명 (관리 도구 · 수강 없는 학생 정리)`;
    }
    case "enrollment_orphan_close": {
      const n = num(m.count);
      // 종료일은 수강마다 다를 수 있다 — 시작한 수강은 처리한 날로, 아직 시작 전인 수강은 그 시작일로 닫는다.
      // 그래서 "종료일"이 아니라 처리한 날을 적고, 시작일로 닫은 건수를 따로 적는다.
      const future = num(m.futureCount);
      return join(
        n === null ? null : `${n}건 (관리 도구 · 퇴원 학생의 남은 수강)`,
        str(m.processedOn) ? `처리일 ${str(m.processedOn)}` : null,
        future && future > 0 ? `시작 전 수강 ${future}건은 시작일로 종료` : null,
        m.uncertain === true ? "응답을 받지 못함(적용 여부 미확인)" : m.partial === true ? "중간에 멈춤" : null,
      );
    }
    case "newcomer_check":
    case "newcomer_uncheck": {
      // 항목 이름은 신규생 체크리스트 정의가 단일 소스 — 여기 라벨을 다시 적으면 항목을 바꿀 때 갈린다.
      const item = ONBOARDING_ITEMS.find((i) => i.key === str(m.itemKey));
      // 상담 등록·수정 화면에서 고른 체크(0295a 반자동)는 그 사실을 적는다 — 손 체크와 구별돼야 되짚을 수 있다.
      return join(
        ctx.nameOf(m.studentId),
        item?.label ?? str(m.itemKey),
        str(m.doneOn),
        str(m.via) === "consultation" ? "원생상담으로" : null,
      );
    }
    case "enrollment_assign": {
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        str(m.startDate) ? `시작 ${str(m.startDate)}` : null,
      );
    }
    case "enrollment_move": {
      const dest = ctx.nameOf(m.classId);
      return join(ctx.nameOf(m.studentId), dest ? `→ ${dest}` : null);
    }
    case "enrollment_move_batch": {
      const n = num(m.count);
      const eff = str(m.effectiveDate);
      return join(n === null ? null : `${n}건 이동`, eff ? `적용일 ${eff}` : null);
    }
    case "enrollment_days_update": {
      const n = num(m.count);
      return n === null ? null : `${n}건`;
    }
    case "enrollment_lab_separate":
      return join(ctx.nameOf(m.studentId), ctx.nameOf(m.classId), m.on === true ? "켬" : m.on === false ? "끔" : null);
    case "enrollment_dates_update": {
      const f = str(m.field);
      // 조용히 깨지는 걸 **알고도** 저장한 정정은 그 사실을 함께 적는다(2026-09-10) — 저장 전에
      // 확인을 받은 건이라, 나중에 "왜 그날 명단에 없지"·"왜 이동이 종료로 뜨지"를 되짚을 흔적이다.
      const outside = num(m.attendanceOutside);
      const pairAnchor = str(m.transferPairBroken);
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        f ? `${f === "start" ? "시작" : "종료"}일 ${str(m.from) ?? "—"} → ${str(m.to) ?? "—"}` : null,
        outside && outside > 0 ? `출결 ${outside}건이 기간 밖(확인 후 저장)` : null,
        pairAnchor ? `반 이동 짝(${pairAnchor}) 끊김(확인 후 저장)` : null,
      );
    }
    case "student_merge": {
      const merged = str(m.mergedName);
      // 표를 하나씩 옮기다 멈춘 병합 — 앞 단계는 이미 옮겨진 채라, 멈춘 자리를 함께 적는다.
      const failed = str(m.failedStep);
      // 응답을 받지 못한 단계는 적용됐는지 모른다 — "멈췄다"고만 적으면 바뀐 것이 없다고 읽힌다.
      const where = failed ? `(${failed})` : "";
      return join(
        ctx.nameOf(m.studentId),
        merged ? `← ${merged} 병합` : null,
        m.uncertain === true ? `응답을 받지 못함${where} — 적용 여부 미확인` : m.partial === true ? `중간에 멈춤${where}` : null,
      );
    }
    case "class_end_term": {
      const d = str(m.closedAt);
      // 2026-11-02~ 종강이 시간표 배치도 닫는다(`schedules` = 닫은 줄). 이름·수강은 그대로이고 배치만 닫은 기록
      // (밤 정리가 옛 종강 반의 남은 배치를 거둔 것)은 두 번째 종강처럼 읽히지 않게 '정리'로 적는다.
      const n = Array.isArray(m.schedules) ? m.schedules.length : 0;
      const tidyOnly = n > 0 && str(m.fromName) === str(m.toName) && m.affectedStudents === 0;
      return join(
        d ? `종강일 ${d}` : null,
        n > 0 ? (tidyOnly ? `남은 시간표 배치 ${n}줄 정리` : `시간표 배치 ${n}줄 닫음`) : null,
      );
    }
    // 반 운영 기간이 끝나 그 반 수강을 닫음(0274a, 2026-09-18 — 매일 밤 cron, 행위자 '시스템(운영 기간 종료)').
    case "class_period_enrollments": {
      const d = str(m.periodEnd);
      const n = typeof m.changed === "number" ? m.changed : null;
      return join(d ? `운영 종료일 ${d}` : null, n !== null ? `수강 ${n}건 종료` : null);
    }
    // 반 수정(2026-08-04 신설) — 그동안 **폼 저장에 로그가 아예 없어서** 담당·강의실이 언제 누구로
    // 바뀌었는지 되살릴 근거가 없었다. 바뀐 항목만 적는다(안 바뀐 건 안 적는다).
    // 🔴 2026-08-05: 예전엔 항목 이름만 적어 "변경: 강의실"이었다 — 어디서 어디로 바뀌었는지가 없어
    //    이력으로 쓸 수가 없었다(원장 지시). 이제 `changes`에 이전값·이후값이 함께 온다.
    //    ⚠️ 그 이전에 쌓인 행은 `changed`(이름만)뿐이다 — 없는 화살표를 지어내지 말고 그대로 보여준다.
    case "class_update": {
      const changes = Array.isArray(m.changes) ? m.changes : [];
      const parts = changes
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          const o = c as Meta;
          const field = str(o.field);
          if (!field) return null;
          // 배치처럼 짝이 없는 항목은 이름만. 값이 비었으면 '없음'(빈칸으로 두면 화살표가 허공을 가리킨다).
          if (!("from" in o) && !("to" in o)) return field;
          return `${field} ${str(o.from) ?? "없음"} → ${str(o.to) ?? "없음"}`;
        })
        .filter((v): v is string => !!v);
      // 예약 적용이 규칙 때문에 건너뛴 항목(2026-09-30 — ClassNote 보드 이름 모양의 반 이름).
      const skipped = (Array.isArray(m.skipped) ? m.skipped : [])
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          const o = c as Meta;
          const field = str(o.field);
          return field ? `${field} ${str(o.to) ?? ""} 적용 안 함(${str(o.reason) ?? "규칙 위반"})` : null;
        })
        .filter((v): v is string => !!v);
      const fields = Array.isArray(m.changed) ? m.changed.filter((v): v is string => typeof v === "string") : [];
      const head = parts.length > 0 ? `변경: ${parts.join(" · ")}` : fields.length > 0 ? `변경: ${fields.join(", ")}` : null;
      // 왜 바뀌었나(2026-10-01) — 종강·폐지 반 이름을 비운 기록·레벨 변경처럼 화면 저장이 아닌 변경의 사유.
      return join(head, skipped.length ? skipped.join(" · ") : null, str(m.note));
    }
    case "class_handover_schedule": {
      const n = ctx.nameOf(m.newTeacherId);
      const d = str(m.effectiveDate);
      return join(n ? `새 담임 ${n}` : null, d ? `${d}부터` : null);
    }
    case "class_handover_apply": {
      const n = ctx.nameOf(m.newTeacherId);
      return n ? `새 담임 ${n}` : null;
    }
    // 반 임시 위임(0173a) — 담임은 안 바뀐다. "누가 · 언제까지" 둘 다 없으면 로그를 읽을 수 없으니 함께 적는다.
    case "class_delegate": {
      const n = ctx.nameOf(m.delegateUserId);
      const from = str(m.fromDate);
      const to = str(m.toDate);
      const period = from && to ? (from === to ? from : `${from}~${to}`) : (from ?? to);
      return join(n ? `대신 맡을 선생님 ${n}` : null, period ? `기간 ${period}` : null);
    }
    case "class_delegate_revoke": {
      const n = ctx.nameOf(m.delegateUserId);
      return n ? `위임 해제 ${n}` : null;
    }
    case "class_handover_bulk": {
      const to = ctx.nameOf(m.newTeacherId);
      const cls = num(m.classCount);
      const slots = num(m.slotCount);
      return join(
        to ? `새 담임 ${to}` : null,
        cls === null ? null : `반 ${cls}개 인계`,
        slots ? `교시 ${slots}개` : null,
      );
    }
    case "class_reopen_term":
    case "class_handover_cancel":
      return null; // metadata = 반 uuid뿐(대상 열이 반 이름을 보여줌)
    case "class_archive":
    case "class_unarchive": {
      const n = num(m.affectedStudents);
      if (n === null) return null;
      return action === "class_archive" ? `수강 ${n}건 종료` : `수강 ${n}건 복원`;
    }
    case "owner_integration_groups_update": {
      const subject = str(m.subject);
      const groups = num(m.groups);
      return join(
        subject ? `과목 「${ctx.subjectLabel(subject)}」` : null,
        m.enabled === true ? "통합뷰 사용" : m.enabled === false ? "통합뷰 미사용" : null,
        groups === null ? null : `그룹 ${groups}개`,
      );
    }
    case "owner_teacher_view_order_update": {
      const subject = str(m.subject);
      const count = num(m.count);
      return join(
        subject ? `과목 「${ctx.subjectLabel(subject)}」` : null,
        count === null ? null : count === 0 ? "순서 초기화" : `강사 ${count}명 순서 지정`,
      );
    }
    case "classroom_auto_assign": {
      const applied = num(m.applied);
      const rooms = num(m.rooms);
      if (applied === null && rooms === null) return null;
      return `강의실 ${rooms ?? "?"}곳에 반 ${applied ?? "?"}개 자동배정`;
    }
    case "classnote_notice_send": {
      const n = num(m.targetCount);
      return n === null
        ? "학부모 공지 발송 대기(큐 적재)"
        : `대상 ${n}명 발송 대기(큐 적재 — 연동 PC가 순차 게시)`;
    }
    case "classnote_notice_edit":
      return m.posted ? "게시된 공지 내용 수정(게시글에 반영)" : "발송 전(대기) 공지 내용 수정";
    case "classnote_notice_delete":
      return "발송 전(대기) 공지 삭제";
    case "classnote_notice_revoke": {
      const c = num(m.reportCount);
      return c === null ? "게시된 공지 게시취소(회수)" : `게시된 공지 ${c}건 게시취소(회수)`;
    }
    case "classnote_board_sync_request": {
      const c = num(m.classCount);
      const s = num(m.studentCount);
      // 자동 동기화(연동 PC가 aywa와 지난 기록을 대조해 스스로 낸 요청, 2026-10-03) — 어느 반이 왜 달라졌는지 적는다.
      if (m.auto === true) {
        const list = arr(m.classes)
          .map((x) => {
            const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
            const name = str(o.name);
            const why = arr(o.reasons).map(str).filter((r): r is string => r !== null);
            return name ? (why.length ? `${name}(${why.join(", ")})` : name) : null;
          })
          .filter((x): x is string => x !== null);
        const shown = list.slice(0, 8).join(" · ") + (list.length > 8 ? ` 외 ${list.length - 8}개` : "");
        return join(`달라진 반 ${c ?? 0}개 자동 동기화 요청`, shown || null);
      }
      const what = m.full === false ? `지목한 반·학생만(반 ${c ?? 0} · 학생 ${s ?? 0})` : "바뀐 반 전부";
      // 보고서 발송이 '반 보드 배정 전'으로 막혀 그 자리에서 낸 요청(2026-10-03) — 버튼을 누른 것과 가린다.
      // 🔴 자동(시스템이 대신 낸 요청)과 수동(사람이 버튼으로 누른 요청)을 문구로 가른다(원장 2026-10-06).
      // 새 행은 서버가 적은 `trigger`로 판정한다(호출자가 준 source는 꾸밀 수 있다). 그 값이 없는 옛 행만 source로 읽는다.
      const trigger = str(m.trigger);
      const isAuto = trigger ? trigger === "auto" : str(m.source) === "send_blocked";
      const blocked = isAuto && str(m.source) === "send_blocked" ? "보고서 발송이 반 보드 배정 전이라 막혀 자동으로 요청" : null;
      const kind = isAuto ? "자동" : "수동";
      return join(m.joined === true ? `이미 요청된 동기화에 ${kind} 합류 — ${what}` : `${what} ${kind} 동기화 요청`, blocked);
    }
    case "classnote_board_sync_report_export":
      return join(
        `변동 ${num(m.changed) ?? 0}건 · 실패 ${num(m.failed) ?? 0}건 · 보류 ${num(m.held) ?? 0}건`,
        `해제 확인 ${num(m.releaseNames) ?? 0}명(${num(m.releaseClasses) ?? 0}개 반)`,
        m.ok === false ? "멈춘 회차" : null,
      );
    case "classnote_board_sync_daily":
      return join(
        m.ok === false ? "도중에 멈춤" : null,
        `변동 ${num(m.changed) ?? 0}건 · 실패 ${num(m.failed) ?? 0}건 · 보류 ${num(m.held) ?? 0}건`,
        num(m.releasedChildren) ? `원아 해제 ${num(m.releasedChildren)}명` : null,
        num(m.releasedTeachers) ? `담임 해제 ${num(m.releasedTeachers)}건` : null,
        num(m.release) ? `해제 확인 필요 ${num(m.release)}개 반` : null,
        m.ok === false ? str(m.error) : null,
      );
    case "classnote_board_enroll":
      return join(str(m.className), m.kind === "request" ? "지금 동기화" : "정기 동기화");
    case "classnote_board_release":
      return join(str(m.className), str(m.reason), m.kind === "request" ? "지금 동기화" : "정기 동기화");
    case "classnote_board_teacher_release":
      return join(str(m.teacher) ? `${str(m.teacher)} 선생님 연결 해제` : "선생님 연결 해제", "지금 이 반 담당이 아님", m.kind === "request" ? "지금 동기화" : "정기 동기화");
    case "classnote_parent_reply_request":
      return join(`게시 명의 ${str(m.author) ?? "?"}`, num(m.length) === null ? null : `${num(m.length)}자`);
    case "classnote_parent_reply_edit_request":
    case "classnote_parent_reply_delete_request": {
      const what = action === "classnote_parent_reply_edit_request" ? "수정" : "삭제";
      return join(m.own === false ? `다른 사람 답글 ${what}(관리자)` : `내 답글 ${what}`, str(m.author));
    }
    case "classnote_parent_reply_run": {
      const verb = m.action === "edit" ? "수정" : m.action === "delete" ? "삭제" : "게시";
      if (m.ok === false) return join(`ClassNote 댓글 ${verb} 실패`, str(m.error));
      return join(`ClassNote 댓글 ${verb}`, num(m.commentId) === null ? null : `댓글 ${num(m.commentId)}`, str(m.author));
    }
    case "classnote_parent_reaction_request":
      return join(str(m.reaction) ? `공감 '${str(m.reaction)}'` : "공감", `명의 ${str(m.author) ?? "?"}`);
    case "classnote_parent_reaction_remove_request":
      return join(m.own === false ? "다른 사람 공감 풀기(관리자)" : "내 공감 풀기", str(m.author));
    case "classnote_parent_reaction_run": {
      const verb = m.action === "remove" ? "풀기" : "누르기";
      if (m.ok === false) return join(`ClassNote 공감 ${verb} 실패`, str(m.error));
      return join(`ClassNote 공감 ${verb}`, str(m.author));
    }
    case "classnote_board_sync_run": {
      // 자동 동기화가 낸 요청의 실행 결과는 앞에 '자동'을 붙인다(사람이 누른 것과 가린다).
      const head = m.auto === true ? "자동 동기화" : null;
      if (m.ok === false) return join(head, "동기화 실패", str(m.error));
      if (m.noChange === true) return join(head, "바뀐 반 없음(ClassNote 변경 없음)");
      const bits = (
        [
          ["반", num(m.classes)],
          ["새 반", num(m.created)],
          ["이름 변경", num(m.renamed)],
          ["원아 배정", num(m.enrolled)],
          ["담임 연결", num(m.teachers)],
          ["원아 해제", num(m.releasedChildren)],
          ["담임 해제", num(m.releasedTeachers)],
          ["1인 보드 생성", num(m.boardsCreated)],
          ["1인 보드 배정", num(m.assigned)],
          ["보류", num(m.held)],
          ["남은 반", num(m.remaining)],
        ] as const
      )
        .filter(([, v]) => v !== null && v > 0)
        .map(([l, v]) => `${l} ${v}`);
      return join(head, bits.length ? bits.join(" · ") : "동기화 완료(바뀐 것 없음)");
    }
    case "classnote_report_recall": {
      const c = num(m.reportCount);
      // 누가 지웠는지만큼 "관리자 강제 회수인지 담당 강사 본인 회수인지"가 감사에서 중요하다.
      const who = m.byAdmin === true ? "관리자 회수" : "담당 강사 회수";
      const names = Array.isArray(m.studentNames) ? m.studentNames.filter((x) => typeof x === "string") : [];
      const label = names.length ? `(${names.slice(0, 3).join(", ")}${names.length > 3 ? " 외" : ""})` : "";
      return join(c === null ? `수업보고서 회수 — ${who}` : `수업보고서 ${c}건 회수 — ${who}`, label || null);
    }
    case "makeup_reserve":
    case "makeup_reserve_cancel":
    case "makeup_reserve_done":
    case "makeup_reserve_revert": {
      /**
       * 보강 예약(0264a) — **결석일 → 보강일·교시**를 한 줄로. '대상' 열이 학생 이름이라 여기선 날짜·시각만.
       * `absence`(created = 결석일 칸을 새로 결석으로 찍음 · noted = 이미 결석이라 메모만)는 예약에서만 뜻이 있다.
       */
      const absence = str(m.absenceDate);
      const makeup = str(m.makeupDate);
      const slot = str(m.slotStart);
      const period = str(m.periodLabel);
      const when = makeup ? `${makeup}${period ? ` ${period}` : ""}${slot ? ` ${slot}` : ""}` : null;
      const core = absence && when ? `${absence} 결석분 → ${when} 보강` : when ?? absence;
      if (action === "makeup_reserve") {
        const how = str(m.absence);
        const tail = how === "created" ? "결석일 칸을 결석(0)으로 찍음" : how === "noted" ? "결석일 칸에 메모만" : null;
        return join(core, tail);
      }
      if (action === "makeup_reserve_cancel") {
        return join(
          core,
          m.absenceCleared === true
            ? "예약이 찍은 결석 칸(0)도 지움"
            : m.memoCleared === false
              ? "결석 칸 메모는 못 지움"
              : m.memoKept === true
                ? "같은 날 다른 예약이 남아 메모는 그대로"
                : null,
        );
      }
      if (action === "makeup_reserve_revert") {
        return join(core, "보강일 출결이 지워져 예약으로 되돌림");
      }
      const status = str(m.status);
      const label = status && status in STATUS_TEXT ? STATUS_TEXT[status as keyof typeof STATUS_TEXT] : null;
      return join(core, label ? `보강일 출결 ${label}` : null);
    }
    case "makeup_reserve_report_mode": {
      // 원스크린 합치기 ↔ 나누기가 예약의 보고서 발송 방식을 바꿨다(원장 2026-10-22). '대상'이 비어 있어 날짜까지 적는다.
      const mode = m.mode === "merge" ? "정규 보고서에 합침(정규+보강)" : m.mode === "separate" ? "보강 보고서 따로" : null;
      return join(str(m.date) ? `${str(m.date)} 보강` : null, mode);
    }
    case "makeup_reserve_host_move": {
      // 다른 반에 기록된 보강 예약을 그날 정규 반으로 옮겨 정규 보고서에 합쳤다(원장 2026-10-27). '대상' = 학생 · 옮긴 반.
      const n = Array.isArray(m.reservationIds) ? m.reservationIds.length : 0;
      const units = m.units === null ? 1 : num(m.units);
      return join(
        str(m.date) ? `${str(m.date)} 보강` : null,
        n > 0 ? `예약 ${n}건을 정규 반으로 옮겨 합침(정규+보강)` : "정규 반으로 옮겨 합침(정규+보강)",
        units !== null ? `시수 ${units}` : null,
      );
    }
    case "makeup_reserve_check": {
      // 원스크린 보강 표식의 '보강 했음 / 못 했음'(원장 2026-10-27). 했음 = 이행 + 확인 · 못 했음 = 보강분 시수 빼고 예약 지움.
      const done = m.outcome === "done";
      const units = m.units === null ? 1 : num(m.units);
      return join(
        str(m.date) ? `${str(m.date)} 보강` : null,
        m.outcome === "done" || m.outcome === "missed" ? (done ? "보강 했음" : "보강 못 했음 — 예약 지움") : null,
        m.marked === "present" ? "출결을 출석으로 찍음" : m.marked === "makeup" ? "출결을 보강으로 찍음" : null,
        units !== null ? (done ? `시수 ${units}` : `보강분 뺀 시수 ${units}`) : null,
        m.unitsLeft === true ? "시수는 그대로(출석부 확인)" : null,
        m.checkUnsaved === true ? "확인 칸 미적용(이행만)" : null,
      );
    }
    case "attendance_cell":
    case "attendance_bulk":
    case "attendance_range": {
      /**
       * 출결 저장 — **숫자가 얼마에서 얼마로 바뀌었는지**를 적는다(원장 2026-09-14 *"출결 감사로그에서
       * 값을 얼마에서 얼마로 바꿨는지, 예) 3 -> 1.5 이렇게 추가"* · *"수치가 필요한 감사로그는 그에 걸맞게 값도 추가"*).
       * 🔴 종전엔 전용 분기가 없어 **이전 값이 화면에 없었다** — 폴백은 `units`를 아예 안 그렸다
       *    (`FALLBACK_KEY_LABEL`에 없는 숫자 키라 숨김 대상. `autoUnits`·`skippedSeatRows`만 라벨이 있었다).
       * ⚠️ 날짜·학생·반은 '대상' 열과 다른 키가 이미 보여 주므로 여기선 **상태와 숫자만** 적는다(줄이 길어지면 안 읽힌다).
       */
      const has = (k: string) => Object.prototype.hasOwnProperty.call(m, k);
      const prev = has("prevUnits") ? num(m.prevUnits) : null;
      /**
       * '바뀐 뒤' 값 — 셋을 갈라야 거짓 숫자가 안 나온다(적대 재리뷰 2026-09-14).
       *   ① **`nextUnits`가 언제나 우선** — 저장 쪽이 *실제로 쓴 행*에서 잰 "칸에 보이는 값"이다.
       *   ② **옛 정정 로그**(`prevUnits`는 있고 `nextUnits`는 없다) = 종전대로 `units`(친 값).
       *      저장 규약상 **1은 null**이라(`parseSessionUnits`) 키가 있는데 값이 null이면 "없음"이 아니라 1이다
       *      — 원장이 지금 하는 작업(1.5 → 1)이 숫자 없이 남지 않게.
       *   ③ 🔴 **새 칸은 `units`로 채우지 않는다.** 빈칸(null)을 1로 읽으면 수학 자동 시수 1.5가 들어간 칸이
       *      `시수 1`이라는 **거짓**으로 남고, 참인 `자동 시수 1.5` 줄까지 밀려난다(아래 `units === null` 게이트).
       *      새 칸은 **사람이 친 숫자가 있을 때만** 적고, 빈칸이면 자동 시수 줄이 사실을 말한다.
       */
      const typedUnits = has("units") ? num(m.units) : null;
      const next = has("nextUnits")
        ? num(m.nextUnits)
        : prev !== null && has("units")
          ? (typedUnits ?? 1)
          : typedUnits;
      const status = str(m.status);
      // 상태 한글은 출결 화면·인쇄물과 **같은 표**(cell-display.STATUS_TEXT) — 여기서 새로 적지 않는다.
      const textOf = (s: string | null) => (s && s in STATUS_TEXT ? STATUS_TEXT[s as keyof typeof STATUS_TEXT] : null);
      const label = textOf(status);
      /**
       * 상태도 **얼마에서 얼마로** 적는다(원장 2026-09-14의 같은 요구 — 숫자에만 전·후를 주고 상태엔 안 주면
       * `결석 · 정정`처럼 *무엇이* 결석이 됐는지를 못 되짚는다. `prevStatus`는 이미 저장돼 있다).
       * ⚠️ 공결·결석은 같은 '결석'으로 접히므로(STATUS_TEXT) 표기가 같으면 화살표를 안 쓴다 — `결석 → 결석` 금지.
       */
      const prevLabel = textOf(str(m.prevStatus));
      const statusText = label && prevLabel && prevLabel !== label ? `${prevLabel} → ${label}` : label;
      const count = num(m.count);
      // 범위 채우기는 칸이 여럿이라 **합**이다 — 몇 칸이 바뀐 합인지 함께 적는다(안 적으면 한 칸 값으로 읽힌다).
      const unitsCells = num(m.unitsChangedCells);
      const units =
        prev !== null && next !== null
          ? `시수 ${unitsCells === null ? "" : `${unitsCells}칸 `}${prev} → ${next}`
          : next !== null
            ? `시수 ${next}`
            : null;
      const auto = num(m.autoUnits);
      const autoCells = num(m.autoUnitsCells);
      // 🔴 종전 폴백이 보여 주던 둘을 여기서도 계속 적는다 — 전용 분기가 생겼다고 정보가 줄면 안 된다:
      //    강사 보기 주인(원장 2026-09-11)과 손대지 않고 둔 자리 기록 수(원장 2026-09-12).
      const scope = str(m.scopeTeacherId);
      const scopeName = scope && UUID_RE.test(scope) ? ctx.nameOf(scope) : null;
      const skipped = num(m.skippedSeatRows);
      // 빗금 칸 입력(원장 2026-09-14) — 다른 선생님 교시 행에 상태만 옮겼다. 그 행 메모의 `대신 입력` 줄과 짝이다.
      const ghostMoved = num(m.ghostTransfer);
      /**
       * 🔴 **날짜는 여기서 적는다** — 안 적으면 "어느 날 수업인지"가 화면 어디에도 없다. 시각 열은 로그를 쓴 때다.
       * 🔴 **반 이름은 단건 셀에서만** — `auditTargetName`은 `studentId ?? userId ?? newTeacherId ?? classId`라
       *    (셀은 `studentId`가 있어 '대상' 열이 학생 이름이지만) **일괄·범위는 `studentId`가 없어**
       *    반이 하나면 '대상' 열이 **이미 반 이름**이다 — 여기서 또 적으면 같은 이름이 두 번 뜬다
       *    (적대 재리뷰 2026-09-14. 반이 여럿이면 `classId` 자체가 없어 자동으로 빠진다).
       */
      const dates = arr(m.dates).map(str).filter((v): v is string => !!v);
      const when = str(m.date) ?? (dates.length ? `${dates[0]}${dates.length > 1 ? ` 외 ${dates.length - 1}일` : ""}` : null);
      const classId = str(m.classId);
      const className = has("studentId") && classId && UUID_RE.test(classId) ? ctx.nameOf(classId) : null;
      return join(
        when,
        className,
        statusText,
        count === null ? null : `${count}칸`,
        units,
        // 자동으로 들어간 값은 사람이 친 값과 구분해 적는다(수학 수업 길이 자동 시수).
        units === null && auto !== null ? `자동 시수 ${auto}` : null,
        autoCells !== null ? `자동 시수 칸 ${autoCells}` : null,
        // ⚠️ 일괄·범위의 `created`는 **새로 만든 칸 수**(숫자)다 — `=== true`로만 보면 두 액션엔
        //    '정정'도 '새 기록'도 영영 안 붙는다(적대 재리뷰 2026-09-14).
        m.overwrote === true
          ? "정정"
          : m.created === true
            ? "새 기록"
            : (num(m.created) ?? 0) > 0
              ? `새 기록 ${num(m.created)}칸`
              : null,
        scopeName ? `강사 보기: ${scopeName}` : null,
        skipped !== null ? `건너뛴 자리 기록 ${skipped}` : null,
        ghostMoved !== null ? `다른 선생님 교시에 상태만 옮김 ${ghostMoved}건` : null,
        // 여러 행을 차례로 쓰다 오류로 멈춘 저장 — 위 건수만 반영됐다(적대 재리뷰 2026-09-14).
        m.partial === true ? "일부만 저장(오류로 멈춤)" : null,
      );
    }
    case "attendance_units_backfill": {
      // 9월 수학 출석 시수 소급 보정(scripts/_oneoff/backfill-math-auto-units.mjs, 원장 2026-09-11 "9월분만 보정").
      const count = num(m.count);
      const from = str(m.from);
      const to = str(m.to);
      const delta = num(m.deltaSum);
      const by =
        m.byUnits && typeof m.byUnits === "object" && !Array.isArray(m.byUnits)
          ? Object.entries(m.byUnits as Record<string, unknown>)
              .map(([u, n]) => `${u}×${typeof n === "number" ? n : "?"}`)
              .join(" · ")
          : null;
      return join(
        count === null ? "수학 출석 시수 보정" : `수학 출석 ${count}칸 시수 보정`,
        from && to ? `${from}~${to}` : null,
        delta !== null ? `합계 +${delta}회분` : null,
        by || null,
      );
    }
    case "ecs_attendance_clear": {
      const rows = num(m.rows);
      const date = typeof m.date === "string" ? m.date.slice(5) : null;
      return join(date ? `${date} 출석 체크 해제` : "출석 체크 해제", rows ? `기록 ${rows}건 삭제` : null);
    }
    case "student_import": {
      const inserted = num(m.inserted);
      if (inserted === null) return null;
      const skipped = num(m.skipped);
      const failed = num(m.failed);
      return join(
        `추가 ${inserted}명`,
        skipped ? `건너뜀 ${skipped}명` : null,
        failed ? `실패 ${failed}명` : null,
      );
    }
    // ── 셔틀(0225a) ────────────────────────────────────────────────────────────────
    // ⚠️ 여기 없으면 기본 폴백이 `ioKind: in` · `status: missed` · `season: term`을 **영문 그대로**
    //    화면에 내보낸다(raw enum 노출 금지 — CLAUDE.md 반복 지적). 새 셔틀 액션은 여기도 함께.
    case "shuttle_stop_create":
    case "shuttle_stop_update": {
      const name = str(m.name);
      return name ? `정류장 「${name}」` : null;
    }
    case "shuttle_run_create": {
      const season = str(m.season);
      const runNo = num(m.runNo);
      const parts = [
        isSeason(season) ? SEASON_LABEL[season] : null,
        runNo === null ? null : `${runNo}회차`,
      ].filter(Boolean);
      return parts.length ? parts.join(" ") : null;
    }
    case "shuttle_run_update": {
      const d = str(m.direction);
      return isDirection(d) ? `${DIRECTION_LABEL[d]}으로 변경` : null;
    }
    case "shuttle_run_stop_remove": {
      const riders = num(m.riders);
      return riders ? `배정 ${riders}명 함께 해제` : "정류장 제거";
    }
    case "shuttle_rider_assign": {
      const io = str(m.ioKind);
      const days = Array.isArray(m.weekdays) ? compactWeekdays(m.weekdays.map(String)) : "";
      const parts = [isDirection(io) ? (io === "in" ? "승차" : "하차") : null, days || null].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "shuttle_ride_exception_set": {
      // 🔴 kind·ioKind를 그대로 두면 화면에 `kind: skip`이 영문으로 뜬다(raw enum 노출 금지).
      const kind = str(m.kind);
      const io = str(m.ioKind);
      const on = str(m.onDate);
      const parts = [
        on,
        isDirection(io) ? DIRECTION_LABEL[io] : null,
        isRideExceptionKind(kind) ? RIDE_EXCEPTION_LABEL[kind] : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "shuttle_ride_exception_clear": {
      const on = str(m.onDate);
      return on ? `${on} · 되돌림` : "되돌림";
    }
    case "shuttle_boarding_record": {
      const status = str(m.status);
      const on = str(m.boardedOn);
      const parts = [on, isBoardingStatus(status) ? BOARDING_STATUS_LABEL[status] : null].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    // 학부모 계정(0320a) — 대상 이름은 target_label에 있다. 이메일은 싣지 않는다.
    case "parent_account_create": {
      const rel = str(m.relationship);
      return rel ? `원생 1명 연결 · ${rel}` : "원생 1명 연결";
    }
    case "parent_account_delete": {
      const n = num(m.students);
      return n ? `원생 연결 ${n}건 해제 · 로그인 삭제` : "로그인 삭제";
    }
    // ── 재고관리(0242a) ────────────────────────────────────────────────────────────
    // 🔴 case가 없으면 폴백이 `status: on_loan` · `category: laptop`을 **영문 그대로** 내보낸다.
    case "inventory_asset_create": {
      const code = str(m.assetCode);
      // 🔑 분류는 학원별 데이터(0247a)라 여기서 DB를 못 읽는다 — 호출부가 라벨을 **스냅샷**으로 남긴다.
      //    0247a 이전 행엔 그 필드가 없어 내장 7종 라벨로 폴백한다(그때는 7종뿐이었으니 정확하다).
      return join(
        code ? `「${code}」` : null,
        str(m.categoryLabel) || assetCategoryLabel(str(m.category)) || null,
        assetStatusLabel(str(m.status)) || null,
      );
    }
    case "inventory_category_create": {
      const labels = arr(m.labels).map(str).filter((v): v is string => !!v);
      const via = str(m.source) === "excel" ? "엑셀에서" : null;
      return join(labels.length ? labels.join("·") : null, labels.length ? `${labels.length}개` : null, via);
    }
    case "inventory_asset_update": {
      const code = str(m.assetCode);
      // 바뀐 칸은 호출부가 **한글 라벨**로 넘긴다(컬럼명 아님).
      const changed = arr(m.changed).map(str).filter((v): v is string => !!v);
      return join(code ? `「${code}」 수정` : "수정", changed.length ? changed.join("·") : null);
    }
    case "inventory_asset_status": {
      const code = str(m.assetCode);
      const from = assetStatusLabel(str(m.from));
      const to = assetStatusLabel(str(m.to));
      const on = str(m.disposedOn);
      return join(code ? `「${code}」` : null, from && to ? `${from} → ${to}` : to || null, on ? `폐기일 ${on}` : null);
    }
    case "inventory_loan_out": {
      const code = str(m.assetCode);
      const who = str(m.borrowerName);
      const dept = str(m.dept);
      const lent = str(m.lentOn);
      const due = str(m.dueOn) ?? str(m.dueNote);
      return join(
        code ? `「${code}」` : null,
        who ? `${who}${dept ? `(${dept})` : ""}에게 대여` : null,
        lent ? `${lent}${due ? ` ~ ${due}` : ""}` : due ? `반납예정 ${due}` : null,
      );
    }
    case "inventory_loan_return": {
      const code = str(m.assetCode);
      const who = str(m.borrowerName);
      const on = str(m.returnedOn);
      const restored = assetStatusLabel(str(m.restoredStatus));
      // 자산 표에서 상태를 골라 반납했으면 '바꿈'(원장 2026-09-18) — 대여 전 상태로 돌린 것과 다른 일이다.
      const verb = str(m.chosenStatus) ? "바꿈" : "되돌림";
      // 분실·확인필요를 골랐으면 대여 기록이 '회수불가'·'확인필요'로 남는다 — 그땐 '반납'이라 부르지 않는다.
      const what = loanStatusLabel(str(m.loanStatus) ?? "returned");
      const closed = str(m.loanStatus) && str(m.loanStatus) !== "returned" ? what : "반납";
      return join(code ? `「${code}」` : null, who ? `${who} ${closed}` : closed, on, restored ? `${restored}으로 ${verb}` : null);
    }
    case "inventory_audit": {
      const code = str(m.assetCode);
      const on = str(m.auditedOn);
      const result = auditResultLabel(str(m.result));
      const loc = str(m.location);
      const act = str(m.action);
      return join(code ? `「${code}」` : null, on, result || null, loc, act ? `조치 ${act}` : null);
    }
    case "excel_import": {
      const mode = str(m.mode);
      const counts = arr(m.counts)
        .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : null))
        .filter((c): c is Record<string, unknown> => !!c)
        .map((c) => {
          const bits = [
            num(c.insert) ? `추가 ${num(c.insert)}` : null,
            num(c.update) ? `갱신 ${num(c.update)}` : null,
            num(c.skip) ? `건너뜀 ${num(c.skip)}` : null,
          ].filter(Boolean);
          return bits.length ? `${str(c.label) ?? ""} ${bits.join(" · ")}`.trim() : null;
        });
      return join(
        mode === "overwrite" ? "덮어쓰기" : mode === "append" ? "추가" : null,
        ...counts,
        str(m.error) ? `중간에 멈춤: ${str(m.error)}` : null,
      );
    }
    case "inventory_excel_import": {
      const mode = str(m.mode);
      const parts = [
        mode === "overwrite" ? "덮어쓰기" : mode === "append" ? "추가" : null,
        num(m.assetsInserted) ? `자산 추가 ${num(m.assetsInserted)}` : null,
        num(m.assetsUpdated) ? `자산 갱신 ${num(m.assetsUpdated)}` : null,
        num(m.assetsSkipped) ? `자산 건너뜀 ${num(m.assetsSkipped)}` : null,
        num(m.suppliesInserted) ? `소모품 추가 ${num(m.suppliesInserted)}` : null,
        num(m.suppliesUpdated) ? `소모품 갱신 ${num(m.suppliesUpdated)}` : null,
        num(m.suppliesSkipped) ? `소모품 건너뜀 ${num(m.suppliesSkipped)}` : null,
      ];
      // 이 파일이 새로 만든 분류(0247a) — 별도 로그도 남지만 여기 한 줄이 "그 파일이 늘렸다"를 잇는다.
      const cats = arr(m.categoriesCreated).map(str).filter((v): v is string => !!v);
      if (cats.length > 0) parts.push(`분류 추가 ${cats.join("·")}`);
      return join(...parts);
    }
    // 사용자(보유자) 지정 — 누가 갖고 있는지가 바뀐 사실 자체가 감사 대상이다.
    case "inventory_asset_holder": {
      const code = str(m.assetCode);
      const from = str(m.from);
      const to = str(m.to);
      return join(
        code ? `「${code}」 사용자` : "사용자",
        from && to ? `${from} → ${to}` : to ? `→ ${to}` : from ? `${from} → (비움)` : "(비움)",
      );
    }
    // 삭제 3종 — 행이 사라지므로 **로그가 유일한 근거**다. 함께 지워진 것까지 적는다.
    case "inventory_asset_delete": {
      const code = str(m.assetCode);
      const model = str(m.model);
      const loans = num(m.cascadedLoans);
      const audits = num(m.cascadedAudits);
      const cascade = [loans ? `대여 ${loans}건` : null, audits ? `실사 ${audits}건` : null].filter(Boolean).join("·");
      return join(
        code ? `「${code}」 삭제` : "삭제",
        model,
        cascade ? `${cascade} 함께 삭제` : null,
      );
    }
    case "inventory_loan_delete": {
      const code = str(m.assetCode);
      const who = str(m.borrowerName);
      const restored = assetStatusLabel(str(m.restoredAssetStatus));
      return join(
        code ? `「${code}」 대여 기록 삭제` : "대여 기록 삭제",
        who,
        restored ? `자산 상태 ${restored}로 되돌림` : null,
      );
    }
    case "inventory_audit_delete": {
      const code = str(m.auditCode);
      const on = str(m.auditedOn);
      const result = auditResultLabel(str(m.result));
      return join(code ? `「${code}」 삭제` : "실사 삭제", on, result);
    }
    case "inventory_audit_update": {
      const code = str(m.auditCode);
      const from = m.from as Record<string, unknown> | undefined;
      const to = m.to as Record<string, unknown> | undefined;
      const fromResult = auditResultLabel(str(from?.result));
      const toResult = auditResultLabel(str(to?.result));
      const fromOn = str(from?.auditedOn);
      const toOn = str(to?.auditedOn);
      return join(
        code ? `「${code}」 수정` : "실사 수정",
        fromResult && toResult && fromResult !== toResult ? `${fromResult} → ${toResult}` : toResult,
        fromOn && toOn && fromOn !== toOn ? `${fromOn} → ${toOn}` : toOn,
      );
    }
    case "inventory_supply_delete": {
      const code = str(m.itemCode);
      const name = str(m.name);
      const qty = num(m.qty);
      return join(
        [code ? `「${code}」` : null, name].filter(Boolean).join(" ") || "소모품",
        "삭제",
        qty !== null ? `수량 ${qty}` : null,
      );
    }
    // 대여 기록 수정 — 대여자가 바뀌면 자산의 '사용자'도 함께 바뀐다(그 사실을 한 줄로).
    case "inventory_loan_update": {
      const code = str(m.assetCode);
      const from = str(m.from);
      const to = str(m.to);
      return join(
        code ? `「${code}」 대여 수정` : "대여 수정",
        from && to && from !== to ? `대여자 ${from} → ${to}` : to ? `대여자 ${to}` : null,
      );
    }
    case "inventory_supply_update": {
      const code = str(m.itemCode);
      const name = str(m.name);
      const from = num(m.qtyFrom);
      const to = num(m.qtyTo);
      const on = str(m.checkedOn);
      // 품목·모델·위치 변경(감사 N5) — [{field, from, to}].
      const changes = Array.isArray(m.changes)
        ? (m.changes as unknown[])
            .map((c) => {
              if (!c || typeof c !== "object") return null;
              const o = c as Record<string, unknown>;
              const f = str(o.field);
              return f ? `${f} ${str(o.from) ?? "—"} → ${str(o.to) ?? "—"}` : null;
            })
            .filter((x): x is string => !!x)
            .join(" · ")
        : null;
      return join(
        [code ? `「${code}」` : null, name].filter(Boolean).join(" ") || null,
        from !== null && to !== null ? (from === to ? null : `수량 ${from} → ${to}`) : to !== null ? `수량 ${to}` : null,
        changes || null,
        on ? `확인 ${on}` : null,
      );
    }
    case "inventory_supply_create": {
      const code = str(m.itemCode);
      const name = str(m.name);
      const qty = num(m.qty);
      return join(
        [code ? `「${code}」` : null, name].filter(Boolean).join(" ") || "소모품",
        "등록",
        qty !== null ? `수량 ${qty}` : null,
      );
    }
    // 업체리스트(0448a) — 업체명은 대상 칸에 이미 있다. 수정은 바뀐 칸 이름만(값은 싣지 않는다).
    case "inventory_vendor_create":
      return str(m.category);
    case "inventory_vendor_update": {
      const fields = Array.isArray(m.fields) ? (m.fields as unknown[]).map(str).filter(Boolean).join(" · ") : null;
      return fields ? `${fields} 변경` : null;
    }
    case "inventory_vendor_delete":
      return join(str(m.category), "삭제");
    case "inventory_vendor_excel_import": {
      const mode = str(m.mode);
      return join(
        mode === "overwrite" ? "덮어쓰기" : mode === "append" ? "추가" : null,
        num(m.inserted) ? `추가 ${num(m.inserted)}` : null,
        num(m.updated) ? `갱신 ${num(m.updated)}` : null,
        num(m.skipped) ? `건너뜀 ${num(m.skipped)}` : null,
      );
    }
    // 운행 단위(0243a) — 날짜만 있으면 그날 어느 운행인지가 목록에서 바로 읽힌다.
    case "shuttle_trip_start":
    case "shuttle_trip_end":
    case "shuttle_trip_reopen": {
      return str(m.ranOn);
    }
    /**
     * 정류장 위치(0244a) — 🔴 **좌표를 상세에 적지 않는다.** 감사로그는 목록에서 훑는 자리라
     * `35.8714, 128.6014`가 붙으면 읽을 수 없는 숫자만 길게 남고, 위치 자체는 정류장 화면이 진실이다.
     * 지운 것인지 찍은 것인지만 가른다(되돌린 기록이 필요한 유일한 축).
     */
    case "shuttle_stop_location": {
      return m.cleared === true ? "위치 지움" : "위치 지정";
    }
    // 변경 내역 확인(0323a) — 어느 장부의 줄인지만(그날 변경 / 고정 변경).
    case "shuttle_history_ack": {
      return m.kind === "regular" ? "고정 시간 변경 확인" : m.kind === "ride" ? "그날 변경 확인" : null;
    }

    // ── 수업 평가(class_review) ──────────────────────────────────────────────────────
    // 🔴 case가 없으면 폴백이 `slot: observer` · `observerMode: assigned`를 **영문 그대로** 내보낸다
    //    (원장 제보 2026-08-20). 라벨은 화면(new-review-form·[id]/page)이 쓰는 말과 같게 맞춘다.
    case "class_review_submit": {
      const slot = str(m.slot);
      const answered = num(m.answered);
      return join(
        slot === "self" ? "본인 채점" : slot === "observer" ? "관찰자 채점" : null,
        answered === null ? null : `문항 ${answered}개 응답`,
      );
    }
    case "class_review_create": {
      // observerMode = assigned(평가자 지정) / open(선착순) — 화면 문구와 동일. 지정이면 지정 인원,
      // 선착순이면 마감 정원이 읽을 값이다(같은 숫자를 두 뜻으로 쓰는 폼이라 갈라 적는다).
      const open = str(m.observerMode) === "open";
      const limit = num(m.observerLimit);
      const assigned = num(m.assigned);
      const template = str(m.template);
      return join(
        str(m.date),
        open
          ? limit === null
            ? "선착순"
            : `선착순 ${limit}명`
          : assigned === null
            ? "평가자 지정"
            : `평가자 지정 ${assigned}명`,
        template ? `문항 「${template}」` : null,
      );
    }
    case "class_review_template_save": {
      const areas = num(m.areas);
      const items = num(m.items);
      return join(
        // 셋으로 가른다 — created가 아예 없는 행에 "수정"이라 단정하면 없는 사실을 만드는 셈이다.
        m.created === true ? "문항 세트 생성" : m.created === false ? "문항 세트 수정" : null,
        areas === null ? null : `영역 ${areas}개`,
        items === null ? null : `문항 ${items}개`,
      );
    }
    case "class_review_final_review": {
      // 총평 본문은 적지 않는다(인사 평가 문장 — 감사로그 목록에 새면 안 된다). 지웠는지·길이만.
      const length = num(m.length);
      return m.cleared === true ? "총평 지움" : length === null ? "총평 저장" : `총평 저장 (${length}자)`;
    }
    case "class_review_delete":
    case "class_review_template_delete":
      return null; // metadata = 문서 uuid뿐(문서 이름은 되찾을 수 없다 — 지어내지 않는다)

    // ── 전자결재(0212a~0216a) ────────────────────────────────────────────────────────
    case "approval_submit": {
      // ⚠️ **양식마다 metadata가 다르다** — 휴가는 일수·연차, 지출·수입은 금액·분류, 품의는 아예 없다.
      //    없는 필드를 "없음"으로 지어내지 말고 그 조각만 빼고 그린다.
      const days = num(m.days);
      if (days !== null) {
        const granted = num(m.granted);
        const remaining = num(m.remaining);
        return join(
          `${days}일 사용`,
          granted !== null && remaining !== null ? `연차 ${granted}일 중 잔여 ${remaining}일` : null,
          str(m.period) ? `기간 ${str(m.period)}` : null,
        );
      }
      const amount = won(m.amount);
      if (amount) {
        const spend = str(m.spendDate);
        const income = str(m.incomeDate);
        return join(
          amount,
          spend ? `지출일 ${spend}` : income ? `수입일 ${income}` : null,
          str(m.category), // 분류 어휘의 주인은 /billing(EXPENSE_CATEGORIES) — 이미 한글이다
        );
      }
      return null; // 품의서 등 상세 없는 양식 — 대상 열이 문서 제목을 보여준다
    }
    // 연차 조정(0252a) — metadata: days(가감) · before/after(총 부여) · period · reason.
    case "leave_adjust":
    case "leave_adjust_delete": {
      const days = num(m.days);
      const after = num(m.after);
      return join(
        days === null ? null : formatSignedDays(days),
        after === null ? null : `총 ${formatLeaveDays(after)}`,
        str(m.period) ? `기간 ${str(m.period)}` : null,
        str(m.reason), // 사유는 사람이 한글로 적은 값 — 그대로가 가장 정확하다
      );
    }
    case "approval_decide": {
      // 후결 확인(부재자가 나중에 확인)만 metadata 모양이 다르다.
      if (m.postApproval === true) return "후결 확인";
      const d = str(m.decision);
      // 결재란 판단 라벨의 단일 소스 = approvals/types(승인·반려·전결·후결…). 여기서 복사하지 않는다.
      // ⚠️ `d in LABEL`로 보면 프로토타입 키("toString")까지 통과한다 — enum 목록으로 좁힌다.
      const decided =
        d && (STEP_DECISIONS as readonly string[]).includes(d) ? STEP_DECISION_LABEL[d as StepDecision] : null;
      const step = num(m.step);
      const deferred = num(m.deferred);
      return join(
        decided,
        step === null ? null : `${step}번째 결재란`,
        m.proxy === true ? "대결" : null,
        deferred ? `앞 단계 ${deferred}칸을 후결로 넘김` : null,
      );
    }
    case "approval_withdraw":
    case "approval_comment":
    case "approval_comment_delete":
      return null; // metadata = 문서 uuid뿐(대상 열이 문서 제목을 보여준다)

    // ── 보강 빼기 ────────────────────────────────────────────────────────────────────
    case "makeup_remove": {
      // 대상 열이 이미 학생 이름을 보여주므로 여기선 **어디서 무엇이 지워졌는지**를 적는다.
      const subject = str(m.subject);
      const reports = num(m.deletedReports);
      const progress = num(m.rolledBackProgress);
      return join(
        ctx.nameOf(m.classId),
        str(m.date),
        subject ? ctx.subjectLabel(subject) : null, // 과목은 학원설정 단일 소스(하드코딩 금지)
        m.attendanceRemoved === true ? "출결 보강 칸 삭제" : null,
        reports ? `수업보고서 ${reports}건 삭제` : null,
        progress ? `진도 ${progress}건 되돌림` : null,
      );
    }
    // ── 보강 반 바꾸기(원장 2026-09-30 — 보고서 반 = 출석부 반) ──────────────────────
    case "makeup_class_change": {
      const subject = str(m.subject);
      const from = ctx.nameOf(m.fromClassId);
      const to = ctx.nameOf(m.toClassId);
      const moved = num(m.movedCells);
      return join(
        str(m.date),
        subject ? ctx.subjectLabel(subject) : null, // 과목은 학원설정 단일 소스(하드코딩 금지)
        `${from ?? "반 없음"} → ${to ?? "반"}`,
        moved ? `출석부 칸 ${moved}개 함께 옮김` : null,
        m.createdCell === true ? "출석부 칸 새로 기록" : null,
        m.substitute === true ? "대신 보강(학생의 원래 반)" : null,
      );
    }
    case "operating_periods_save": {
      // 대상 열이 "2026년 영어 세션 12건"을 이미 보여준다 — 여기선 반 단위 저장인지만 덧붙인다.
      const count = num(m.count);
      const cls = ctx.nameOf(m.classId);
      return join(cls ? `반 ${cls}` : null, count === null ? null : `세션 ${count}건`);
    }
    case "consultation_merge": {
      // 🔴 "무엇을 버렸나"가 되돌릴 유일한 근거다(merge-actions 주석) — 항목 이름은 이미 한글.
      const losers = arr(m.loserIds).length;
      const fields = arr(m.discarded)
        .map((d) => (d && typeof d === "object" ? str((d as Meta).field) : null))
        .filter((v): v is string => !!v);
      return join(
        losers ? `상담 ${losers}건 병합` : null,
        fields.length ? `버린 값: ${fields.join(", ")}` : null,
      );
    }

    // ── 등록상담(2026-09-10 김근우 건) ───────────────────────────────────────────────
    case "enrollment_consultation_create":
    case "enrollment_consultation_intake": {
      const subject = str(m.subject);
      return join(
        action === "enrollment_consultation_intake" ? "학부모 QR 접수" : null,
        subject ? ctx.subjectLabel(subject) : null, // 과목은 학원설정 단일 소스(하드코딩 금지)
        m.withAudio === true ? "녹음 포함" : null,
      );
    }
    case "enrollment_consultation_update": {
      // 이름·학교·학년·보호자는 자동 연결의 키라 전후 값까지(consultation-audit.ts). 연락처·상담 내용은 항목 이름만.
      const detailed = arr(m.changes)
        .map((c) => (c && typeof c === "object" ? (c as Meta) : null))
        .filter((c): c is Meta => !!c && !!str(c.field));
      const shown = new Set(detailed.map((c) => str(c.field)));
      const rest = arr(m.changed)
        .map(str)
        .filter((f): f is string => !!f && !shown.has(f));
      const outcomeTo = outcomeKo(m.outcomeTo);
      return join(
        m.via === "list" ? "목록에서" : null,
        ...detailed.map((c) => `${str(c.field)} ${str(c.from) ?? "(빈 값)"} → ${str(c.to) ?? "(빈 값)"}`),
        rest.length ? rest.join(", ") : null,
        outcomeTo ? `상태 → ${outcomeTo}` : null,
        str(m.counselorAutofill) ? `상담자 자동 입력: ${str(m.counselorAutofill)}` : null,
      );
    }
    case "enrollment_consultation_outcome": {
      const from = outcomeKo(m.from);
      const to = outcomeKo(m.to);
      if (!to) return null;
      return from ? `${from} → ${to}` : `→ ${to}`;
    }
    case "enrollment_consultation_delete": {
      const who = ctx.nameOf(m.studentId);
      return join(who ? `연결 학생 ${who}` : null, m.hadRecording === true ? "녹음 포함" : null);
    }
    case "consultation_autolink": {
      // DB 트리거가 쓴다(0258a). 실행자는 '시스템(자동 연결)'이고, 그 저장을 한 직원은 userId로만 남는다.
      const who = ctx.nameOf(m.studentId);
      const rule = str(m.rule);
      const via = str(m.via);
      const by = ctx.nameOf(m.userId);
      return join(
        who ? `→ ${who}` : null,
        rule === "name_school_grade" ? "이름·학교·학년 일치" : rule === "phone_name" ? "연락처·이름 일치" : null,
        via === "intake"
          ? "학부모 QR 접수 때"
          : via === "consultation"
            ? "상담 저장 때"
            : via === "student"
              ? "학생 등록·수정 때"
              : null,
        by ? `${by}의 저장으로` : null,
      );
    }
    case "consultation_link_existing": {
      const who = ctx.nameOf(m.studentId);
      return join(who ? `→ ${who}` : null, "같은 이름·학교·학년 재원생 재사용");
    }
    case "consultation_unlink": {
      const who = ctx.nameOf(m.studentId);
      return join(who ? `${who}에서 분리` : null, str(m.reason));
    }

    // ── 강사 시트 수업계획(plan-write.ts logPlanChange) — '대상' 열이 반 이름을 이미 보여준다 ─────────
    case "ecs_plan_line_add":
    case "ecs_plan_line_move":
    case "ecs_plan_line_delete":
    case "ecs_plan_copy": {
      const date = str(m.planDate);
      const slot = str(m.slotStart);
      const source = str(m.sourceDate);
      const copied = num(m.copied);
      return join(
        date ? (slot ? `${date} ${slot}` : date) : slot,
        source ? `${source} 회차에서` : null,
        copied !== null ? `${copied}줄 복사` : null,
        m.termMode === "exam" ? "시험 기간" : null,
        m.viaPin === true ? "공개 PIN 화면" : null,
      );
    }

    // ── 강사 시트 칸 편집(edit-audit-actions.ts) — 칸을 떠날 때 한 줄(원장 결정 2026-09-14) ─────────────
    // '대상' 열이 반 이름을 보여 준다(targetLabel 스냅샷). 칸 이름은 기록 때 한글 스냅샷(fieldLabel·areaLabel)으로
    // 실려 오므로 여기서 영문 키(kind·scope·role·field)를 그대로 흘리지 않는다.
    case "ecs_goal_edit":
    case "ecs_mark_edit":
    case "ecs_memo_edit":
    case "ecs_month_plan_edit": {
      // MP 토글(누름이 곧 결심) — 저장 액션(`saveMonthPlanCells`)이 직접 남긴 줄.
      if (m.change === "ebookColumn") {
        const days = num(m.days);
        const from = str(m.from);
        const to = str(m.to);
        return join(
          m.show === true ? "e-book 열 세움" : "e-book 열 내림",
          from && to ? (from === to ? from : `${from}~${to}`) : null,
          days ? `${days}일` : null,
        );
      }
      if (m.change === "dayOff") return join(str(m.date), m.off === true ? "휴강으로 표시" : "휴강 표시 해제");
      const shown = (v: unknown) => {
        const s = str(v);
        return s ? `「${s}」` : "(빈칸)";
      };
      const date = str(m.date);
      const slot = str(m.slotStart);
      const periodStart = str(m.periodStart);
      const weekStart = str(m.weekStart);
      const where =
        m.kind === "goal"
          ? join(
              periodStart
                ? m.scope === "week"
                  ? `${periodStart} 주 목표`
                  : `${periodStart.slice(0, 7)} 월간 목표`
                : null,
              m.role === "assistant" ? "부담임" : m.role === "homeroom" ? "담임" : null,
              str(m.areaLabel),
            )
          : m.kind === "mark"
            ? join(ctx.nameOf(m.studentId), date ? (slot ? `${date} ${slot}` : date) : null)
            : m.kind === "memo"
              ? weekStart
                ? `${weekStart} 주`
                : null
              : m.kind === "monthMemo"
                ? str(m.month)
                : date;
      const label = str(m.fieldLabel);
      return join(where, `${label ? `${label} ` : ""}${shown(m.before)} → ${shown(m.after)}`);
    }
    case "ecs_shouting_toggle": {
      const date = str(m.date);
      const slot = str(m.slotStart);
      return join(
        date ? (slot ? `${date} ${slot}` : date) : slot,
        m.checked === true ? "Shouting 체크" : "Shouting 체크 해제",
      );
    }
    // ── 범위 확대(2026-09-14) — 계획 줄 칸 · 수학 시트 월간 목표 · 자리 JJ 칸(칸을 떠날 때 한 줄) ───────────
    // 칸 이름은 기록 때 한글 스냅샷(fieldLabel)으로 실려 오고, 구분(영역)도 라벨로 바뀌어 온다(raw 키 없음).
    case "mcs_learning_goal_reset":
      return join(
        `학생 ${arr(m.studentIds).length}명 전체 목표 초기화`,
        m.track === "supplement" ? "수요일 복습" : "정규",
        str(m.startDate) ? `${m.startDate} 시작분` : null,
        typeof m.removed === "number" ? `${m.removed}건 삭제` : null,
      );
    case "mcs_learning_goal_save":
      return join(
        `학생 ${arr(m.studentIds).length}명 전체 목표`,
        str(m.studyGrade),
        str(m.startDate) && str(m.endDate) ? `${m.startDate} ~ ${m.endDate}` : null,
        str(m.startBlock) && str(m.endBlock) ? `${m.startBlock} → ${m.endBlock}` : null,
        str(m.textbook),
      );
    // SRS에서 단어수를 당겨 온 한 번(수동 버튼) — 칸마다 남기지 않고 **누른 한 번**을 한 줄로.
    // ⚠️ `updated`·`same`은 2026-09-28부터 실린다 — 옛 행엔 없으므로 `?? 0`이 그 칸을 조용히 뺀다
    //    (0을 "갱신 0칸"으로 적으면 그때는 갱신이라는 개념이 없었다는 사실이 가려진다).
    case "seat_jj_memorized_pull":
    case "ecs_memorized_pull": {
      const filled = num(m.filled) ?? 0;
      const updated = num(m.updated) ?? 0;
      const same = num(m.same) ?? 0;
      const kept = num(m.kept) ?? 0;
      const unlinked = num(m.unlinked) ?? 0;
      return join(
        str(m.date),
        `누적 암기 단어수 ${filled}칸 채움`,
        updated ? `${updated}칸 갱신` : null,
        same ? `${same}칸은 이미 최신` : null,
        kept ? `${kept}칸은 그대로` : null,
        unlinked ? `SRS 짝 없음 ${unlinked}칸` : null,
      );
    }
    case "ecs_plan_cell_edit":
    case "mcs_goal_edit":
    case "seat_jj_mark_edit": {
      const shown = (v: unknown) => {
        const s = str(v);
        return s ? `「${s}」` : "(빈칸)";
      };
      const date = str(m.planDate) ?? str(m.date);
      const slot = str(m.slotStart);
      const month = str(m.month);
      const at = date ? (slot ? `${date} ${slot}` : date) : slot;
      const where =
        action === "mcs_goal_edit"
          ? join(ctx.nameOf(m.studentId), month ? `${month} 목표` : null)
          : action === "seat_jj_mark_edit"
            ? // 자리 JJ 칸은 학생 칸이라 이름을 앞에 둔다(`ecs_mark_edit`와 같은 모양 — 대상 열만으론 줄마다 안 보인다).
              join(ctx.nameOf(m.studentId), at)
            : at;
      const label = str(m.fieldLabel);
      return join(
        where,
        `${label ? `${label} ` : ""}${shown(m.before)} → ${shown(m.after)}`,
        m.viaPin === true ? "공개 PIN 화면" : null,
      );
    }

    // ── 구글 캘린더 가져오기(시스템) ────────────────────────────────────────────────────
    case "calendar_google_import":
    case "calendar_google_push_sync": {
      const cnt = (v: unknown, label: string): string | null => {
        const n = num(v);
        return n ? `${label} ${n.toLocaleString("ko-KR")}건` : null;
      };
      const failed = arr(m.failed).length;
      return (
        join(
          cnt(m.inserted, "추가"),
          cnt(m.updated, "갱신"),
          cnt(m.deleted, "삭제"),
          cnt(m.skippedEdited, "직접 고친 일정 유지"),
          cnt(m.skippedDeleted, "직접 지운 일정 제외"),
          failed ? `실패 ${failed}건` : null,
        ) ?? "변경 없음"
      );
    }

    // ── 직원 등록·QR ─────────────────────────────────────────────────────────────────
    case "staff_intake_token_create":
    case "staff_intake_token_toggle": {
      // 두 갈래가 한 액션 키를 쓴다 — 새 QR 생성은 {role}, 재발급·열기·닫기는 {action}.
      const r = roleKo(m.role);
      if (r) return `기본 역할 ${r}`;
      const a = str(m.action);
      if (a === "rotate") return "새 링크 재발급(옛 링크 폐기)";
      if (a === "close") return "링크 닫기";
      if (a === "reopen") return "링크 다시 열기";
      return null;
    }
    case "staff_create":
    case "staff_create_from_resume":
    case "staff_create_from_intake": {
      // 이메일(로그인 아이디)은 그대로 보여준다 — staff_email_change 선례. **역할은 반드시 한글로.**
      const removed = arr(m.removedDuplicates).length;
      return join(
        roleKo(m.role),
        str(m.email),
        m.autoEmail === true ? "아이디 자동 생성" : null,
        str(m.tokenName) ? `QR 「${str(m.tokenName)}」` : null,
        str(m.purpose),
        removed ? `중복 이력서 ${removed}건 삭제` : null,
      );
    }
    case "staff_link_from_resume": {
      // filled = 이력서에서 채운 필드 키 배열(영문) — 개수만(staff_contract_pdf_extract와 같은 규약).
      const filled = arr(m.filled).length;
      return filled ? `이력서에서 항목 ${filled}개 채움` : null;
    }
    case "staff_roster_import": {
      const tab = str(m.sheetTab);
      return tab ? `시트 「${tab}」` : null; // 2·3차 배치는 시트 탭이 없다 — 대상 열이 건수를 보여준다
    }
    case "staff_roster_import_revert":
      return null; // metadata = 되돌린 로그 파일 경로뿐(화면에 낼 값이 아니다)
    case "teacher_view_impersonate":
    case "resume_view_unlock":
      return null; // 대상 열이 이미 강사·이력서 이름을 보여준다(uuid만 남기면 노이즈)

    // ── 회의록(2026-08-25) ───────────────────────────────────────────────────────────
    // 🔴 case가 없으면 상세 칸이 **빈 채로** 뜬다 — 2026-08-21에 폴백 정책을 뒤집어 모르는 metadata
    //    키는 아예 숨기기 때문이다(옛날처럼 영문이 뜨지도 않는다). 제목은 '대상' 열이 보여주므로
    //    여기선 되찾을 수 없는 것(회의일·분량·모델·상태)만 적는다.
    case "meeting_create_audio": {
      return join(
        str(m.heldAt) ? `회의일 ${str(m.heldAt)}` : null,
        fileSize(m.sizeBytes) ? `녹음 ${fileSize(m.sizeBytes)}` : null,
        num(m.attendees) ? `참석 ${num(m.attendees)}명` : null,
        charsKo(m.notepadChars, "메모"),
        recordingOriginKo(m.recording),
      );
    }
    case "recording_interrupted": {
      // 대상 열이 사유를 보여준다 — 여기는 종류·녹음 분량·오류 코드·화면 상태·브라우저·늦은 보고 여부.
      const kind = ({ meeting: "회의", consultation: "등록 상담", "student-consultation": "학생 상담" } as Record<string, string>)[String(m.kind)] ?? null;
      const secs = num(m.seconds);
      return join(
        kind ? `${kind} 녹음` : null,
        secs !== null ? `${Math.floor(secs / 60)}분 ${secs % 60}초 녹음` : null,
        str(m.errorCode) ? `코드 ${str(m.errorCode)}` : null,
        m.visibility === "hidden" ? "화면 가려짐" : null,
        m.online === false ? "오프라인" : null,
        str(m.browser) && m.browser !== "other" ? String(m.browser) : null,
        m.late === true ? "다음 접속 때 확인" : null,
      );
    }
    case "meeting_create_text": {
      return join(
        str(m.heldAt) ? `회의일 ${str(m.heldAt)}` : null,
        charsKo(m.notepadChars, "메모"),
        num(m.attendees) ? `참석 ${num(m.attendees)}명` : null,
      );
    }
    case "meeting_delete": {
      // 무엇이 사라졌는지가 이 로그의 존재 이유다. 전사·분석 **본문은 없다**(분량·모델만) —
      // 그래서 "복구는 원문 참조"라고 적지 않는다(enrollment_delete와 달리 스냅샷이 없다).
      const dur = durationKo(m.audioDurationSec);
      const model = modelDisplayLabel(str(m.model));
      const audio =
        m.hadAudio === true
          ? m.audioRemoved === true
            ? `녹음 파일 함께 삭제${dur ? ` (${dur})` : ""}`
            : `녹음 파일은 보존${dur ? ` (${dur})` : ""}`
          : null;
      return join(
        str(m.heldAt) ? `회의일 ${str(m.heldAt)}` : null,
        audio,
        charsKo(m.transcriptChars, "전사"),
        m.hadReport === true ? `AI 분석 있었음${model ? ` · ${model}` : ""}` : null,
        "삭제됨(복구 불가)",
      );
    }
    case "meeting_retry_transcribe": {
      const from = str(m.fromStatus);
      const kept = charsKo(m.transcriptChars, "기존 전사");
      return join(
        from && MEETING_STATUS_LABEL[from] ? `직전 상태: ${MEETING_STATUS_LABEL[from]}` : null,
        "원본 녹음을 외부 전사에 재제출",
        kept ? `${kept} 있음` : null,
      );
    }
    case "meeting_regenerate_analysis": {
      // 액션 라벨이 이미 "회의 AI 분석 다시 생성"이다 — 여기자 무엇을 넣어 돌렸는지(입력 분량)만.
      return join(charsKo(m.transcriptChars, "전사"), charsKo(m.notepadChars, "메모"));
    }
    case "meeting_title_update": {
      // 새 제목은 '대상' 열이 보여준다 — 여기엔 이전 제목(이력으로 쓰려면 반드시 필요한 쪽).
      const from = str(m.from);
      return from ? `이전 제목 「${from}」` : null;
    }
    case "meeting_speakers_update": {
      const speakers = num(m.speakers) ?? 0;
      const linked = num(m.linked) ?? 0;
      if (speakers === 0 && linked === 0) return "화자 표시·직원 연결 모두 해제";
      return join(
        speakers ? `화자 ${speakers}명 표시명 지정` : null,
        linked ? `직원 연결 ${linked}명` : null,
      );
    }
    case "meeting_report_edit": {
      // 🔴 섹션 키는 영문(`summary`)이라 반드시 한글 라벨로 — 미등록 키는 표기 생략(지어내지 않는다).
      const section = meetingReportSectionLabel(str(m.section));
      return join(section ? `「${section}」 섹션` : null, charsKo(m.chars, "수정 후"));
    }

    // ── 학생상담(2026-08-25) ─────────────────────────────────────────────────────────
    // 🔴 학생 이름은 '대상' 열이 metadata.studentId로 보여주므로 여기서 되풀이하지 않는다.
    //    요약·후속조치 **본문은 애초에 metadata에 없다**(상담 내용 금지) — 새로 끌어오지 말 것.
    case "student_consultation_create":
    case "student_consultation_update": {
      const follow =
        m.hasFollowUp === true
          ? str(m.followUpDate)
            ? `후속조치 ${str(m.followUpDate)}까지`
            : "후속조치 있음"
          : null;
      return join(
        str(m.consultedAt) ? `상담일 ${str(m.consultedAt)}` : null,
        consultCategoryKo(m.category),
        consultAudienceKo(m.audience),
        follow,
        consultClassKo(m, ctx.nameOf),
      );
    }
    case "student_consultation_delete": {
      return join(
        str(m.consultedAt) ? `상담일 ${str(m.consultedAt)}` : null,
        consultCategoryKo(m.category),
        consultAudienceKo(m.audience),
        m.hasFollowUp === true ? "후속조치가 있던 기록" : null,
        "삭제됨(복구 불가)",
      );
    }
    case "student_consultation_follow_up": {
      return m.done === true ? "완료로 표시" : m.done === false ? "완료 해제" : null;
    }
    case "student_consultation_class_backfill": {
      // reasons = { 한글 판정 이유: 건수 } (consultation-class.cjs CLASS_REASON_LABEL — 키가 이미 한글).
      const n = num(m.count);
      const mapped = num(m.mapped);
      const reasons =
        m.reasons && typeof m.reasons === "object"
          ? Object.entries(m.reasons as Record<string, unknown>)
              .filter(([k, v]) => /[가-힣]/.test(k) && typeof v === "number")
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")
          : "";
      return join(n === null ? null : `상담 ${n}건 판정`, mapped === null ? null : `반 연결 ${mapped}건`, reasons || null);
    }
    case "student_consultation_sync_import":
    case "student_consultation_subject_backfill": {
      // subjects = { 한글 판정 이유: 건수 } (consultation-counselor.cjs SUBJECT_REASON_LABEL — 키가 이미 한글).
      const n = num(m.inserted) ?? num(m.count);
      const linked = num(m.counselorLinked) ?? num(m.counselorMatched);
      const reasons =
        m.subjects && typeof m.subjects === "object"
          ? Object.entries(m.subjects as Record<string, unknown>)
              .filter(([k, v]) => /[가-힣]/.test(k) && typeof v === "number")
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")
          : "";
      const classMapped = num(m.classMapped);
      return join(
        n === null ? null : `상담 ${n}건`,
        linked === null ? null : `상담사 연결 ${linked}건`,
        reasons ? `과목: ${reasons}` : null,
        classMapped === null ? null : `반 연결 ${classMapped}건`,
      );
    }
    case "student_care_analysis": {
      // 대상 열이 학생 이름을 보여준다 — 여기선 무엇이 얼마나 나왔는지 + 어떤 모델이었는지.
      const focus = num(m.focus);
      return join(
        focus === null ? null : `케어 포인트 ${focus}건`,
        modelDisplayLabel(str(m.model)),
      );
    }

    // ── 셔틀 — metadata가 uuid뿐이라 지금은 빈 상세다. 새 키가 붙어도 영문이 새지 않게 못박는다. ──
    case "shuttle_stop_archive":
    case "shuttle_vehicle_create":
    case "shuttle_vehicle_update":
    case "shuttle_run_delete":
    case "shuttle_run_stop_add":
    case "shuttle_rider_move":
    case "shuttle_rider_remove":
    case "shuttle_boarding_clear":
      return null;

    case "help_post_create":
    case "help_post_update":
    case "help_post_delete":
    case "help_post_close":
    case "help_answer_create":
    case "support_request_create":
    case "support_request_update":
    case "support_request_delete":
      return str(m.title) ?? null;

    case "lesson_report_video_homework_mark": {
      // 영상 제출 현황 한 칸 — 어느 숙제(숙제일, 모르는 옛 기록은 검사일)를 무엇으로 바꿨나.
      const status = str(m.status);
      const label = status === "submitted" ? "완료" : status === "missing" ? "미수행" : status === "cleared" ? "미확인으로 되돌림" : null;
      const hw = str(m.homeworkDate);
      const checked = str(m.checkDate);
      return join(hw ? `숙제 ${hw}` : checked ? `검사 ${checked}` : null, label, str(m.submittedDate) ? `제출 ${str(m.submittedDate)}` : null);
    }

    case "lesson_report_video_homework_issue":
    case "lesson_report_video_homework_issue_cancel": {
      // 보고서 없이 따로 낸 영상 숙제 — 어느 수업의 숙제인가(+ 낼 때는 제출 기한).
      const hw = str(m.homeworkDate);
      return join(hw ? `숙제 ${hw}` : null, str(m.deadline) ? `기한 ${str(m.deadline)}` : null);
    }

    case "lesson_report_video_homework_cancel": {
      // 영상 숙제를 거둠 — 어느 숙제였나 · 그날 보고서의 '영상 과제 있음'을 '없음'으로 바꿨나 · 미수행이던 숙제인가.
      const hw = str(m.homeworkDate);
      return join(hw ? `숙제 ${hw}` : null, m.fromReport === true ? "보고서 영상 과제 → 없음" : m.keptReport === true ? "따로 낸 표시만(남의 보고서 숙제는 그대로)" : null,
        m.status === "missing" ? "미수행이던 숙제" : null);
    }

    case "lesson_report_video_homework_reject": {
      // 영상이 붙은 칸을 미확인으로 되돌려 그 숙제의 영상을 반려 — 몇 개를 떼고 몇 개를 Drive 휴지통으로 옮겼나.
      const hw = str(m.homeworkDate);
      const n = (k: string) => (typeof m[k] === "number" && Number.isFinite(m[k]) ? (m[k] as number) : null);
      return join(hw ? `숙제 ${hw}` : null, n("videos") !== null ? `영상 ${n("videos")}개 반려` : null,
        n("trashed") !== null ? `휴지통 ${n("trashed")}개` : null, n("trashFailed") ? `휴지통 이동 실패 ${n("trashFailed")}개` : null);
    }

    case "class_schedule_move": {
      // 반 블록 옮기기 — 적용일 · 옮긴 교시(첫 줄 + 줄 수) · 함께 옮긴 기록. 폴백은 값을 60자에서 잘라 한 주 밀림 문구가 빠졌다(적대 리뷰 2026-10-28).
      type At = { day?: unknown; start?: unknown };
      const moves = Array.isArray(m.moves) ? (m.moves as { from?: At; to?: At }[]) : [];
      const at = (p?: At) => `${workDaysLabel([String(p?.day ?? "")])} ${String(p?.start ?? "").slice(0, 5)}`.trim();
      const first = moves[0];
      const moved = first ? `${at(first.from)} → ${at(first.to)}${moves.length > 1 ? ` 외 ${moves.length - 1}줄` : ""}` : null;
      return join(str(m.effectiveDate) ? `적용일 ${str(m.effectiveDate)}` : null, moved, str(m.carried));
    }

    case "demo_roster_apply": {
      const label = str(m.label);
      const n = typeof m.students === "number" && Number.isFinite(m.students) ? `재원 ${m.students}명` : null;
      return join(label, n);
    }

    default: {
      /**
       * 미등록 액션 폴백 — **정책 변경 2026-08-20(원장 "알기 쉽게 변경")**.
       * 종전엔 metadata를 `키: 값` **영문 그대로** 나열해(`slot: observer`·`decision: final`)
       * 감사 화면이 raw 코드 노출 금지 규칙을 정면으로 어겼다. 이제:
       *   ① uuid → 이름 해석(실패 시 숨김)
       *   ② 뜻이 분명한 공통 키(FALLBACK_KEY_LABEL)만 한글 라벨로
       *   ③ 라벨이 없어도 **사람이 쓴 한글 문장·날짜**는 키 없이 값만(그 자체로 읽힌다)
       *   ④ 그 외 영문 키·enum·불리언·숫자는 **숨긴다**
       * ④가 정보 손실인 건 맞다. 다만 뜻을 모르는 키의 영문 값은 원장에게 읽히지 않고, 원문 JSON은
       * 뷰어가 title 툴팁으로 **항상** 보존한다 — "읽히지 않는 영문"보다 "빈 칸 + 툴팁"이 낫다는 판단.
       * 자주 뜨는 액션이 생기면 위에 case를 추가하는 게 정답이지 폴백을 늘리는 게 아니다.
       */
      const parts: string[] = [];
      for (const [k, v] of Object.entries(m)) {
        if (v === null || v === undefined || v === "" || typeof v === "object") continue;
        const s = String(v).trim();
        if (!s) continue;
        if (UUID_RE.test(s)) {
          const n = ctx.nameOf(s);
          if (n) parts.push(FALLBACK_ID_LABEL[k] ? `${FALLBACK_ID_LABEL[k]}: ${n}` : n);
          continue;
        }
        const clipped = s.length > 60 ? `${s.slice(0, 60)}…` : s;
        const label = FALLBACK_KEY_LABEL[k];
        if (label !== undefined) {
          parts.push(label ? `${label} ${clipped}` : clipped);
          continue;
        }
        if (HANGUL_RE.test(s) || YMD_RE.test(s)) parts.push(clipped);
      }
      return parts.length ? parts.join(" · ") : null;
    }
  }
}
