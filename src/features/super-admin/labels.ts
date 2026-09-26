/**
 * 슈퍼관리자 화면의 **표시 어휘 단일 소스** — 플랜·계정 상태·라이선스 기능·감사 로그 액션의 한글 라벨과 뜻(tone).
 *
 * 계기(원장 2026-09-25, 폰 캡처와 함께 *"색상 등이 기존과 너무 차이나는걸?"* → *"완전한 리팩토링하면서 모바일
 * 레이아웃까지 잡아. 이것까지 관리된다 싶을정도로 전부 관리"*): 이 영역은 2026-05-28 첫 구현 그대로 남아 있어서
 * ① 배지 색을 화면마다 `PillColor`로 직접 골랐고(의미색 캐논 밖) ② 감사 로그가 `metadata`를 **JSON 원문**으로 찍었고
 * ③ 역할 선택지가 `ROLE_LABEL`과 다른 사본("상담"·"뷰어" ↔ "상담사"·"참관")이었다. 전부 여기로 모은다.
 *
 * 🔴 화면 파일에 라벨·색 표(`ACTION_META`·`STATUS_LABEL`·`SEAT_FEATURES`…)를 다시 만들지 말 것 — 가드
 *    [`super-admin-design.test.ts`](src/app/(super-admin)/super-admin-design.test.ts)가 잡는다.
 * 🔴 색은 `PillColor`가 아니라 **tone**으로 고른다([`semantic-color.ts`](src/lib/design/semantic-color.ts)).
 * ⚠️ 서버·클라 양쪽이 import한다 — `"use client"`·`import "server-only"` 금지([[#61]]·[[#81]]).
 */
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import type { SemanticTone } from "@/lib/design/semantic-color";

// ── 플랜 ────────────────────────────────────────────────────────────────
/** 알려진 플랜 키의 한글 이름. 플랜은 발급 폼에서 **자유 입력**이라 모르는 값은 적힌 그대로 보인다(운영자가 직접 친 글자). */
const PLAN_LABEL: Record<string, string> = {
  free: "무료",
  demo: "데모",
  pro: "프로",
  enterprise: "엔터프라이즈",
};

/** 플랜 입력 칸의 빠른 선택 칩 — 한글 이름을 보이고 저장 키를 채운다. */
export const PLAN_PRESETS = Object.entries(PLAN_LABEL)
  .filter(([value]) => value !== "demo") // 데모는 시연 지점 전용 — 새 학원에 고를 값이 아니다
  .map(([value, label]) => ({ value, label }));

export function planLabel(plan: string | null | undefined): string {
  const key = (plan ?? "").trim();
  if (!key) return "—";
  return PLAN_LABEL[key.toLowerCase()] ?? key;
}

/** 유료 계약(프로·엔터프라이즈) = 정상(positive) · 무료·데모 = 비활성(inert) · 모르는 플랜 = 정보(info — 뜻을 지어내지 않는다). */
const PAID_PLANS = new Set(["pro", "enterprise"]);
const UNPAID_PLANS = new Set(["free", "demo"]);

export function planTone(plan: string | null | undefined): SemanticTone {
  const key = (plan ?? "").trim().toLowerCase();
  if (PAID_PLANS.has(key)) return "positive";
  if (UNPAID_PLANS.has(key)) return "inert";
  return "info";
}

// ── 계정 상태 ──────────────────────────────────────────────────────────
const USER_STATUS: Record<string, { label: string; tone: SemanticTone }> = {
  active: { label: "활성", tone: "positive" },
  inactive: { label: "비활성", tone: "inert" },
  pending: { label: "대기", tone: "caution" },
};

export function userStatusMeta(status: string): { label: string; tone: SemanticTone } {
  return USER_STATUS[status] ?? { label: "알 수 없음", tone: "inert" };
}

// ── 역할 선택지 ─────────────────────────────────────────────────────────
/**
 * 슈퍼관리자가 계정에 줄 수 있는 역할 — 라벨은 `ROLE_LABEL` 그대로(직원관리와 같은 이름).
 * 학생(student)은 직원 위계 밖이라 뺀다(서버 `changeUserRole`도 거절한다).
 */
export const ASSIGNABLE_ROLES: { value: SystemRole; label: string }[] = (
  ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"] as const
).map((value) => ({ value, label: ROLE_LABEL[value] }));

// ── 라이선스 기능 ──────────────────────────────────────────────────────
export const SEAT_FEATURES = [{ key: "student_seats", label: "재원생 좌석" }] as const;
/**
 * 켜기·끄기 기능 — **`defaultOn` = 라이선스 행이 없을 때의 실제 동작**이다. 카드의 스위치는 이 값을 보여야 한다
 * (행이 없는데 '꺼짐'으로 그리면, 실제로는 도는 기능을 꺼진 것처럼 속인다).
 * - 녹음·시트·AI = 기본 켜짐: 라이선스 카드가 생기기 전부터 쓰던 기능이라 행이 없으면 허용([`rule.ts`](src/lib/license/rule.ts)).
 * - 카카오 알림 = 기본 꺼짐: 학부모에게 실제 메시지가 나가는 기능이라 **명시로 켠 지점만** 보낸다(`resolveKakaoChannel`).
 * - 오늘의 수학 연결 = 기본 꺼짐: 외부 앱 메뉴·데이터 반출이라 **명시로 켠 지점만**(`isFeatureOptedIn`).
 * 🔴 여기 한 줄을 더하면 **그 키를 읽는 곳**(게이트)도 함께 만들 것 — 읽는 곳 없는 스위치는 거짓 약속이다(2026-09-25 전수 확인).
 */
