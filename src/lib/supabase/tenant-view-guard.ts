import { TENANT_VIEW_READONLY_MESSAGE } from "@/lib/auth/tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — **쓰기 요청을 데이터 접근 층에서 막는** 가드.
 *
 * 보기 중인 요청이 Supabase로 보내는 요청 가운데 읽기가 아닌 것(넣기·고치기·지우기·저장소 올리기·계정 관리 ·
 * 값을 바꾸는 함수)을 여기서 돌려보낸다. 화면의 버튼을 감추는 것(권한 캡)과 별개로, 어떤 서버 액션이 불리든
 * 이 한 곳을 지나야 DB에 닿는다.
 *
 * - 세션 클라이언트: DB도 같은 일을 한다(0356a — 쓰기 요청에는 보는 지점이 적용되지 않는다). 여기서 먼저 막는 것은
 *   운영자 **본인 지점**에 엉뚱한 값이 적히는 것(보기 설정 저장 등)까지 막기 위해서다.
 * - service_role 클라이언트: RLS를 우회하므로 **이 가드가 유일한 벽**이다.
 *
 * 🔴 `"use client"`도 `import "server-only"`도 붙이지 않는다 — 순수 함수라 테스트가 그대로 부른다.
 */

/**
 * 읽기만 하는 DB 함수(STABLE) — 보기 중에도 부를 수 있다. PostgREST는 STABLE 함수를 읽기 전용 트랜잭션으로 돌리므로
 * 여기 적힌 이름이 실제로는 값을 바꾸는 함수였다 해도 DB가 쓰기를 거절한다(이 목록은 '통과시켜도 되는 것'의 표시일 뿐이다).
 *
 * 🔴 새 읽기 함수를 `.rpc()`로 부르기 시작하면 여기 한 줄을 더할 것 — 빠지면 보기 화면에서만 그 조회가 막힌다
 *    (가드: tenant-view-wiring.test.ts가 마이그레이션의 STABLE 함수와 대조한다).
 * 🔴 **지점을 `auth_tenant_id()`로 정하지 않는 함수는 넣지 말 것** — 보강관리 함수들(`makeup_*`)이 그렇다. 로그인한 사람의
 *    `users` 행에서 지점을 직접 읽어, 보기 중에 부르면 운영자 **본인 지점**의 기록이 보는 지점 화면에 섞여 나온다.
 *    그런 화면은 보기에서 닫는다(권한 캡 — perm-matrix.ts `TENANT_VIEW_CLOSED_MENUS`).
 */
export const TENANT_VIEW_READ_RPCS: ReadonlySet<string> = new Set([
  // 오늘 수학 성적표가 걸린 날(0373a) — cron이 admin으로 부르는 읽기지만 목록 규약상 여기 둔다.
  "todays_math_exam_report_dates",
  // 사람별 열린 할 일(0377a) — 서버가 관리 키로 부르는 읽기(보기 중엔 할 일 화면이 비어 부르지 않는다). 목록 규약상 여기 둔다.
  "staff_task_counts",
  // 담당자별 의무 집계(s2_0040) — 강사 홈 '오늘 내 업무' 줄이 관리 키로 부르는 읽기. 목록 규약상 여기 둔다.
  "duty_counts",
  // 기한 지났는데 열린 의무가 남은 지난 날들(s2_0040) — cron이 관리 키로 부르는 읽기. 목록 규약상 여기 둔다.
  "duty_open_cycles",
  // 출결 통계 등원율 추이(0387a) — 읽기 전용 group-by.
  "attendance_rate_buckets",
  // 원생 기여도 학생별 합계(0443a) — 읽기 전용 집계(stable). 지점 보기에서도 기여도 화면이 같은 값을 읽게.
  "student_contribution_totals",
  // 학생 온톨로지 현재 수강·담당 연결(0446a) — 읽기 전용 집계(stable). 지점은 서버가 넘긴 p_tenant뿐(로그인한 사람의 행에서 정하지 않는다).
  "student_ontology_current_scope",
  // 보고서 통계 숙제·학부모 확인 추이(0388a) — 읽기 전용 group-by.
  "lesson_report_buckets",
  "consultation_class_candidates",
  "consultation_gap_students",
  "consultation_monthly_stats",
  "consultation_path_stats",
  "consultation_stats",
  "dashboard_absence_risk",
  "dashboard_absence_risk_admin",
  "dashboard_top_outstanding",
  "dashboard_top_outstanding_admin",
  "dashboard_unassigned_enrolled",
  "dashboard_unassigned_enrolled_admin",
  "get_staff_recent_access",
  "invoice_periods",
  "lesson_report_class_options",
  "lesson_report_filter_options",
  "onescreen_parent_read_stats",
  "onescreen_prior_reports",
  "onescreen_send_calendar",
  "page_usage_summary",
  "protected_guard_triggers",
  "session_term_attendance",
  "timetable_latest_reports",
]);

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function methodOf(input: FetchInput, init: FetchInit): string {
  const fromInit = init?.method;
  const fromRequest = typeof input === "object" && input !== null && "method" in input ? (input as Request).method : undefined;
  return (fromInit ?? fromRequest ?? "GET").toUpperCase();
}

