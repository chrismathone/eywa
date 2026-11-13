import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { NewTenantForm } from "./_form";

export const metadata = { title: "슈퍼관리자 · 신규 학원 발급 — 에이와" };

export default function NewTenantPage() {
  return (
    <>
      <PageHeader
        eyebrow="전 지점 운영"
        title="신규 학원 발급"
        description="학원·원장 계정과 처음 사용할 기능을 한 번에 정합니다. 만든 즉시 그 원장이 로그인할 수 있습니다."
        embedLabel="학원과 원장 계정을 한 번에 만듭니다"
        actions={
          <Link href="/super-admin/tenants" className={buttonVariants({ variant: "outline" })}>
            <EyIcon name="arrowLeft" size={16} strokeWidth={1.8} /> 목록으로
          </Link>
        }
      />
      <div className="bg-card shadow-card mx-auto max-w-2xl rounded-2xl p-4 sm:p-6">
        <NewTenantForm />
      </div>
    </>
  );
}
