import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings, getSettingsMeta } from "@/features/owner/server/queries";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { ProfileSection } from "./_components/profile-section";
import { OperationsSection } from "./_components/operations-section";
import { BillingSection } from "./_components/billing-section";
import { NotificationsSection } from "./_components/notifications-section";
import { PermissionsSection } from "./_components/permissions-section";
import { DataFace } from "./_components/data-face";
import { DuplicatesFace } from "./_components/duplicates-face";
import { AuditFace } from "./_components/audit-face";
import { SheetsFace } from "./_components/sheets-face";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | undefined>;
type OwnerTab =
  | "profile"
  | "operations"
  | "billing"
  | "notifications"
  | "permissions"
  | "data"
  | "dup"
  | "audit"
  | "sheets";

const TAB_LABEL: Record<OwnerTab, string> = {
  profile: "프로필·브랜드",
  operations: "운영 체계",
  billing: "수납·청구",
  notifications: "알림·약관",
  permissions: "역할·권한",
  data: "데이터 정리",
  dup: "중복 학생",
  audit: "감사로그",
  sheets: "연동",
};

const VALID_TABS: OwnerTab[] = [
  "profile",
  "operations",
  "billing",
  "notifications",
  "permissions",
  "data",
  "dup",
  "audit",
  "sheets",
];

function resolveTab(sp: Sp): OwnerTab {
  const t = sp.tab;
  return t && (VALID_TABS as string[]).includes(t) ? (t as OwnerTab) : "profile";
}

// 설정 5면 ┃ 관리 4면(데이터 정리·중복·감사·연동, 구 /admin 흡수) — group 경계에 FaceTabs 세로 구분선.
const FACES: Face[] = [
  { key: "profile", label: TAB_LABEL.profile, href: "/owner", group: "설정" },
  { key: "operations", label: TAB_LABEL.operations, href: "/owner?tab=operations", group: "설정" },
  { key: "billing", label: TAB_LABEL.billing, href: "/owner?tab=billing", group: "설정" },
  { key: "notifications", label: TAB_LABEL.notifications, href: "/owner?tab=notifications", group: "설정" },
  { key: "permissions", label: TAB_LABEL.permissions, href: "/owner?tab=permissions", group: "설정" },
  { key: "data", label: TAB_LABEL.data, href: "/owner?tab=data", group: "관리" },
  { key: "dup", label: TAB_LABEL.dup, href: "/owner?tab=dup", group: "관리" },
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
  await requireAccess("owner");
  const sp = await searchParams;
  const tab = resolveTab(sp);
  const [settings, meta] = await Promise.all([getTenantSettings(), getSettingsMeta()]);
  // 관리 면(중복·감사) 페이지네이션용. 창(embed) 컨텍스트는 면 pageHref가 직접 유지.
  const page = Math.max(1, Number(sp.page) || 1);
  const isEmbed = sp.embed === "1";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="border-border border-b pb-5">
        <p className="eyebrow">학원 설정 · owner 전용</p>
        <h1 className="display text-foreground text-2xl">{settings.profile.name || "학원"} 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          학원에 관한 모든 설정과 관리 도구를 여기서 관리하면 해당 학원(테넌트) 전체에 적용됩니다. 원장(master)만 변경할 수 있습니다.
        </p>
        <p className="text-text-faint mt-1 text-[12px]">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>
      </header>

      <FaceTabs faces={FACES} active={tab} ariaLabel="학원 설정·관리 면 전환" />

      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {tab === "operations" ? <OperationsSection initial={settings.operations} /> : null}
      {tab === "billing" ? <BillingSection initial={settings.billing} /> : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      {tab === "permissions" ? <PermissionsSection initial={settings.permissions} /> : null}
      {tab === "data" ? <DataFace /> : null}
      {tab === "dup" ? <DuplicatesFace page={page} isEmbed={isEmbed} /> : null}
      {tab === "audit" ? <AuditFace action={sp.action} page={page} isEmbed={isEmbed} /> : null}
      {tab === "sheets" ? <SheetsFace notifications={settings.notifications} /> : null}
    </div>
  );
}
