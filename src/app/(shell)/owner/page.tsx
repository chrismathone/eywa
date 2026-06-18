import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings, getSettingsMeta } from "@/features/owner/server/queries";
import { OwnerConsole } from "./_components/owner-console";

export const metadata = { title: "학원 설정 — eywa" };
export const dynamic = "force-dynamic";

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

export default async function OwnerSettingsPage() {
  await requireAccess("owner");
  const [settings, meta] = await Promise.all([getTenantSettings(), getSettingsMeta()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="border-border border-b pb-5">
        <p className="eyebrow">학원 설정 · owner 전용</p>
        <h1 className="display text-foreground text-2xl">{settings.profile.name || "학원"} 설정</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          학원에 관한 모든 설정을 여기서 관리하면 해당 학원(테넌트) 전체에 적용됩니다. 원장(master)만 변경할 수 있습니다.
        </p>
        <p className="text-text-faint mt-1 text-[12px]">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>
      </header>

      <OwnerConsole settings={settings} />
    </div>
  );
}
