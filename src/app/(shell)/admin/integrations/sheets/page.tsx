import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { SheetsClient } from "./_client";

export const metadata = { title: "Google Sheets 동기화 — eywa" };

export default async function SheetsIntegrationPage() {
  await requireAccess("staff"); // master 권한 우선 → staff 권한이 가장 close
  const user = await getCurrentUser();
  if (!user || user.systemRole !== "master") redirect("/");

  const status = await getGoogleSheetsStatus();

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        대시보드로
      </Link>

      <header className="border-border border-b pb-5">
        <p className="eyebrow">관리 · 외부 통합</p>
        <h1 className="display text-foreground text-2xl">Google Sheets 동기화</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          시간표를 Google Sheets로 push합니다. eywa 측에서 단일 service account로 시트를 소유하고,
          입력한 이메일에 writer 권한을 부여합니다.
        </p>
      </header>

      <SheetsClient status={status} />
    </div>
  );
}
