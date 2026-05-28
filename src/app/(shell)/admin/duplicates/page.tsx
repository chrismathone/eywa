import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findDuplicateStudents } from "@/features/admin/server/queries";
import { DuplicatesClient } from "./_client";

export const metadata = { title: "중복 학생 — eywa" };

export default async function DuplicatesPage() {
  await requireAccess("staff");
  const user = await getCurrentUser();
  if (!user || user.systemRole !== "master") redirect("/");

  const groups = await findDuplicateStudents();

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
        <p className="eyebrow">관리 · 중복 병합</p>
        <h1 className="display text-foreground text-2xl">중복 의심 학생</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          이름·학년·학교가 모두 같은 학생들. 통합하면 모든 수강·출석·수납·상담·메모가 keeper로
          이전되고 mergee는 퇴원 처리됩니다.
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">중복 의심 학생이 없습니다</p>
      ) : (
        <DuplicatesClient groups={groups} />
      )}
    </div>
  );
}
