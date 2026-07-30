import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings, getSettingsMeta } from "@/features/owner/server/queries";
import { getClassroomsWithUsage } from "@/features/owner/server/classroom-queries";
import { getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { ProfileSection } from "./_components/profile-section";
import { OperationsSection } from "./_components/operations-section";
import { SubjectsSection } from "./_components/subjects-section";
import { BillingSection } from "./_components/billing-section";
import { NotificationsSection } from "./_components/notifications-section";
import { ConsultationsSection } from "./_components/consultations-section";
import { PermissionsSection } from "./_components/permissions-section";
import { DataFace } from "./_components/data-face";
import { DuplicatesFace } from "./_components/duplicates-face";
import { AuditFace } from "./_components/audit-face";
import { SheetsFace } from "./_components/sheets-face";
import { PopupsFace } from "./_components/popups-face";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | undefined>;
type OwnerTab =
  | "profile"
  | "operations"
  | "subjects"
  | "billing"
  | "notifications"
  | "consultations"
  | "permissions"
  | "popups"
  | "data"
  | "audit"
  | "sheets";

const TAB_LABEL: Record<OwnerTab, string> = {
  profile: "프로필·브랜드",
  operations: "운영 체계",
  subjects: "과목 운영",
  billing: "수납·청구",
  notifications: "알림·약관",
  consultations: "상담 양식",
  permissions: "역할·권한",
  popups: "팝업 공지",
  data: "데이터 정리",
  audit: "감사로그",
  sheets: "연동",
};

const VALID_TABS: OwnerTab[] = [
  "profile",
  "operations",
  "subjects",
  "billing",
  "notifications",
  "consultations",
  "permissions",
  "popups",
  "data",
  "audit",
  "sheets",
];

function resolveTab(sp: Sp): OwnerTab {
  // 중복 학생(dup)은 데이터 정리(data) 면으로 통합 — 옛 ?tab=dup 북마크는 data로 흡수.
  const t = sp.tab === "dup" ? "data" : sp.tab;
  return t && (VALID_TABS as string[]).includes(t) ? (t as OwnerTab) : "profile";
}

// 설정면 ┃ 관리면(데이터 정리[고아+중복 통합]·감사·연동, 구 /admin 흡수) — group 경계에 FaceTabs 세로 구분선.
// 보고서 표시·AI 멘트 설정은 수업보고서(/lesson-reports) 탭으로 이관 — 발송 관리와 한 화면에서 관리(2026-07-10).
const FACES: Face[] = [
  { key: "profile", label: TAB_LABEL.profile, href: "/owner", group: "설정" },
  { key: "operations", label: TAB_LABEL.operations, href: "/owner?tab=operations", group: "설정" },
  { key: "subjects", label: TAB_LABEL.subjects, href: "/owner?tab=subjects", group: "설정" },
  { key: "billing", label: TAB_LABEL.billing, href: "/owner?tab=billing", group: "설정" },
  { key: "notifications", label: TAB_LABEL.notifications, href: "/owner?tab=notifications", group: "설정" },
  { key: "consultations", label: TAB_LABEL.consultations, href: "/owner?tab=consultations", group: "설정" },
  { key: "permissions", label: TAB_LABEL.permissions, href: "/owner?tab=permissions", group: "설정" },
  { key: "popups", label: TAB_LABEL.popups, href: "/owner?tab=popups", group: "관리" },
  { key: "data", label: TAB_LABEL.data, href: "/owner?tab=data", group: "관리" },
  { key: "audit", label: TAB_LABEL.audit, href: "/owner?tab=audit", group: "관리" },
  { key: "sheets", label: TAB_LABEL.sheets, href: "/owner?tab=sheets", group: "관리" },
];

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
  const tab = resolveTab(await searchParams);
  return { title: `학원 설정 · ${TAB_LABEL[tab]} — eywa` };
}

export default async function OwnerSettingsPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const viewer = await requireAccess("owner");
  // 역할·권한(permissions) 편집은 항상 master 전용(self-escalation 차단 — saveOwnerSection·0080a 트리거와 동일).
  // 위임받은 admin/manager는 다른 설정 면은 편집 가능하되 이 면만 안내로 대체(저장이 실패할 폼을 보여주지 않음).
  const isMaster = viewer.systemRole === "master";
  const sp = await searchParams;
  // 옛 "보고서 관리" 면(?tab=report_mgmt)은 좌측 독립 메뉴 /lesson-reports로 승격 — 기존 북마크 리다이렉트.
  if (sp.tab === "report_mgmt") redirect("/lesson-reports");
  // 보고서 표시·AI 멘트 설정 면은 수업보고서 탭으로 이관(2026-07-10) — 옛 ?tab=report·ai_ment 북마크 리다이렉트.
  if (sp.tab === "report") redirect("/lesson-reports?tab=report");
  if (sp.tab === "ai_ment") redirect("/lesson-reports?tab=ai_ment");
  const tab = resolveTab(sp);
  const [settings, meta] = await Promise.all([getTenantSettings(), getSettingsMeta()]);
  // 강의실(관계형 테이블)은 운영 체계 면에서만 로드 — 다른 면 진입 비용 0.
  const classrooms = tab === "operations" ? await getClassroomsWithUsage() : [];
  // 과목별 강사 라벨(과목 운영 '가로줄 제외 강사' 칩)은 해당 면에서만 로드.
  const teacherLabelsBySubject = tab === "subjects" ? await getTeacherLabelsBySubject() : {};
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
        actions={<p className="text-text-faint text-[12px]">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>}
      />

      <FaceTabs faces={FACES} active={tab} ariaLabel="학원 설정·관리 면 전환" />

      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {tab === "operations" ? (
        <OperationsSection initial={settings.operations} classrooms={classrooms} />
      ) : null}
      {tab === "subjects" ? (
        <SubjectsSection initial={settings.operations} teacherLabels={teacherLabelsBySubject} />
      ) : null}
      {tab === "billing" ? <BillingSection initial={settings.billing} /> : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      {tab === "consultations" ? <ConsultationsSection initial={settings.consultations} /> : null}
      {tab === "permissions" ? (
        isMaster ? (
          <PermissionsSection initial={settings.permissions} />
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
      {tab === "popups" ? <PopupsFace /> : null}
      {tab === "data" ? (
        <div className="space-y-10">
          <DataFace />
          <DuplicatesFace page={page} isEmbed={isEmbed} />
        </div>
      ) : null}
      {tab === "audit" ? <AuditFace action={sp.action} page={page} isEmbed={isEmbed} /> : null}
      {tab === "sheets" ? (
        <SheetsFace subjects={settings.operations.subjects} page={page} isEmbed={isEmbed} />
      ) : null}
    </div>
  );
}
