import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { findOrphans } from "@/features/admin/server/queries";
import { CleanupClient } from "./_client";

export const metadata = { title: "데이터 정리 — eywa" };

export default async function CleanupPage() {
  await requireAccess("admin");

  const report = await findOrphans();

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
        <p className="eyebrow">관리 · 데이터 정리</p>
        <h1 className="display text-foreground text-2xl">고아 데이터 점검</h1>
      </header>

      <CleanupClient report={report} />
    </div>
  );
}