export const TOGGLE_FEATURES = [
  { key: "ai_analysis", label: "AI 분석", defaultOn: true },
  { key: "google_sheets", label: "구글 시트 연동", defaultOn: true },
  { key: "meeting_recording", label: "회의 녹음·전사", defaultOn: true },
  { key: "kakao_messaging", label: "등하원 카카오 알림", defaultOn: false },
  // 화면 방식 — 켜짐 = PC 관리자뷰에서 메뉴마다 플로팅 창(iframe) · 꺼짐 = 일반 웹앱처럼 본문 하나(원장 2026-09-25).
  // 강사·학생 화면과 폰은 원래 창이 없어 이 스위치와 무관하다. 읽는 곳 = (shell)/layout.tsx.
  { key: "window_mode", label: "창 모드(메뉴를 플로팅 창으로)", defaultOn: true },
  // 연결 앱 — 켠 지점만 왼쪽 '연결 앱'에 바로가기가 서고, 오늘의 수학이 당겨 가는 명단·진도 API도 이 스위치를 본다
  // (원장 2026-09-26). 읽는 곳 = (shell)/layout.tsx · api/integrations/todays-math/*. 목록 = features/connected-apps.
  { key: "todays_math", label: "오늘의 수학 연결", defaultOn: false },
] as const;

export function featureLabel(key: unknown): string {
  const hit = [...SEAT_FEATURES, ...TOGGLE_FEATURES].find((f) => f.key === key);
  return hit ? hit.label : "기타 기능";
}

// ── 감사 로그 액션 ─────────────────────────────────────────────────────
/**
 * 액션의 이름과 뜻. 뜻 배정:
 * - 새로 생김(발급) = positive · 정보 수정·라이선스 = info · 남의 지점을 들여다봄·역할/활성 변경 = caution
 * - 비밀번호 재설정 = critical(계정 접근을 바꾸는 가장 센 조치)
 */
export const AUDIT_ACTIONS = {
  create_tenant: { label: "학원 발급", tone: "positive" },
  update_tenant: { label: "학원 수정", tone: "info" },
  impersonate_view: { label: "지점장 보기", tone: "caution" },
  grant_license: { label: "좌석 설정", tone: "info" },
  toggle_license: { label: "기능 켜기·끄기", tone: "info" },
  change_user_role: { label: "역할 변경", tone: "caution" },
  reset_user_password: { label: "비밀번호 재설정", tone: "critical" },
  set_user_active: { label: "계정 활성·비활성", tone: "caution" },
} as const satisfies Record<string, { label: string; tone: SemanticTone }>;

export type AuditActionKey = keyof typeof AUDIT_ACTIONS;

/** 필터 드롭다운 선택지 — 위 표에서 그대로 뽑는다(사본 금지). */
export const AUDIT_ACTION_OPTIONS = (Object.keys(AUDIT_ACTIONS) as AuditActionKey[]).map((value) => ({
  value,
  label: AUDIT_ACTIONS[value].label,
}));

export function auditActionMeta(action: string): { label: string; tone: SemanticTone } {
  return (AUDIT_ACTIONS as Record<string, { label: string; tone: SemanticTone }>)[action] ?? {
    label: "기타 조치",
    tone: "inert",
  };
}

/**
 * 감사 로그 한 줄의 **사람이 읽는 상세** — `metadata` 원문(JSON)을 화면에 찍지 않는다(원문 노출 금지 규칙).
 * 원문은 호출부가 `title` 툴팁으로 건다. 사용자 id(uuid)는 읽을 수 있는 정보가 아니라 문장에서 뺀다.
 */
export function auditDetail(action: string, metadata: Record<string, unknown> | null): string {
  const m = metadata ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  switch (action) {
    case "create_tenant":
      return [
        str(m.slug) ? `학원 코드 ${str(m.slug)}` : null,
        str(m.masterEmail) ? `원장 ${str(m.masterEmail)}` : null,
        str(m.plan) ? `플랜 ${planLabel(str(m.plan))}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—";
    case "update_tenant":
      // 이름·플랜을 한 폼으로 저장한다 — 로그엔 플랜만 남으므로 플랜이 비었으면 무엇을 고쳤는지만 말한다.
      return str(m.plan) ? `이름·플랜 저장 (플랜 ${planLabel(str(m.plan))})` : "이름·플랜 저장";
    case "impersonate_view":
      return "읽기 전용으로 들여다봄";
    case "grant_license": {
      const seats = m.maxSeats;
      const limit = typeof seats === "number" ? `최대 ${seats.toLocaleString("ko-KR")}석` : "제한 없음";
      return `${featureLabel(m.feature)} ${limit}`;
    }
    case "toggle_license":
      return `${featureLabel(m.feature)} ${m.active === true ? "켬" : "끔"}`;
    case "change_user_role": {
      const role = str(m.role);
      return role ? `역할 → ${ROLE_LABEL[role as SystemRole] ?? "알 수 없는 역할"}` : "—";
    }
    case "reset_user_password":
      return "임시 비밀번호 발급";
    case "set_user_active":
      return m.active === true ? "활성화" : "비활성화";
    default:
      return "—";
  }
}
