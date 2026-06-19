import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings, getSettingsMeta } from "@/features/owner/server/queries";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { ProfileSection } from "./_components/profile-section";
import { OperationsSection } from "./_components/operations-section";
import { BillingSection } from "./_components/billing-section";
import { NotificationsSection } from "./_components/notifications-section";
import { PermissionsSection } from "./_components/permissions-section";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | undefined>;
type OwnerTab = "profile" | "operations" | "billing" | "notifications" | "permissions";

const TAB_LABEL: Record<OwnerTab, string> = {
  profile: "프로필·브랜드",
  operations: "운영 체계",
  billing: "수납·청구",
  notifications: "알림·연동·약관",
  permissions: "역할·권한",
};

function resolveTab(sp: Sp): OwnerTab {
  return sp.tab === "operations"
    ? "operations"
    : sp.tab === "billing"
      ? "billing"
      : sp.tab === "notifications"
        ? "notifications"
        : sp.tab === "permissions"
          ? "permissions"
          : "profile";
}

const FACES: Face[] = [
  { key: "profile", label: TAB_LABEL.profile, href: "/owner" },
  { key: "operations", label: TAB_LABEL.operations, href: "/owner?tab=operations" },
  { key: "billing", label: TAB_LABEL.billing, href: "/owner?tab=billing" },
  { key: "notifications", label: TAB_LABEL.notifications, href: "/owner?tab=notifications" },
  { key: "permissions", label: TAB_LABEL.permissions, href: "/owner?tab=permissions" },
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

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="border-border border-b pb-5">
        <p className="eyebrow">학원 설정 · owner 전용</p>
        <h1 className="display text-foreground text-2xl">{settings.profile.name || "학원"} 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          학원에 관한 모든 설정을 여기서 관리하면 해당 학원(테넌트) 전체에 적용됩니다. 원장(master)만 변경할 수 있습니다.
        </p>
        <p className="text-text-faint mt-1 text-[12px]">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>
      </header>

      <FaceTabs faces={FACES} active={tab} ariaLabel="학원 설정 면 전환" />

      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {tab === "operations" ? <OperationsSection initial={settings.operations} /> : null}
      {tab === "billing" ? <BillingSection initial={settings.billing} /> : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      {tab === "permissions" ? <PermissionsSection initial={settings.permissions} /> : null}
    </div>
  );
}
