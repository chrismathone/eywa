import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { permissionAccountIds, platformAccountIds } from "@/features/owner/server/platform-settings";
import { canAccessTenant, canWriteTenant, canManageTenant, getUserPermMatrix, tenantClosedMenus } from "@/lib/auth/perm-matrix";
import { OWNER_SECTION_MENU, type SettingsRoleKey } from "@/lib/settings-role-catalog";
import { fallbackOwnerFace, ownerFaceHref, ownerFaceMenu } from "@/features/owner/face-access";
import { operationsForViewer, seatPinStatus } from "@/features/owner/seat-pin-view";
import { kstToday } from "@/lib/date-kst";
import { OWNER_FACES, ownerTabLabel, resolveOwnerTab, type OwnerFaceDef, type OwnerFaceKey, type OwnerTab } from "@/features/owner/tabs";
import { getTenantSettings, getSettingsMeta, getUserDisplayNames, getPermissionStaffOptions, getTenantSettingsForEdit } from "@/features/owner/server/queries";
import { operationsFaceTokens } from "@/features/owner/server/operations-save";
import { permissionsToken } from "@/features/owner/server/permissions-save";
import { retiredPeople } from "@/features/owner/server/retired-lookup";
import { withoutRetiredPeople, type RetiredPeople } from "@/features/owner/retired-people";
import { getClassroomsWithUsage } from "@/features/owner/server/classroom-queries";
import { getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { getPeriodDefsForEditor } from "@/features/periods/server/queries";
import { OwnerTabBar } from "./_components/owner-tab-bar";
import { PageHeader } from "@/components/page-header";
import { PageMaximizeToolbar } from "@/components/page-maximize/page-maximize-toolbar";
import { ProfileSection } from "./_components/profile-section";
import { OperationsSection } from "./_components/operations-section";
import { SubjectsSection } from "./_components/subjects-section";
import { BillingSection } from "./_components/billing-section";
import { NotificationsSection } from "./_components/notifications-section";
import { ConsultationsSection } from "./_components/consultations-section";
import { PermissionsSection } from "./_components/permissions-section";
import { NavigationSection } from "./_components/navigation-section";
import { ModulesSection } from "./_components/modules-section";
import { MakeupsSection } from "./_components/makeups-section";
import { isGenericTenant } from "@/features/owner/preset";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess, type MenuKey } from "@/lib/permissions";
import { navigationEditorGates } from "@/features/owner/server/navigation-editor-gates";
import { DataFace } from "./_components/data-face";
import { DuplicatesFace } from "./_components/duplicates-face";
import { SameNameFace } from "./_components/same-name-face";
import { AuditFace } from "./_components/audit-face";
import { IntegrationsFace } from "./_components/integrations-face";
import { isFeatureLicensed } from "@/lib/license/server";
import { ARCHIVE_TENANT } from "@/features/marketing-archive/model";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { PopupsFace } from "./_components/popups-face";
import { ImportHubFace } from "./_components/import-hub-face";
import { DashboardFace } from "./_components/dashboard/dashboard-face";
import { EvaluationFace } from "./_components/evaluation/evaluation-face";
import { getContributionGate } from "@/features/student-contribution/server/access";
import { ContributionSettingsFace } from "@/features/student-contribution/components/settings-face";
import { getPortfolioGate } from "@/features/teacher-portfolio/server/queries";
import { getTenantConnectedApps } from "@/features/connected-apps/server/visible";
import { connectedAppNote } from "@/features/connected-apps/apps";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { writeLockedNote } from "@/lib/write-lock";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | undefined>;
// 면 목록은 **단일 소스**(src/features/owner/tabs.ts) — 상단 FaceTabs · 왼쪽 사이드바 하부탭 · 설정 메뉴 판이
// 같은 배열에서 파생된다. 여기에 목록을 다시 적지 말 것(원장 2026-08-07: 한쪽만 고쳐 사이드바가 stale).
/**
 * 🔴 감사로그 면은 **원장(master)·총괄(super_admin) 전용**(원장 2026-09-09 *"감사로그는 마스터 이상급으러만"*).
 *    같은 날 DB 정책도 그렇게 좁혔다(0253a·0253b) — 그래서 위임받은 admin·manager에게 이 면을 세워 두면
 *    **에러 없이 늘 빈 목록**이 뜬다(조용한 거짓말). 자물쇠는 RLS고([[#77]]) 여기서 감추는 건 그 사실을
 *    화면에 반영하는 것이다. ⚠️ 이 학원은 `owner` 메뉴를 admin·manager에게 위임해 뒀다(실측 활성 11명).
 */
