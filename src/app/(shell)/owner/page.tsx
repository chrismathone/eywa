import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { kstToday } from "@/lib/date-kst";
import { OWNER_TABS, resolveOwnerTab, type OwnerTab } from "@/features/owner/tabs";
import { getTenantSettings, getSettingsMeta, getUserDisplayNames } from "@/features/owner/server/queries";
import { getClassroomsWithUsage } from "@/features/owner/server/classroom-queries";
import { getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { getPeriodDefsForEditor } from "@/features/periods/server/queries";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { ProfileSection } from "./_components/profile-section";
import { OperationsSection } from "./_components/operations-section";
import { SubjectsSection } from "./_components/subjects-section";
import { BillingSection } from "./_components/billing-section";
import { NotificationsSection } from "./_components/notifications-section";
import { ConsultationsSection } from "./_components/consultations-section";
import { PermissionsSection } from "./_components/permissions-section";
import { NavigationSection } from "./_components/navigation-section";
import { ModulesSection } from "./_components/modules-section";
import { isGenericTenant } from "@/features/owner/preset";
import { capDisabledModules, isModuleEnabled } from "@/lib/modules";
import { resolveMatrix } from "@/lib/permissions";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { DataFace } from "./_components/data-face";
import { DuplicatesFace } from "./_components/duplicates-face";
import { SameNameFace } from "./_components/same-name-face";
import { AuditFace } from "./_components/audit-face";
import { SheetsFace } from "./_components/sheets-face";
import { PopupsFace } from "./_components/popups-face";

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
  const faces: Face[] = OWNER_TABS.filter((t) => t.key !== "audit" || canReadAudit).map((t) => ({
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
  return { title: `학원 설정 · ${tab === "modules" ? MODULES_TAB_LABEL : TAB_LABEL[tab]} — aywa` };
}

export default async function OwnerSettingsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const viewer = await requireAccess("owner");
  // 역할·권한(permissions) 편집은 항상 master 전용(self-escalation 차단 — saveOwnerSection·0080a 트리거와 동일).
  // 위임받은 admin/manager는 다른 설정 면은 편집 가능하되 이 면만 안내로 대체(저장이 실패할 폼을 보여주지 않음).
  const isMaster = viewer.systemRole === "master";
  // 감사로그는 원장 위(총괄 포함)만 — 결정 로그 *"super_admin은 새로 만드는 어떤 제한 명단·게이트도
  // 자동 통과한다"*(원장 2026-08-13). 🔴 `systemRole === "master"`만 보면 총괄이 자기 시스템에서 잠긴다
  // (실측: 총괄 2명 중 1명의 users.system_role은 'admin'이다).
  const canReadAudit = isMaster || (await isCurrentUserSuperAdmin());
  const sp = await searchParams;
  // 옛 "보고서 관리" 면(?tab=report_mgmt)은 좌측 독립 메뉴 /lesson-reports로 승격 — 기존 북마크 리다이렉트.
  if (sp.tab === "report_mgmt") redirect("/lesson-reports");
  // 보고서 표시·AI 멘트 설정 면은 수업보고서 탭으로 이관(2026-07-10) — 옛 ?tab=report·ai_ment 북마크 리다이렉트.
  if (sp.tab === "report") redirect("/lesson-reports?tab=report");
  if (sp.tab === "ai_ment") redirect("/lesson-reports?tab=ai_ment");
  // 세션 기간 면은 과목 운영 안으로 들어갔다(2026-08-07 원장 지시) — 옛 북마크가 프로필로 떨어지지 않게.
  if (sp.tab === "sessions") redirect("/owner?tab=subjects");
  const [settings, meta] = await Promise.all([getTenantSettings(), getSettingsMeta()]);
  const tab = effectiveTab(sp, settings);
  // 강의실(관계형 테이블)은 운영 체계 면에서만 로드 — 다른 면 진입 비용 0.
  const classrooms = tab === "operations" ? await getClassroomsWithUsage() : [];
  // 과목별 강사 라벨(과목 운영 '가로줄 제외 강사' 칩)은 해당 면에서만 로드.
  const teacherLabelsBySubject = tab === "subjects" ? await getTeacherLabelsBySubject() : {};
  // 개인 예외(userOverrides) 이름 매핑 — 역할·권한 면에서만 로드(다른 면 진입 비용 0).
  const userOverrideNames =
    tab === "permissions" && settings.permissions.userOverrides.length > 0
      ? await getUserDisplayNames(settings.permissions.userOverrides.map((o) => o.userId))
      : {};
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
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행으로 접힌다(제목은 창 타이틀바).
          '최근 저장' 메타는 actions 슬롯(우측) — 컴팩트 행에서도 유지된다. */}
      <PageHeader
        eyebrow="학원 설정"
        title={`${settings.profile.name || "학원"} 설정`}
        description="학원에 관한 모든 설정과 관리 도구를 여기서 관리하면 해당 학원(테넌트) 전체에 적용됩니다. 원장(master)과 역할·권한에서 위임받은 계정만 변경할 수 있고, 역할·권한 면은 원장 전용입니다."
        // 창 컴팩트 행은 1행이 규칙 — 위 안내문(~110자)은 창 폭에서 2~3줄로 감겨 짧은 라벨로 대체(적대 리뷰).
        // ⚠️ 상단 바 브랜드는 `logoText`라 `profile.name`과 다를 수 있다 → 컴팩트 행에 학원명을 남긴다.
        embedLabel={`${settings.profile.name || "학원"} 설정 — 변경은 원장·위임 계정만`}
        actions={<p className="text-text-faint text-xs">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>}
      />

      <FaceTabs faces={facesFor(canReadAudit, isGenericTenant(settings))} active={tab} ariaLabel="학원 설정·관리 면 전환" />

      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {tab === "operations" ? (
        <OperationsSection initial={settings.operations} classrooms={classrooms} />
      ) : null}
      {tab === "subjects" ? (
        <SubjectsSection
          initial={settings.operations}
          teacherLabels={teacherLabelsBySubject}
          periodDefs={periodDefs}
          sessionYear={sessionYear}
          holidays={settings.operations.holidays.map((h) => h.date)}
        />
      ) : null}
      {tab === "billing" ? (
        <BillingSection initial={settings.billing} showEie={isModuleEnabled(settings.modules.disabled, "eie")} />
      ) : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      {tab === "consultations" ? <ConsultationsSection initial={settings.consultations} /> : null}
      {tab === "permissions" ? (
        isMaster ? (
          <PermissionsSection initial={settings.permissions} userOverrideNames={userOverrideNames} />
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
      {tab === "popups" ? <PopupsFace /> : null}
      {tab === "data" ? (
        <div className="space-y-10">
          <DataFace />
          <DuplicatesFace page={page} isEmbed={isEmbed} />
          <SameNameFace />
        </div>
      ) : null}
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
      {tab === "sheets" ? (
        <SheetsFace
          subjects={settings.operations.subjects}
          page={page}
          isEmbed={isEmbed}
          makeeduOn={isModuleEnabled(settings.modules.disabled, "makeedu")}
          sheetsOn={isModuleEnabled(settings.modules.disabled, "sheet_sync")}
        />
      ) : null}
    </div>
  );
}
