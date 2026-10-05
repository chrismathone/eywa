import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { permissionAccountIds, platformAccountIds } from "@/features/owner/server/platform-settings";
import { canAccessTenant, canWriteTenant, canManageTenant } from "@/lib/auth/perm-matrix";
import { OWNER_SECTION_MENU, OWNER_TAB_MENU } from "@/lib/settings-role-catalog";
import { operationsForViewer, seatPinStatus } from "@/features/owner/seat-pin-view";
import { SettingRolesControl } from "@/features/owner/components/setting-roles-control";
import { kstToday } from "@/lib/date-kst";
import { OWNER_TABS, resolveOwnerTab, type OwnerTab } from "@/features/owner/tabs";
import { getTenantSettings, getSettingsMeta, getUserDisplayNames, getPermissionStaffOptions, getTenantSettingsForEdit } from "@/features/owner/server/queries";
import { operationsFaceTokens } from "@/features/owner/server/operations-save";
import { permissionsToken } from "@/features/owner/server/permissions-save";
import { getClassroomsWithUsage } from "@/features/owner/server/classroom-queries";
import { getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { getPeriodDefsForEditor } from "@/features/periods/server/queries";
import { FaceTabs, type Face } from "@/components/face-tabs";
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
import { capDisabledModules, isModuleEnabled } from "@/lib/modules";
import { resolveMatrix } from "@/lib/permissions";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { DataFace } from "./_components/data-face";
import { DuplicatesFace } from "./_components/duplicates-face";
import { SameNameFace } from "./_components/same-name-face";
import { AuditFace } from "./_components/audit-face";
import { IntegrationsFace } from "./_components/integrations-face";
import { isFeatureLicensed } from "@/lib/license/server";
import { PopupsFace } from "./_components/popups-face";
import { ImportHubFace } from "./_components/import-hub-face";
import { DashboardFace } from "./_components/dashboard/dashboard-face";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | undefined>;
// 면 목록은 **단일 소스**(src/features/owner/tabs.ts) — 상단 FaceTabs와 왼쪽 사이드바 하부탭이
// 같은 배열에서 파생된다. 여기에 목록을 다시 적지 말 것(원장 2026-08-07: 한쪽만 고쳐 사이드바가 stale).
const TAB_LABEL = Object.fromEntries(OWNER_TABS.map((t) => [t.key, t.label])) as Record<OwnerTab, string>;
/**
 * 🔴 감사로그 면은 **원장(master)·총괄(super_admin) 전용**(원장 2026-09-09 *"감사로그는 마스터 이상급으러만"*).
 *    같은 날 DB 정책도 그렇게 좁혔다(0253a·0253b) — 그래서 위임받은 admin·manager에게 이 면을 세워 두면
 *    **에러 없이 늘 빈 목록**이 뜬다(조용한 거짓말). 자물쇠는 RLS고([[#77]]) 여기서 감추는 건 그 사실을
 *    화면에 반영하는 것이다. ⚠️ 이 학원은 `owner` 메뉴를 admin·manager에게 위임해 뒀다(실측 활성 11명).
 */
function facesFor(canReadAudit: boolean, showModules: boolean): Face[] {
  // 감사로그·대시보드 관리 = 원장·총괄만(위임 계정엔 면 자체를 세우지 않는다 — 주소로 와도 안내 문구, 아래 본문).
  const faces: Face[] = OWNER_TABS.filter((t) => (t.key !== "audit" && t.key !== "dashboard") || canReadAudit).map((t) => ({
    key: t.key,
    label: t.label,
    href: t.href,
    group: t.group,
  }));
  // '기능'(모듈 켜기·끄기) 면은 **새 학원(일반판)에만** 선다 — 침산 설정 화면은 이 작업 전과 같아야 한다(원장 2026-09-22).
  // OWNER_TABS(사이드바·메뉴 판이 파생하는 단일 소스)에 넣지 않은 이유도 같다 — 넣으면 침산 메뉴 판에 버튼이 생긴다.
  if (showModules) {
    const at = faces.findIndex((f) => f.key === "navigation");
    faces.splice(at + 1, 0, { key: "modules", label: MODULES_TAB_LABEL, href: "/owner?tab=modules", group: "설정" });
  }
  return faces;
}

const MODULES_TAB_LABEL = "기능";

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
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  // '기능' 면 판정에만 설정이 필요하다 — 그 외엔 종전처럼 조회 없이(요청 캐시라 본문과 같은 조회를 나눠 쓴다).
  const tab = sp.tab === "modules" ? effectiveTab(sp, await getTenantSettings()) : resolveTab(sp);
  return { title: `학원 설정 · ${tab === "modules" ? MODULES_TAB_LABEL : TAB_LABEL[tab]} — 에이와` };
}