function facesFor(canReadAudit: boolean, showModules: boolean, showMakeups: boolean, showEvaluation: boolean, showContribution: boolean): OwnerFaceDef[] {
  // 원장 위에게만 서는 면(감사로그 · 대시보드 관리 · 기능)은 위임 계정엔 세우지 않는다 — 주소로 와도 안내 문구(아래 본문).
  // '기능'(모듈 켜기·끄기) 면은 **새 학원(일반판)에만** 선다 — 침산 설정 화면은 이 면이 생기기 전과 같아야 한다(원장 2026-09-22).
  return OWNER_FACES.filter((f) => (!f.masterOnly || canReadAudit) && (!f.genericOnly || showModules) && (f.key !== "makeups" || showMakeups)
    && (f.key !== "evaluation" || showEvaluation) && (f.key !== "contribution" || showContribution));
}

/**
 * **자체 판정을 하는 면** — 학원 설정 쓰기 권한(페이지의 fieldset 잠금 · '읽기 전용' 안내)을 따르지 않는다.
 * 고치는 것이 없거나(감사로그), 다른 권한으로 버튼을 세우는 면이다(데이터 정리 · 데이터 가져오기).
 */
const SELF_GATED_TABS: ReadonlySet<OwnerTab | "modules"> = new Set(["data", "import", "audit", "evaluation", "contribution"]);

/**
 * 읽기 권한 안내를 **면이 직접** 적는 면 — 섹션 폼(SectionForm readOnly)이나 팝업 공지 목록이 `writeLockedNote`를 제자리에 적는다.
 * 페이지 위의 안내 한 줄은 그 밖의 면(연동 · 역할·권한)에만 세운다 — 두 번 적지 않는다.
 */
const FACE_WRITES_OWN_NOTE: ReadonlySet<OwnerTab | "modules"> = new Set([
  "profile", "operations", "subjects", "makeups", "billing", "notifications", "consultations", "navigation", "modules", "dashboard", "popups",
]);

/** 요청한 면 + 학원 설정 → 실제로 보일 면. '기능' 면은 일반판 학원에서만 열리고, 침산에선 기본 면(프로필)으로 떨어진다. */
function effectiveTab(sp: Sp, settings: { preset: "chinsan" | "generic" }): OwnerTab | "modules" {
  return sp.tab === "modules" && isGenericTenant(settings) ? "modules" : resolveTab(sp);
}

function resolveTab(sp: Sp): OwnerTab {
  // 중복 학생(dup)은 데이터 정리(data) 면으로 통합 — 옛 ?tab=dup 북마크는 data로 흡수.
  return resolveOwnerTab(sp.tab === "dup" ? "data" : sp.tab);
}

function fmt(iso: string | null): string {
  if (!iso) return "아직 저장된 설정 없음 (기본값 사용 중)";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// 면마다 문서 제목을 달리해 창 타이틀바가 "학원 설정 · 운영 체계"로 라이브 갱신(route-window 관찰).
// 강사평가 저장 뒤 진행 중인 달을 다시 매기는 일(after)이 이 화면의 서버 액션 안에서 돈다 — 직원 평가 화면의 [지금 집계]와 같은 상한.
export const maxDuration = 120;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  // '기능' 면 판정에만 설정이 필요하다 — 그 외엔 종전처럼 조회 없이(요청 캐시라 본문과 같은 조회를 나눠 쓴다).
  const tab = sp.tab === "modules" ? effectiveTab(sp, await getTenantSettings()) : resolveTab(sp);
  return { title: `학원 설정 · ${ownerTabLabel(tab)} — 에이와` };
}

