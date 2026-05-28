import { SuperAdminHeader } from "@/components/super-admin/header";
import { NewTenantForm } from "./_form";

export const metadata = { title: "Super Admin · 신규 학원 발급 — eywa" };

export default function NewTenantPage() {
  return (
    <>
      <SuperAdminHeader title="신규 학원 발급" breadcrumb={[{ label: "학원 목록" }, { label: "신규" }]} />
      <div className="px-7 py-6">
        <div className="bg-card border-line shadow-card mx-auto max-w-2xl rounded-2xl border p-6">
          <p className="text-text-dim text-[12px] leading-relaxed">
            tenants 행 + master 계정(원장)을 한 번에 생성합니다. 트리거 <code className="font-mono">tg_sync_user_from_auth</code>가
            public.users에 자동 mirror하므로 사용자는 즉시 로그인 가능합니다.
          </p>
          <div className="mt-5">
            <NewTenantForm />
          </div>
        </div>
      </div>
    </>
  );
}
