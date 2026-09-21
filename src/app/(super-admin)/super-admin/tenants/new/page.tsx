import { SuperAdminHeader } from "@/components/super-admin/header";
import { NewTenantForm } from "./_form";

export const metadata = { title: "Super Admin · 신규 학원 발급 — aywa" };

export default function NewTenantPage() {
  return (
    <>
      <SuperAdminHeader title="신규 학원 발급" breadcrumb={[{ label: "학원 목록" }, { label: "신규" }]} />
      <div className="px-7 py-6">
        <div className="bg-card border-line shadow-card mx-auto max-w-2xl rounded-2xl border p-6">
          <p className="text-text-dim text-xs leading-relaxed">
            학원과 원장(master) 계정을 한 번에 생성합니다. 생성 즉시 해당 원장이 로그인할 수 있습니다.
          </p>
          <div className="mt-5">
            <NewTenantForm />
          </div>
        </div>
      </div>
    </>
  );
}
