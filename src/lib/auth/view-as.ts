import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { accessLevel, type SystemRole } from "@/lib/permissions";
import { getActorPermMatrix } from "@/lib/auth/perm-matrix";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isSignedInSuperAdmin, superAdminTargetProtection } from "@/lib/auth/super-admin";
import { canViewAsRole } from "@/lib/auth/role-hierarchy";
import { createClient } from "@/lib/supabase/server";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { tenantViewWriteError } from "@/lib/auth/tenant-view";
import { VIEW_MODE_COOKIE, VIEW_AS_COOKIE } from "@/lib/auth/view-preference";

/**
 * '다른 강사 뷰' — 역할·개인 권한에 따라 전체 편집 또는 읽기 전용으로 연다 (원장 2026-08-19).
 *
 * 설계 원칙:
 * - 전체는 대상의 역할·개인 권한으로 작업한다. 읽기는 저장을 차단한다.
 * - 인증과 감사 기록의 행위자는 실제 로그인 계정으로 유지한다.
 * - 읽기 뷰는 presence를 보내지 않는다. 전체 뷰는 실제 편집자를 표시한다.
 *   원스크린 "다른 창/기기 동시 열림" 경고가 `onescreen:{teacherId}:{date}` 축이라, 여기서 track하면
 *   그 강사 화면에 열람자가 그대로 떴을 것이다.
 * - 쿠키는 신뢰하지 않는다 — 매 요청 [viewAsTeacher]가 자격(토글)·대상(테넌트)을 재검증한다(React cache,
 *   쿠키가 없으면 검증 쿼리 0). 위조 쿠키는 검증에서 무력화될 뿐 아무 효과가 없다.
 */

// 뷰 전환(겸직) 쿠키 — 관리자 계열 역할이 "강사뷰"를 켜면 세팅. 값 "teacher"만 의미 있음(그 외/부재=관리자뷰).
// httpOnly(서버만 읽음) + path "/"(모든 셸 경로 공유, 창=iframe도 같은 도메인이라 전파).
export { VIEW_MODE_COOKIE } from "@/lib/auth/view-preference";

// '다른 강사 뷰' 대상 쿠키 — 값 = 대상 강사의 user id. VIEW_MODE_COOKIE=teacher와 함께일 때만 의미.
export { VIEW_AS_COOKIE } from "@/lib/auth/view-preference";

/**
 * 풀셸(관리자 계열) 역할 판별 — 강사/학생은 미니셸 전용 역할이라 뷰 전환 대상 아님.
 * 나머지(master/admin/manager/accountant/counselor/viewer)는 겸직으로 강사뷰를 켤 수 있다.
 */
