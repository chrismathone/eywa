// 운영 감사로그(audit_logs) metadata → 한글 상세 — 순수 함수(서버/클라 공용, activity.ts와 동일 원칙).
// UI 규칙: raw JSON·uuid·영문 enum을 셀에 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { formatSettingChange, type SettingChange } from "@/features/owner/settings-diff";
import { SECTION_LABELS } from "@/features/owner/settings-types";
import { STEP_DECISION_LABEL, STEP_DECISIONS, type StepDecision } from "@/features/approvals/types";
import { formatSignedDays } from "@/features/leave/balance";
import { formatLeaveDays } from "@/features/leave/request-days";
import { STUDENT_STATUS_LABEL } from "@/features/students/status-labels";
import { ONBOARDING_ITEMS } from "@/features/newcomers/onboarding-items";
import { reasonDisplay } from "@/features/withdrawals/types";
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
import { assetStatusLabel } from "@/features/inventory/status";
import { assetCategoryLabel } from "@/features/inventory/category";
import { auditResultLabel } from "@/features/inventory/audit-result";

/** 대상 유형(target_type) → 한글 — 감사로그 '대상' 열 접두. 미등록 유형은 원문 폴백. */
export const AUDIT_TYPE_LABEL: Record<string, string> = {
  // ── 2026-09-09 전수 보강 — 여기 없으면 감사로그 '대상' 열에 영문이 그대로 뜬다. ──
  expense: "지출결의서",
  refund_request: "환불 요청서",
  invoice_session_term: "청구 회차",
  payslip: "급여명세서",
  class_sheet_plan: "수업계획",
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
  payroll: "급여",
  class: "반",
  classroom: "강의실",
  tenant_settings: "학원 설정",
  staff_resume: "직원 이력서",
  intake_token: "QR 접수 링크",
  notice_popup: "팝업 공지",
  classnote_notice: "학부모 공지",
  operating_periods: "세션 기간",
  // 2026-08-17 원장 제보("대상이 attendance 등 날것으로 나옴") — 누락 유형 전수 추가(가드 테스트도 갱신).
  attendance: "출결",
  lesson_report: "수업보고서",
  approval_document: "결재 문서",
  enrollment_consultations: "등록상담",
  document: "문서",
  // 셔틀(0225a) — 없으면 감사로그 '대상' 열에 영문 "shuttle"이 그대로 뜬다(2026-08-17 원장 제보와 같은 증상).
  shuttle: "셔틀",
  // 캘린더(0218a) — 위와 같은 누락. 일정 삭제 로그의 대상이 영문 "calendar_event"로 떠 있었다.
  calendar_event: "일정",
  calendar_tag: "캘린더 태그",
  // 회의록·학생상담(2026-08-25) — 없으면 '대상' 칸에 영문 "meeting"·"student_consultation"이 그대로 뜬다.
  meeting: "회의록",
  student_consultation: "학생 상담",
  // 연동·AI 프롬프트(2026-08-27 감사 커버리지 점검) — 없으면 '대상' 칸에 영문 키가 그대로 뜬다.
  integration: "외부 연동",
  ai_prompt: "AI 프롬프트",
  kiosk_device: "키오스크 기기",
  // 시간표(개발중) 월별 계획(0232a) — 본 시간표가 아니라 **계획**임이 '대상' 칸에서 바로 읽혀야 한다.
  timetable_plan: "시간표 계획",
  timetable_plan_slot: "시간표 계획 칸",
  // 재고관리(0242a) — 없으면 '대상' 칸에 영문 "inventory_asset"이 그대로 뜬다.
  inventory_asset: "자산",
  inventory_loan: "자산 대여",
  inventory_audit: "자산 실사",
  inventory_supply: "소모품",
  inventory_category: "자산 분류",
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
};

/**
 * 운영 스크립트가 남긴 실행자 식별자(`system:grant-class-review`) → 한글.
 * 실측 8종(2026-08-20) + 저장소에 남아 있는 스크립트 전수. 미등록 `system:*`도 접두를 그대로
 * 내보내지 않고 "시스템 스크립트"로 접는다(새 스크립트가 생겨도 영문이 안 샌다).
 */
