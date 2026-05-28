import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getScenarios } from "@/features/admin/server/queries";
import { ScenariosClient } from "./_client";

export const metadata = { title: "시나리오 관리 — eywa" };

export default async function ScenariosPage() {
  await requireAccess("staff");
  const user = await getCurrentUser();
  if (!user || user.systemRole !== "master") redirect("/");

  const scenarios = await getScenarios();

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        관리자 도구로
      </Link>

      <header className="border-border border-b pb-5">
        <p className="eyebrow">관리 · 시나리오</p>
        <h1 className="display text-foreground text-2xl">시간표 시나리오</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          현재 시간표·수강 상태를 jsonb snapshot으로 저장. 가설 검토용. 복원 기능은 추후 추가.
        </p>
      </header>

      <ScenariosClient scenarios={scenarios} />
    </div>
  );
}