export function isFullShellRole(role: SystemRole): boolean {
  return role !== "teacher" && role !== "student";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 역할·개인 권한의 teacher_view 수준. 설정 판정은 실제 로그인 사용자를 기준으로 한다. */
export const otherTeacherViewAccess = cache(async (): Promise<"full" | "readonly" | "none"> => {
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return "none";
  // 🔴 운영 콘솔의 '지점 보기'(읽기 전용)는 **원장 화면 하나**다 — 그 안에서 강사뷰로 갈아타지 않는다. 갈아타면 권한이 대상 강사의
  //    것으로 덮여 보기에서 닫아 둔 메뉴(perm-matrix.ts `TENANT_VIEW_CLOSED_MENUS`)가 다시 열리고, 강사뷰 쿠키가 보기 뒤에도 남는다.
  if (user.tenantView) return "none";
  if (await isSignedInSuperAdmin()) return "full";
  const level = accessLevel(user.systemRole, "teacher_view", await getActorPermMatrix());
  return level === "full" || level === "readonly" ? level : "none";
});

export const canUseOtherTeacherView = cache(async (): Promise<boolean> =>
  (await otherTeacherViewAccess()) !== "none");

export type ViewAsTeacher = CurrentUser & { access: "full" | "readonly" };

/**
 * '다른 강사 뷰' 대상 검증 단일 소스 — 같은 테넌트·학생 아님·**활성(active)만**(피커와 같은 조건, #77:
 * 퇴사·대기 계정 뷰는 UI에서만 감추면 직접 액션 호출로 뚫린다). 진입 액션(switchToOtherTeacherView)과
 * 매 요청 재검증(viewAsTeacher)이 **이 함수 하나**를 쓴다 — 조건이 두 벌이면 반드시 갈라진다.
 * ⚠️ 자격(canUseOtherTeacherView)·쿠키 판독은 호출부 몫 — 여기는 대상 검증만.
 */
export async function loadViewAsTarget(targetId: string): Promise<CurrentUser | null> {
  return (await checkViewAsTarget(targetId)).target;
}

/** 대상 검증 결과 — `unverified` = 조회가 실패해 **확인하지 못함**(무효 대상과 다르다 — 아래 resolveViewAs). */
type ViewAsCheck = { target: CurrentUser | null; unverified: boolean };
const NO_TARGET: ViewAsCheck = { target: null, unverified: false };
const UNVERIFIED: ViewAsCheck = { target: null, unverified: true };

async function checkViewAsTarget(targetId: string): Promise<ViewAsCheck> {
  const user = await getCurrentUser();
  if (!user) return NO_TARGET;
  const supabase = await createClient();
  // 세션 클라이언트(RLS)라 타 테넌트 행은 애초에 안 보이지만 tenant_id 이중 확인.
  const { data, error } = await supabase
    .from("users")
    .select("id, tenant_id, email, display_name, job_title, system_role, status")
    .eq("id", targetId)
    .maybeSingle();
  if (error) return UNVERIFIED;
  if (!data || data.tenant_id !== user.tenantId || data.system_role === "student") return NO_TARGET;
  if (data.status !== "active") return NO_TARGET;
  // 🔴 위계 — 자기보다 높은 역할은 대상이 될 수 없다(2026-11-05 적대 리뷰 치명: 강사뷰 권한을 개인 예외로 받은 상담사가
  //    반을 맡은 원장을 골라 원장의 권한표 · 받은함 · 할 일 현황 · 업무 판정을 빌렸다). 같은 역할은 된다.
  //    운영 계정(실제 로그인)은 위계 예외 · 대상이 운영 계정이면 실제 계정도 운영 계정일 때만(조회 실패 = 막음).
  //    진입과 매 요청 재검증이 이 함수 하나를 쓰므로, 역할이 바뀌면 다음 요청부터 강사뷰가 풀린다.
  if (!(await isSignedInSuperAdmin()) && !canViewAsRole(user.systemRole, data.system_role as SystemRole)) return NO_TARGET;
  const protection = await superAdminTargetProtection(user.id, data.id);
  if (protection === "unknown") return UNVERIFIED;
  if (protection === "protected") return NO_TARGET;
  return {
    target: { id: data.id, tenantId: data.tenant_id, email: data.email ?? "", displayName: ((data.display_name as string | null) ?? "").trim(), jobTitle: data.job_title ?? null, systemRole: data.system_role as SystemRole },
    unverified: false,
  };
}

/**
 * 지금 요청이 '다른 강사 뷰'인가 — 맞으면 **검증된 대상 강사**를, 아니면 null.
 *
 * 매 요청 재검증(캐시 1회): ① 관리자 계열 직원 + 강사뷰 쿠키 ② 자격([canUseOtherTeacherView])
 * ③ 대상이 같은 테넌트의 실존 직원(학생 아님·본인 아님·위계). 하나라도 어긋나면 null = 기존 겸직/관리자 뷰로
 * 조용히 폴백(쿠키를 지울 수는 없지만 — RSC는 쿠키 쓰기 불가 — 아무 효과도 없다).
 *
 * 🔴 진입(switchToOtherTeacherView)·피커와 **같은 조건** — 관리자 계열 역할만(isFullShellRole). 강사 역할에 '강사뷰 접근'을
 *    개인별로 줘도 진입·피커는 막는데 매 요청 재검증만 통과시키면, 쿠키를 직접 만든 강사가 다른 강사를 본다(2026-11-05 적대 재리뷰).
 * 쿠키만으로는 접근을 얻지 못한다.
 */
export const viewAsTeacher = cache(async (): Promise<ViewAsTeacher | null> => (await resolveViewAs()).target);

/**
 * 매 요청 판정의 실체 — 대상과 함께 **확인하지 못했는가**(`unverified`)를 돌려준다.
 * 강사뷰 쿠키가 살아 있는데 대상 조회(users · 운영 계정 보호)가 실패하면 viewAsTeacher는 null이 되어 그 요청은 실제 계정 본인으로
 * 처리된다 — 읽기 강사뷰라면 그 요청만 쓰기가 열리고, 전체 강사뷰라면 대상 X의 일이 A 명의로 저장된다. 그래서 확인하지 못한 요청은
 * **읽기 전용**으로 닫는다(isReadonlyTeacherView = true → 쓰기 캡 · 명시 가드가 모두 거절, 2026-11-05 적대 재리뷰).
 */
const resolveViewAs = cache(async (): Promise<{ target: ViewAsTeacher | null; unverified: boolean }> => {
  const none = { target: null, unverified: false };
  const user = await getCurrentUser();
  if (!user || !isFullShellRole(user.systemRole)) return none;
  // 지점 보기 중에는 이 브라우저에 남아 있던 강사뷰 쿠키(본인 지점에서 쓰던 것)를 읽지 않는다 — 위 otherTeacherViewAccess 주석.
  if (user.tenantView) return none;
  const jar = await cookies();
  if (jar.get(VIEW_MODE_COOKIE)?.value !== "teacher") return none;
  const targetId = jar.get(VIEW_AS_COOKIE)?.value;
  if (!targetId || !UUID_RE.test(targetId) || targetId === user.id) return none;
  const access = await otherTeacherViewAccess();
  if (access === "none") return none;
  const { target, unverified } = await checkViewAsTarget(targetId);
  return { target: target ? { ...target, access } : null, unverified };
});

/**
 * 지금 요청이 '다른 강사 뷰'(열람 전용)인가 — 쓰기 캡·presence 차단·배지 노출의 공용 판정.
 * 강사뷰 쿠키가 있는데 대상을 **확인하지 못한** 요청도 true(위 resolveViewAs — 확인 못 한 요청은 쓰지 않는다).
 */
export async function isReadonlyTeacherView(): Promise<boolean> {
  const { target, unverified } = await resolveViewAs();
  return unverified || target?.access === "readonly";
}

/** 강사뷰 대상을 확인하지 못해 저장을 거절할 때의 문구(조회 순간 장애 — 새로고침하면 대개 풀린다). */
export const TEACHER_VIEW_UNVERIFIED_ERROR = "강사뷰 대상을 확인하지 못해 저장하지 않았습니다 — 잠시 뒤 새로고침해 주세요";

// 거절 문구는 클라 토스트와 공유하는 순수 모듈(view-as-message.ts)이 단일 소스 — 기존 소비처를 위해 재수출.
export { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";

/**
 * 쓰기 서버 액션 공용 가드 — '다른 강사 뷰'면 거절 사유(한글)를, 아니면 null.
 *
 * 🔴 **강사 명의/귀속으로 쓰는 액션은 반드시 이걸 먼저 통과**할 것(공지 발송·학생 순서·보고서 저장 등
 *    `effectiveTeacherId`를 귀속에 쓰는 파일 전부 — view-as-wiring.test.ts가 목록을 잠근다).
 *    canWriteTenant/accessLevelTenant를 지나는 쓰기는 perm-matrix 캡이 자동 차단하므로 별도 가드 불요.
 */
export async function readonlyTeacherViewError(): Promise<string | null> {
  // 운영 콘솔의 '지점 보기'(읽기 전용)도 같은 문에서 거절한다 — 이 가드를 먼저 지나는 액션(발송 · 강사 귀속 쓰기)은
  // 외부로 나가는 일을 품고 있어, 데이터 접근 층의 쓰기 차단보다 **앞에서** 멈춰야 한다.
  const tenantView = await tenantViewWriteError();
  if (tenantView) return tenantView;
  if ((await resolveViewAs()).unverified) return TEACHER_VIEW_UNVERIFIED_ERROR;
  return (await isReadonlyTeacherView()) ? READONLY_TEACHER_VIEW_ERROR : null;
}