export const SYSTEM_ACTOR_PREFIX = "system:";
const SYSTEM_ACTOR_LABEL: Record<string, string> = {
  "grant-class-review": "수업 평가 권한 부여",
  "grant-seat-attendance": "자리 출석부 권한 부여",
  "narrow-staff-menu": "직원관리 권한 조정",
  "create-test-staff": "테스트 직원 생성",
  "delete-test-staff": "테스트 직원 삭제",
  "register-kimjuhyun": "직원 등록",
  "qa-temp-account": "QA 임시 계정",
  "debug-contract-upload": "계약서 업로드 점검",
  "reset-staff-password": "직원 비밀번호 재설정",
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
    for (const key of ["userId", "newTeacherId", "delegateUserId"]) {
      const uid = str(m[key]);
      if (uid && UUID_RE.test(uid)) users.add(uid);
    }
    const cid = str(m.classId);
    if (cid && UUID_RE.test(cid)) classes.add(cid);
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
    case "integration_sync_toggle":
    case "integration_sheets_toggle":
      return m.enabled === true ? "켜기" : m.enabled === false ? "끄기" : null;
    case "integration_sheet_target": {
      // 시트 ID는 외부 문서 식별자라 값 자체를 남기지 않는다(설정 변경 요약과 같은 규약).
      return m.cleared === true ? "대상 시트 해제" : "대상 시트 지정";
    }
    case "integration_sync_now":
      return "지금 동기화 실행";
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
      if (saved === null && students === null) return null;
      return `학생 ${students ?? "?"}명 중 점수 ${saved ?? "?"}건 저장`;
    }
    case "payroll_upsert": {
      const w = won(m.total);
      return join(ctx.nameOf(m.userId), w ? `지급 합계 ${w}` : null);
    }
    case "withdrawal_update": {
      const reason = str(m.reason);
      return join(ctx.nameOf(m.studentId), reason ? `사유: ${reason}` : null);
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
        str(m.date) ? `퇴원일 ${str(m.date)}` : null,
        reason ? `사유: ${reason}` : null,
        str(m.memo),
      );
    }
    case "student_hold":
    case "student_restore": {
      return ctx.nameOf(m.studentId);
    }
    case "student_update": {
      const from = str(m.statusFrom);
      const to = str(m.statusTo);
      const statusChanged =
        from && to && from !== to
          ? `상태 ${STUDENT_STATUS_LABEL[from] ?? from} → ${STUDENT_STATUS_LABEL[to] ?? to}`
          : null;
      return join(ctx.nameOf(m.studentId), statusChanged);
    }
    case "student_create": {
      return ctx.nameOf(m.studentId) ?? str(m.studentName);
    }
    case "student_delete": {
      // 삭제된 학생은 uuid로 이름을 되찾을 수 없다 — 기록 시점의 이름을 metadata에 실어 보존.
      return str(m.studentName) ?? ctx.nameOf(m.studentId);
    }
    case "enrollment_end": {
      const reason = reasonDisplay(str(m.reason));
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        str(m.date) ? `종료일 ${str(m.date)}` : null,
        reason ? `사유: ${reason}` : null,
      );
    }
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
    case "newcomer_check":
    case "newcomer_uncheck": {
      // 항목 이름은 신규생 체크리스트 정의가 단일 소스 — 여기 라벨을 다시 적으면 항목을 바꿀 때 갈린다.
      const item = ONBOARDING_ITEMS.find((i) => i.key === str(m.itemKey));
      return join(ctx.nameOf(m.studentId), item?.label ?? str(m.itemKey), str(m.doneOn));
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
    case "enrollment_dates_update": {
      const f = str(m.field);
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        f ? `${f === "start" ? "시작" : "종료"}일 ${str(m.from) ?? "—"} → ${str(m.to) ?? "—"}` : null,
      );
    }
    case "student_merge": {
      const merged = str(m.mergedName);
      return join(ctx.nameOf(m.studentId), merged ? `← ${merged} 병합` : null);
    }
    case "class_end_term": {
      const d = str(m.closedAt);
      return d ? `종강일 ${d}` : null;
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
      if (parts.length > 0) return `변경: ${parts.join(" · ")}`;
      const fields = Array.isArray(m.changed) ? m.changed.filter((v): v is string => typeof v === "string") : [];
      return fields.length > 0 ? `변경: ${fields.join(", ")}` : null;
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
    case "classnote_report_recall": {
      const c = num(m.reportCount);
      // 누가 지웠는지만큼 "관리자 강제 회수인지 담당 강사 본인 회수인지"가 감사에서 중요하다.
      const who = m.byAdmin === true ? "관리자 회수" : "담당 강사 회수";
      const names = Array.isArray(m.studentNames) ? m.studentNames.filter((x) => typeof x === "string") : [];
      const label = names.length ? `(${names.slice(0, 3).join(", ")}${names.length > 3 ? " 외" : ""})` : "";
      return join(c === null ? `수업보고서 회수 — ${who}` : `수업보고서 ${c}건 회수 — ${who}`, label || null);
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
      return join(code ? `「${code}」` : null, who ? `${who} 반납` : "반납", on, restored ? `${restored}으로 되돌림` : null);
    }
    case "inventory_audit": {
      const code = str(m.assetCode);
      const on = str(m.auditedOn);
      const result = auditResultLabel(str(m.result));
      const loc = str(m.location);
      const act = str(m.action);
      return join(code ? `「${code}」` : null, on, result || null, loc, act ? `조치 ${act}` : null);
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
      return join(
        [code ? `「${code}」` : null, name].filter(Boolean).join(" ") || null,
        from !== null && to !== null ? `수량 ${from} → ${to}` : to !== null ? `수량 ${to}` : null,
        on ? `확인 ${on}` : null,
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
          if (n) parts.push(n);
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
