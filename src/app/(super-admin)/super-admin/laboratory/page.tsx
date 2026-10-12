import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { LAB_ELIGIBLE_MENUS } from "@/lib/laboratory/rule";
import { PageHeader } from "@/components/page-header";
import { LaboratoryMenuToggle } from "./_menu-toggle";

export const metadata = { title: "슈퍼관리자 · 실험실 메뉴 — 에이와" };

export default async function LaboratoryPage() {
  await requireSuperAdmin();
  const { data, error } = await createAdminClient().from("lab_menu_assignments").select("menu_key");
  const assigned = new Set((data ?? []).map((row) => row.menu_key));
  return <div className="space-y-4 p-4 md:p-6">
    <PageHeader title="실험실 메뉴" description="업무·설정 메뉴를 실험실로 지정할 수 있습니다. 지정한 메뉴는 실험실 기능을 켠 학원에만 공개되며, 메뉴 안의 사용 설정은 학원에서 따로 켭니다. 기본 진입 화면과 도움말·고객센터는 목록에서 제외됩니다." />
    {error ? <p role="alert" className="text-danger">실험실 메뉴를 불러오지 못했습니다. DB 설정을 확인해 주세요.</p> :
      <section className="border-line bg-card overflow-hidden rounded-xl border" aria-label="실험실 메뉴 지정">
        <ul>{LAB_ELIGIBLE_MENUS.map(({ key, label }) => <LaboratoryMenuToggle key={key} menu={key} label={label} assigned={assigned.has(key)} />)}</ul>
      </section>}
  </div>;
}