export default async function OwnerSettingsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  // 옛 설정 탭은 권한 검사에 앞서 현재 주소로 보낸다. 도착 화면이 해당 설정 권한을 검사한다.
  if (sp.tab === "report_mgmt") redirect("/lesson-reports");
  if (sp.tab === "report") redirect("/lesson-reports?tab=report");
  if (sp.tab === "ai_ment") redirect("/lesson-reports?tab=ai_ment");
  if (sp.tab === "sessions") redirect("/owner?tab=subjects");
  const requested = resolveTab(sp);
  // '기능' 면은 새 학원(일반판)에서만 선다 — 침산에서 그 주소로 오면 기본 면으로 떨어지고, 게이트도 기본 면의 것이다.
  // 일반판에서는 이 면의 권한 키가 학원 설정(owner)이다(전에는 기본 면의 키로 들어와 본문에서만 걸렀다).
  const requestedFace: OwnerFaceKey =
    sp.tab === "modules" && isGenericTenant(await getTenantSettings()) ? "modules" : requested;
  const menu = ownerFaceMenu(requestedFace);
  // 요청한 면의 권한이 없어도 **다른 면을 맡은 사람**은 그 면으로 보낸다 — 설정은 면마다 권한이 따로라, 운영 설정만 맡은 사람이
  // 왼쪽 '설정'(기본 면 = 프로필)을 누르면 맡은 면이 있는데도 운영실로 튕겼다. 보낼 면이 없으면 아래 가드가 종전처럼 처리한다.
  // ⚠️ 권한이 있는 평소 경로에서는 여기서 더 조회하지 않는다(사용자·권한 표는 요청 안에서 한 번만 읽힌다).
  const actor = await getCurrentUser();
  if (actor && requestedFace === "makeups" && !(await isLaboratoryMenuAvailable(actor.tenantId, "makeups"))) redirect("/owner");
  // 강사평가는 직원 포트폴리오를 볼 수 있는 사람(원장 위 · 직원 평가 실험실이 열린 지점)에게만 — 그 밖엔 없는 면이다.
  if (actor && requestedFace === "evaluation" && !(await getPortfolioGate())) redirect("/owner");
  if (actor && requestedFace === "contribution" && !(await getContributionGate())?.canConfigure) redirect("/owner");
  if (actor) {
    const matrix = await getUserPermMatrix();
    if (!canAccess(actor.systemRole, menu, matrix)) {
      const fallback = fallbackOwnerFace(requestedFace, {
        systemRole: actor.systemRole,
        matrix,
        isMasterLevel: actor.systemRole === "master" || (await isCurrentUserSuperAdmin()),
        isGeneric: isGenericTenant(await getTenantSettings()),
      });
      // 창(embed) 안에서 보낼 때는 embed 표식을 유지한다(빼면 창 안에 전체 화면 틀이 뜬다).
      if (fallback) redirect(ownerFaceHref(fallback, sp.embed === "1"));
    }
  }
  const viewer = await requireAccess(menu);
  const canEditSettings = await canWriteTenant(viewer.systemRole, menu);
  const allowedEntries = await Promise.all(
    OWNER_FACES.map(async (face) => [face.key, await canAccessTenant(viewer.systemRole, ownerFaceMenu(face.key))] as const),
  );
  const allowedTabs = new Map<OwnerFaceKey, boolean>(allowedEntries);
  // 역할·권한(permissions) 편집은 항상 master 전용(self-escalation 차단 — saveOwnerSection·0080a 트리거와 동일).
  // 위임받은 admin/manager는 다른 설정 면은 편집 가능하되 이 면만 안내로 대체(저장이 실패할 폼을 보여주지 않음).
  const isMaster = viewer.systemRole === "master";
  // 감사로그는 원장 위(총괄 포함)만 — 결정 로그 *"super_admin은 새로 만드는 어떤 제한 명단·게이트도
  // 자동 통과한다"*(원장 2026-08-13). 🔴 `systemRole === "master"`만 보면 총괄이 자기 시스템에서 잠긴다
  // (실측: 총괄 2명 중 1명의 users.system_role은 'admin'이다).
  const canReadAudit = isMaster || (await isCurrentUserSuperAdmin());
  const [settings, meta] = await Promise.all([getTenantSettings(), getSettingsMeta()]);
  const [showMakeups, showEvaluation, showContribution] = await Promise.all([
    isLaboratoryMenuAvailable(viewer.tenantId, "makeups"),
    getPortfolioGate().then(Boolean),
    getContributionGate().then((gate) => !!gate?.canConfigure),
  ]);
  const tab = effectiveTab(sp, settings);
  /**
   * 운영 섹션을 클라이언트로 넘기는 두 면(운영 체계 · 과목 운영) — **저장할 수 없는 열람자에게는 자리 PIN 값을 지우고** 넘긴다.
   * 🔴 판정은 저장 액션과 같은 함수·같은 키(`canWriteTenant` × 운영 섹션의 메뉴)다 — 화면의 '읽기 전용' 표시와 따로 놀면
   *    값을 지운 payload를 받은 사람이 저장할 수 있게 된다. 다른 면에서는 운영 섹션을 내려보내지 않는다.
   * 🔴 `settings.operations`를 이 두 면에 **직접 넘기지 말 것** — prop과 숨은 입력(JSON)에 값이 그대로 실린다
   *    (가드 `seat-pin-view.test.ts`).
   */
  const showsOperations = tab === "operations" || tab === "subjects";
  const canEditOperations = showsOperations ? await canWriteTenant(viewer.systemRole, OWNER_SECTION_MENU.operations) : false;
  /**
   * 편집자에게는 **캐시 없이 방금 읽은** 운영 섹션으로 폼과 기준 token을 만든다(설정 캐시는 낡을 수 있다 — queries.ts).
   * 못 읽으면 폼을 세우지 않는다(기본값 위에서 편집하게 두지 않는다).
   * 🔴 token은 **저장할 수 있는 사람에게만** 만든다 — 운영 체계 면의 token은 자리 PIN에서 나온 값이라 읽기 전용 열람자에겐 보내지 않는다.
   */
  // 역할·권한 면도 같다 — 원장에게만 편집 폼이 서고, 그 폼과 기준 token은 방금 읽은 값으로 만든다
  // (개인별 예외는 운영자 스크립트로도 바뀐다 — 낡은 값으로 폼을 열면 저장이 그 변경을 되돌리려다 거절된다).
  const showsPermissions = tab === "permissions" && isMaster;
  const needsFreshRead = (showsOperations && canEditOperations) || showsPermissions;
  const editable = needsFreshRead ? await getTenantSettingsForEdit(viewer.tenantId) : undefined;
  const settingsUnreadable = editable === null;
  const operationsSource = editable?.settings.operations ?? settings.operations;
  const operationsTokens = editable && canEditOperations ? operationsFaceTokens(editable.settings.operations) : undefined;
  const operationsForClient = operationsForViewer(operationsSource, canEditOperations);
  // 못 읽었으면 undefined — 아래에서 폼 대신 오류 안내가 선다(캐시된 값으로 폼을 열지 않는다).
  const permissionsSource = showsPermissions ? editable?.settings.permissions : undefined;
  /**
   * 데이터 정리 면의 정리 작업(퇴원 · 삭제 · 수강 종료 · 병합) — **각 액션과 같은 판정**(관리자 도구 쓰기)으로 버튼을 세운다.
   * 🔴 이 면은 학원 설정 쓰기 권한(아래 fieldset)과 무관하다: 설정은 고칠 수 있어도 정리 권한이 없는 사람에겐 눌러도 거절될
   *    버튼이 서 있었고, 정리 권한은 있는데 설정이 읽기 전용인 사람은 버튼이 통째로 잠겨 있었다. 조회·링크는 누구에게나 그대로다.
   */
  const canManageData = tab === "data" ? await canWriteTenant(viewer.systemRole, "admin") : false;
  // 강의실(관계형 테이블)은 운영 체계 면에서만 로드 — 다른 면 진입 비용 0.
  const classrooms = tab === "operations" ? await getClassroomsWithUsage() : [];
  // 강의실 엑셀로 넣기 — 운영 설정의 full만(올리기 주소 `gateImport`와 같은 판정).
  const canImportClassrooms = tab === "operations" ? await canManageTenant(viewer.systemRole, "operations_settings") : false;
  // 과목별 강사 라벨(과목 운영 '가로줄 제외 강사' 칩)은 해당 면에서만 로드.
  const teacherLabelsBySubject = tab === "subjects" ? await getTeacherLabelsBySubject() : {};
  // 개인별 권한에 이름이 올라 있는 계정의 이름 — 역할·권한 편집 폼이 설 때만 로드(다른 면 진입 비용 0). 폼과 같은 값에서 뽑는다.
  // 메뉴 권한뿐 아니라 기능 권한(담당자 · 과목 범위)의 사람도 함께 푼다 — 퇴직해 선택지에서 빠진 사람도 이름으로 보여야 거둘 수 있다.
  const permissionPeople = permissionsSource ? permissionAccountIds(permissionsSource) : [];
  // 상담 준비 브리프(AI)가 이 지점에서 도는가 — 꺼진 지점엔 상담 양식 면의 운영 안내 카드를 세우지 않는다(브리프 카드와 같은 라이선스).
  const briefOn = tab === "consultations" ? await isFeatureLicensed(viewer.tenantId, "ai_analysis") : false;
  const hiddenSettingKeys: SettingsRoleKey[] = [];
  // 지점 AI가 꺼져 있으면 AI 멘트 칸과 학원 비서 줄을 세우지 않는다(꺼진 기능은 있었는지조차 모르게 — 판정은 perm-matrix capSettingFeatures와 같은 라이선스).
  const hiddenMenuKeys: MenuKey[] = [];
  if (showsPermissions) hiddenMenuKeys.push(...await tenantClosedMenus());
  if (showsPermissions && !(await isFeatureLicensed(viewer.tenantId, "ai_analysis"))) {
    hiddenSettingKeys.push("ai_ment");
    hiddenMenuKeys.push("assistant");
  }
  if (settings.modules.disabled.includes("payroll")) hiddenSettingKeys.push("attendance_salary_settings", "payroll_settings");
  const [userOverrideNamesRaw, permissionStaff, hiddenPermissionIds, connectedApps, retiredPermissionPeople] = await Promise.all([
    permissionPeople.length > 0 ? getUserDisplayNames(permissionPeople) : {},
    // 개인별 메뉴 권한을 주고 거두는 구획의 직원 선택지 — 어느 학원에서나 선다(원장 2026-10-06).
    permissionsSource ? getPermissionStaffOptions() : [],
    permissionsSource ? platformAccountIds(permissionPeople).then((ids) => [...ids]) : [],
    // 역할별 표 아래 '연결 앱 권한'(원장 2026-11-05) — 이 지점에서 켠 앱만(꺼진 앱은 표에도 없다).
    permissionsSource
      ? getTenantConnectedApps(viewer.tenantId).then((apps) => {
          const { labelOf } = buildSubjectMaps(settings.operations.subjects);
          return apps.map((a) => ({ permission: a.permission, label: a.label, note: connectedAppNote(a, labelOf) }));
        })
      : [],
    // 퇴사자(원장 2026-11-09 *"퇴사시 같이 사라지게"*) — **주는 값**(개인별 기능 권한 칩 · 역할보다 더 주는 개인 메뉴 줄)은 초기값에서 빼고
    // (이 면을 저장하면 저장값에서도 빠진다), 남는 좁히는 값(역할보다 낮은 개인 줄 · 과목 범위)엔 이름 뒤 '(퇴사)'를 붙인다(retired-people.ts 원칙).
    // 캐시 없이 지금 값으로(편집 폼 규칙). 퇴사가 확인된 사람만(계정이 없는 사람은 모른다 — 리뷰 r1 F3). 조회 실패면 거르지 않는다(종전 화면 그대로).
    permissionPeople.length > 0
      ? retiredPeople(permissionPeople).catch((e): RetiredPeople => {
          console.error("[owner/page] 퇴사자 조회 실패 — 거르지 않는다", e);
          return new Map();
        })
      : (new Map() as RetiredPeople),
  ]);
  const userOverrideNames: Record<string, string> = Object.fromEntries(
    Object.entries(userOverrideNamesRaw as Record<string, string>).map(([id, name]) => [id, retiredPermissionPeople.has(id) ? `${name}(퇴사)` : name]),
  );
  // 기준 token은 **저장된 값 그대로**(아래 permissionsToken(permissionsSource))로 만든다 — 화면은 거른 값을 들고, 저장하면 거른 값이 저장된다.
  const permissionsInitial = permissionsSource ? withoutRetiredPeople({ permissions: permissionsSource }, retiredPermissionPeople).permissions : undefined;
  // 탭 및 메뉴 구성 — 편집기가 세우지 않을 메뉴(지점에서 닫힌 메뉴 · 강사 권한) 판정. 그 면을 열 때만 조회한다.
  const navigationGates = tab === "navigation" ? await navigationEditorGates(settings) : null;
  // 세션 기간(과목 운영 안)의 연도. 기본은 KST 올해(세션은 연 단위로 편집한다).
  const thisYear = Number(kstToday().slice(0, 4));
  const yearParam = Number(sp.year);
  const sessionYear = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : thisYear;
  // 세션 기간은 과목 운영 면에서만 로드(다른 면 진입 비용 0). 표가 아직 없으면 빈 배열로 떨어진다.
  const periodDefs = tab === "subjects" ? await getPeriodDefsForEditor(sessionYear) : [];
  // 관리 면(중복·감사) 페이지네이션용. 창(embed) 컨텍스트는 면 pageHref가 직접 유지.
  const page = Math.max(1, Number(sp.page) || 1);
  const isEmbed = sp.embed === "1";

  return (
    <div data-maximize-toolbar-page="" className="w-full min-w-0 space-y-6">
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행으로 접힌다(제목은 창 타이틀바).
          '최근 저장' 메타는 actions 슬롯(우측) — 컴팩트 행에서도 유지된다. */}
      <div data-maximize-title-row="">
      <PageHeader
        eyebrow="학원 설정"
        title={`${settings.profile.name || "학원"} 설정`}
        description="학원에 관한 모든 설정과 관리 도구입니다. 여기서 바꾼 내용은 학원 전체에 적용됩니다. 원장과, 역할·권한에서 맡긴 계정만 바꿀 수 있고 역할·권한 면은 원장만 바꿉니다."
        // 창 컴팩트 행은 1행이 규칙 — 위 안내문(~110자)은 창 폭에서 2~3줄로 감겨 짧은 라벨로 대체(적대 리뷰).
        // ⚠️ 상단 바 브랜드는 `logoText`라 `profile.name`과 다를 수 있다 → 컴팩트 행에 학원명을 남긴다.
        embedLabel={`${settings.profile.name || "학원"} 설정 — 변경은 원장·위임 계정만`}
        actions={<p className="text-text-faint text-xs">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>}
      />

      </div>
      <PageMaximizeToolbar>
        {/* 면이 많으면 범주 줄 + 그 범주의 면 줄, 적으면 종전처럼 한 줄(`ownerTabRows`). 주소는 면마다 `?tab=` 그대로다. */}
        <OwnerTabBar faces={facesFor(canReadAudit, isGenericTenant(settings), showMakeups, showEvaluation, showContribution).filter((face) => allowedTabs.get(face.key))} active={tab} />
      </PageMaximizeToolbar>

      {/* 섹션 폼 면(FACE_WRITES_OWN_NOTE)은 폼이 같은 안내를 직접 적는다(읽기 전용 폼) — 두 번 적지 않는다. */}
      {/* 자체 판정을 하는 면(SELF_GATED_TABS)은 설정 '읽기 전용' 안내도, 아래 fieldset 잠금도 받지 않는다. */}
      {/* 🔴 읽기 권한이면 각 면이 저장·추가·삭제 단추를 **그리지 않는다**(원장 2026-11-05) — 판정은 위 canEditSettings 하나다
          (저장 액션 saveOwnerSection과 같은 함수·같은 키). fieldset은 남은 입력칸을 잠그는 바닥이다. */}
      {!canEditSettings && !FACE_WRITES_OWN_NOTE.has(tab) && !SELF_GATED_TABS.has(tab) ? <p className="text-text-faint text-xs">{writeLockedNote(menu)}</p> : null}
      <fieldset disabled={!canEditSettings} className="min-w-0 space-y-4 border-0 p-0">
      {tab === "profile" ? <ProfileSection initial={settings.profile} readOnly={!canEditSettings} /> : null}
      {settingsUnreadable ? (
        <div className="bg-card border-line rounded-2xl border p-6">
          <p className="text-foreground text-sm font-bold">설정을 불러오지 못했습니다</p>
          <p className="text-text-dim mt-1 text-sm">저장된 값을 확인하지 못해 편집 화면을 열지 않았습니다. 잠시 뒤 새로고침해 주세요.</p>
        </div>
      ) : null}
      {tab === "operations" && !settingsUnreadable ? (
        <OperationsSection
          initial={operationsForClient}
          classrooms={classrooms}
          canImportClassrooms={canImportClassrooms}
          readOnly={!canEditOperations}
          seatPinStatus={seatPinStatus(operationsSource)}
          baselineToken={operationsTokens?.operations}
          baselineVersion={editable?.versions.operations}
        />
      ) : null}
      {/* 보강 운영 = 운영 설정과 다른 묶음(저장 경로 · 권한이 따로)이라 제 면에 둔다 — 운영 체계 면 아래에 저장 버튼이
          하나 더 서 있던 것을 옮겼다(원장 2026-10-06). 원장 위만 바꾼다(저장 액션 `configureMakeupSettings`와 같은 선). */}
      {tab === "makeups" ? (
        canReadAudit ? (
          <MakeupsSection initial={settings.makeups} readOnly={!canEditSettings} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">보강 운영은 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              보강관리를 켜고 끄는 일은 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {tab === "subjects" && !settingsUnreadable ? (
        <SubjectsSection
          initial={operationsForClient}
          readOnly={!canEditOperations}
          teacherLabels={teacherLabelsBySubject}
          periodDefs={periodDefs}
          sessionYear={sessionYear}
          holidays={operationsSource.holidays.map((h) => h.date)}
          baselineToken={operationsTokens?.subjects}
          baselineVersion={editable?.versions.operations}
        />
      ) : null}
      {tab === "billing" ? (
        <BillingSection initial={settings.billing} showEie={isModuleEnabled(settings.modules.disabled, "eie")} readOnly={!canEditSettings} />
      ) : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} readOnly={!canEditSettings} /> : null}
      {tab === "consultations" ? <ConsultationsSection initial={settings.consultations} readOnly={!canEditSettings} briefOn={briefOn} /> : null}
      {tab === "permissions" ? (
        isMaster ? (
          // 못 읽었으면(permissionsSource 없음) 위의 '불러오지 못했습니다' 안내만 선다.
          permissionsSource ? (
            <PermissionsSection
              initial={permissionsInitial ?? permissionsSource}
              // 표의 줄 · 강사 내 메뉴 칸은 학원의 메뉴 구성(왼쪽 탭과 그 내부 메뉴) 차례로 선다.
              navigation={settings.navigation}
              userOverrideNames={userOverrideNames}
              staffOptions={permissionStaff}
              hiddenUserIds={hiddenPermissionIds}
              generic={isGenericTenant(settings)}
              hiddenSettingKeys={hiddenSettingKeys}
              hiddenMenuKeys={hiddenMenuKeys}
              connectedApps={connectedApps}
              baselineToken={permissionsToken(permissionsSource)}
              baselineVersion={editable?.versions.permissions}
              marketingArchive={viewer.tenantId === ARCHIVE_TENANT}
            />
          ) : null
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">역할·권한은 원장만 변경할 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              위임받은 계정으로도 이 면(역할·권한)은 편집할 수 없어요 — 권한 자체를 바꾸는 일은 원장 계정 전용입니다.
              나머지 설정 면(프로필·운영 체계·과목·수납·알림)은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {/* 탭 및 메뉴 구성(관리자뷰·강사뷰) — 보기 설정이라 **권한(master 전용)과 달리 위임 계정도 편집**한다(saveOwnerSection이 owner 쓰기로 게이트).
          권한을 대체하지 않기 때문에 여기서 켜도 못 보던 화면이 열리지 않는다. */}
      {tab === "navigation" ? (
        <NavigationSection
          initial={settings.navigation}
          // 강사뷰 편집기에 세울 메뉴의 근거 = 이 학원의 **강사 역할** 권한(override + 지점에서 닫힌 메뉴) — 판정은 navigation-editor-gates.ts.
          teacherOpen={navigationGates?.teacherOpen ?? []}
          // 개인별 메뉴 권한으로 강사 계정에게 연 메뉴는 강사뷰 편집기에 남긴다 · 지점에서 아무도 못 여는 메뉴는 편집기에 세우지 않는다(원장 2026-10-14 "없는 메뉴").
          teacherPersonal={navigationGates?.teacherPersonal}
          closedMenus={navigationGates?.closed}
          readOnly={!canEditSettings}
        />
      ) : null}
      {/* '기능' 면 = 원장·총괄만 편집(saveOwnerSection·0281a 트리거와 같은 선) — 위임 계정엔 저장이 실패할 폼 대신 안내.
          판정은 감사로그 면과 같은 식(원장 또는 총괄)이라 canReadAudit을 그대로 쓴다. */}
      {tab === "modules" ? (
        canReadAudit ? (
          <ModulesSection initial={settings.modules} readOnly={!canEditSettings} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">기능 켜기·끄기는 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              어떤 기능을 쓸지는 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {/* 대시보드 관리 = 원장·총괄만(saveOwnerSection이 같은 선을 서버에서 긋는다 — [[#77]]). 위임 계정엔 실데이터 미리보기 원본
          (원장 시점 전체 스냅샷)을 **읽지도 않는다** — 면을 감추는 게 아니라 조회 자체를 안 한다. */}
      {tab === "dashboard" ? (
        canReadAudit ? (
          <DashboardFace settings={settings} readOnly={!canEditSettings} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">대시보드 관리는 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              역할마다 운영실에 무엇을 보일지는 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {tab === "popups" ? <PopupsFace canWrite={canEditSettings} /> : null}
      {/* 연동 = 켜진 연동만 내부 탭(슬랙 · makeedu · 구글 시트) — 원장 2026-09-28 "세로 스크롤이 너무 길어짐". */}
      {tab === "sheets" ? (
        <IntegrationsFace
          sub={sp.sub}
          settings={settings}
          modulesOn={{
            makeedu: isModuleEnabled(settings.modules.disabled, "makeedu"),
            // 구글 시트 = 기능(모듈) ∧ 지점 라이선스 — 라이선스가 꺼진 지점엔 탭이 없다(2026-09-30).
            sheets: isModuleEnabled(settings.modules.disabled, "sheet_sync") && (await isFeatureLicensed(viewer.tenantId, "google_sheets")),
          }}
          page={page}
          isEmbed={isEmbed}
          canEdit={canEditSettings}
        />
      ) : null}
      </fieldset>
      {/* 🔴 자체 판정을 하는 면은 위 fieldset **밖**에 둔다(SELF_GATED_TABS) — 그 fieldset은 학원 설정 쓰기 권한으로 잠기는데,
          이 면들의 버튼·입력은 다른 판정을 따른다. 안에 두면 권한이 있어도 잠긴다.
          · 데이터 정리: 버튼은 '관리자 도구' 권한(canManageData)으로 면이 직접 가린다.
          · 데이터 가져오기: 줄마다 그 메뉴의 전체 권한으로 버튼이 선다(올리기 주소도 같은 판정).
          · 감사로그: 고치는 것이 없다 — 조회 조건(기간·검색) 입력이 설정 읽기 전용 때문에 잠기면 안 된다.
          · 강사평가: 원장 게이트(직원 포트폴리오와 같은 문)를 지난 사람만 온다(위 redirect). 잠금은 면이 저장 액션과 같은 쓰기 판정으로 직접 한다. */}
      {tab === "evaluation" && showEvaluation ? <EvaluationFace /> : null}
      {tab === "contribution" && showContribution ? <ContributionSettingsFace /> : null}
      {tab === "data" ? (
        <div className="space-y-10">
          <DataFace canManage={canManageData} />
          <DuplicatesFace page={page} isEmbed={isEmbed} canManage={canManageData} />
          <SameNameFace />
        </div>
      ) : null}
      {tab === "import" ? <ImportHubFace /> : null}
      {/* 🔴 주소를 직접 쳐도 열리지 않는다 — 면을 감추기만 하면 그건 게이트가 아니다([[#77]]).
          권한이 없으면 조회 자체를 안 한다(빈 표를 보여 주고 "기록 없음"이라 적으면 거짓말이 된다). */}
      {tab === "audit" ? (
        canReadAudit ? (
          <AuditFace action={sp.action} q={sp.q} from={sp.from} to={sp.to} page={page} isEmbed={isEmbed} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">감사로그는 원장만 볼 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              누가 무엇을 바꿨는지에는 급여·지출·환불처럼 민감한 기록이 함께 담겨 있어, 학원 설정을 위임받은
              계정으로도 열 수 없습니다. 나머지 관리 면(팝업 공지·데이터 정리·연동)은 그대로 쓸 수 있어요.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