function pathOf(input: FetchInput): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

/**
 * 이 요청이 '값을 바꾸는 요청'인가.
 * - GET · HEAD · OPTIONS = 읽기.
 * - `/auth/v1/token`(로그인 세션 갱신) · `/auth/v1/logout`(로그아웃)의 POST = 통과. 그 밖의 계정 요청(비밀번호 · 이메일 바꾸기 ·
 *   가입 · 메일 보내기 · 관리자 API)은 쓰기다 — 보기 중에 운영자 본인 계정이 바뀌거나 메일이 나가면 안 된다.
 * - `/rest/v1/rpc/<이름>` = 목록에 있는 읽기 함수만 통과.
 * - 저장소의 **읽기용 POST** 둘 = 통과: 내려받기 서명 주소 만들기(`/object/sign/…`) · 파일 목록(`/object/list/…`).
 *   이름은 POST지만 아무것도 바꾸지 않는다 — 막으면 보기 화면의 로고 · 첨부 · 녹음이 전부 깨진다.
 *   올리기용 서명(`/object/upload/sign/…`)은 다른 주소라 여기 걸리지 않는다(쓰기).
 * - 그 밖(표 쓰기 · 저장소 올리기·옮기기·지우기 · 계정 관리 · 엣지 함수) = 쓰기.
 *
 * 🔴 경로는 **맨 앞부터** 맞춘다(`^`). 끝만 보면 `/storage/v1/object/<버킷>/…/auth/v1/token`처럼 파일 경로의 끝이 통과 모양을
 *    흉내 낸 올리기가 읽기로 넘어간다.
 */
export function isTenantViewWrite(input: FetchInput, init?: FetchInit): boolean {
  const method = methodOf(input, init);
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  const path = pathOf(input);
  if (method === "POST" && /^\/auth\/v1\/(token|logout)$/.test(path)) return false;
  const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/i.exec(path);
  if (rpc) return !TENANT_VIEW_READ_RPCS.has(rpc[1]!);
  if (method === "POST" && /^\/storage\/v1\/object\/(sign|list)\//.test(path)) return false;
  return true;
}

/** 막은 요청에 돌려주는 응답 — PostgREST 권한 오류(42501)와 같은 모양이라 호출부의 기존 오류 처리가 그대로 받는다. */
export function tenantViewBlockedResponse(): Response {
  return new Response(
    JSON.stringify({ code: "42501", message: TENANT_VIEW_READONLY_MESSAGE, details: null, hint: null, error: "forbidden", statusCode: "403" }),
    { status: 403, statusText: "Forbidden", headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

/**
 * 보기 중인지 물어 보고 쓰기면 막는 fetch.
 * `isViewing`은 **쓰기 요청일 때만** 불린다 — 읽기 요청과 보기와 무관한 요청은 한 줄도 더 돌지 않는다.
 */
export function guardTenantViewFetch(isViewing: () => boolean | Promise<boolean>, base?: typeof fetch): typeof fetch {
  return (async (input: FetchInput, init?: FetchInit) => {
    if (isTenantViewWrite(input, init) && (await isViewing())) return tenantViewBlockedResponse();
    // 전역 fetch는 **부르는 순간**에 집는다 — 클라이언트 라이브러리의 기본 동작과 같다(Next가 감싼 fetch를 그대로 쓴다).
    return (base ?? fetch)(input, init);
  }) as typeof fetch;
}