export default async function OwnerSettingsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  // 옛 설정 탭은 권한 검사에 앞서 현재 주소로 보낸다. 도착 화면이 해당 설정 권한을 검사한다.
  if (sp.tab === "report_mgmt") redirect("/lesson-reports");
  if (sp.tab === "report") redirect("/lesson-reports?tab=report");
  if (sp.tab === "ai_ment") redirect("/lesson-reports?tab=ai_ment");
  if (sp.tab === "sessions") redirect("/owner?tab=subjects");
  const requested = resolveTab(sp);
  const menu = requested in OWNER_TAB_MENU ? OWNER_TAB_MENU[requested as keyof typeof OWNER_TAB_MENU] : "owner";
  const viewer = await requireAccess(menu);
  const canEditSettings = await canWriteTenant(viewer.systemRole, menu);
  const allowedEntries = await Promise.all(OWNER_TABS.map(async face => [face.key,
    await canAccessTenant(viewer.systemRole, face.key in OWNER_TAB_MENU ? OWNER_TAB_MENU[face.key as keyof typeof OWNER_TAB_MENU] : "owner"),
  ] as const));
  const allowedTabs = new Map(allowedEntries);
  // 역할·권한(permissions) 편집은 항상 master 전용(self-escalation 차단 — saveOwnerSection·0080a 트리거와 동일).
  // 위임받은 admin/manager는 다른 설정 면은 편집 가능하되 이 면만 안내로 대체(저장이 실패할 폼을 보여주지 않음).
  const isMaster = viewer.systemRole === "master";
  // 감사로그는 원장 위(총괄 포함)만 — 결정 로그 *"super_admin은 새로 만드는 어떤 제한 명단·게이트도
  // 자동 통과한다"*(원장 2026-08-13). 🔴 `systemRole === "master"`만 보면 총괄이 자기 시스템에서 잠긴다
  // (실측: 총괄 2명 중 1명의 users.system_role은 'admin'이다).
  const canReadAudit = isMaster || (await isCurrentUserSuperAdmin());
  const [settings, meta] = await Promise.all([getTenantSettings(), getSettingsMeta()]);
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
  // 강의실(관계형 테이블)은 운영 체계 면에서만 로드 — 다른 면 진입 비용 0.
  const classrooms = tab === "operations" ? await getClassroomsWithUsage() : [];
  // 강의실 엑셀로 넣기 — 운영 설정의 full만(올리기 주소 `gateImport`와 같은 판정).
  const canImportClassrooms = tab === "operations" ? await canManageTenant(viewer.systemRole, "operations_settings") : false;
  // 과목별 강사 라벨(과목 운영 '가로줄 제외 강사' 칩)은 해당 면에서만 로드.
  const teacherLabelsBySubject = tab === "subjects" ? await getTeacherLabelsBySubject() : {};
  // 개인 예외(userOverrides) 이름 매핑 — 역할·권한 편집 폼이 설 때만 로드(다른 면 진입 비용 0). 폼과 같은 값에서 뽑는다.
  const [userOverrideNames, permissionStaff, hiddenPermissionIds] = await Promise.all([
    permissionsSource && permissionsSource.userOverrides.length > 0
      ? getUserDisplayNames(permissionsSource.userOverrides.map((o) => o.userId))
      : {},
    permissionsSource && isGenericTenant(settings) ? getPermissionStaffOptions() : [],
    permissionsSource ? platformAccountIds(permissionAccountIds(permissionsSource)).then((ids) => [...ids]) : [],
  ]);
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
        description="학원에 관한 모든 설정과 관리 도구를 여기서 관리하면 해당 학원(테넌트) 전체에 적용됩니다. 원장(master)과 역할·권한에서 위임받은 계정만 변경할 수 있고, 역할·권한 면은 원장 전용입니다."
        // 창 컴팩트 행은 1행이 규칙 — 위 안내문(~110자)은 창 폭에서 2~3줄로 감겨 짧은 라벨로 대체(적대 리뷰).
        // ⚠️ 상단 바 브랜드는 `logoText`라 `profile.name`과 다를 수 있다 → 컴팩트 행에 학원명을 남긴다.
        embedLabel={`${settings.profile.name || "학원"} 설정 — 변경은 원장·위임 계정만`}
        // 역할·권한 면에는 '역할 설정' 버튼을 세우지 않는다 — 그 면의 표가 같은 칸을 고친다. 한 화면에 같은 값을 고치는 곳이
        // 둘이면 대화상자로 바꾼 직급을 아래 표의 저장이 되돌리려 든다(지금은 거절되지만, 왜 거절됐는지 알기 어렵다).
        actions={<>{tab === "permissions" ? null : <SettingRolesControl group={tab === "sheets" ? "integrations" : "owner"} />}<p className="text-text-faint text-xs">최근 저장: {fmt(meta?.updatedAt ?? null)}</p></>}
      />

      </div>
      <PageMaximizeToolbar>
        <FaceTabs faces={facesFor(canReadAudit, isGenericTenant(settings)).filter(face => face.key === "modules" ? canReadAudit : allowedTabs.get(face.key as OwnerTab))} active={tab} ariaLabel="학원 설정·관리 면 전환" />
      </PageMaximizeToolbar>

      {/* 운영 체계·과목 운영 면은 섹션 폼이 같은 안내를 직접 적는다(읽기 전용 폼) — 두 번 적지 않는다. */}
      {!canEditSettings && !showsOperations ? <p className="text-text-faint text-xs">읽기 전용입니다.</p> : null}
      <fieldset disabled={!canEditSettings} className="min-w-0 space-y-4 border-0 p-0">
      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {settingsUnreadable ? (
        <div className="bg-card border-line rounded-2xl border p-6">
          <p className="text-foreground text-sm font-bold">설정을 불러오지 못했습니다</p>
          <p className="text-text-dim mt-1 text-sm">저장된 값을 확인하지 못해 편집 화면을 열지 않았습니다. 잠시 뒤 새로고침해 주세요.</p>
        </div>
      ) : null}
      {tab === "operations" && !settingsUnreadable ? (
        <>
        <OperationsSection
          initial={operationsForClient}
          classrooms={classrooms}
          canImportClassrooms={canImportClassrooms}
          readOnly={!canEditOperations}
          seatPinStatus={seatPinStatus(operationsSource)}
          baselineToken={operationsTokens?.operations}
          baselineVersion={editable?.versions.operations}
        />
        {canReadAudit ? <MakeupsSection initial={settings.makeups} /> : null}
        </>
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
        <BillingSection initial={settings.billing} showEie={isModuleEnabled(settings.modules.disabled, "eie")} />
      ) : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      {tab === "consultations" ? <ConsultationsSection initial={settings.consultations} /> : null}
      {tab === "permissions" ? (
        isMaster ? (
          // 못 읽었으면(permissionsSource 없음) 위의 '불러오지 못했습니다' 안내만 선다.
          permissionsSource ? (
            <PermissionsSection
              initial={permissionsSource}
              userOverrideNames={userOverrideNames}
              staffOptions={permissionStaff}
              hiddenUserIds={hiddenPermissionIds}
              generic={isGenericTenant(settings)}
              baselineToken={permissionsToken(permissionsSource)}
              baselineVersion={editable?.versions.permissions}
            />
          ) : null
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">역할·권한은 원장(master)만 변경할 수 있습니다</p>
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
          // 강사뷰 안내 줄("강사 권한이 꺼져 있어 안 보입니다")의 근거 = 이 학원의 **강사 역할** 권한(override + 꺼진 모듈).
          // 보는 사람의 매트릭스(getUserPermMatrix)를 쓰지 않는 이유 — 총괄은 잠금을 무시한 병합이라 실제 강사 화면과 달라진다.
          teacherOpen={teacherMenuKeysFor(
            "teacher",
            capDisabledModules(resolveMatrix(settings.permissions.overrides), settings.modules.disabled),
          )}
        />
      ) : null}
      {/* '기능' 면 = 원장·총괄만 편집(saveOwnerSection·0281a 트리거와 같은 선) — 위임 계정엔 저장이 실패할 폼 대신 안내.
          판정은 감사로그 면과 같은 식(원장 또는 총괄)이라 canReadAudit을 그대로 쓴다. */}
      {tab === "modules" ? (
        canReadAudit ? (
          <ModulesSection initial={settings.modules} />
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
          <DashboardFace settings={settings} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">대시보드 관리는 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              역할마다 운영실에 무엇을 보일지는 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {tab === "popups" ? <PopupsFace /> : null}
      {tab === "data" ? (
        <div className="space-y-10">
          <DataFace />
          <DuplicatesFace page={page} isEmbed={isEmbed} />
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
        />
      ) : null}
      </fieldset>
    </div>
  );
}
