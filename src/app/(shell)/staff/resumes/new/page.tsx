import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { emptyResume } from "@/features/staff/resume";
import { ResumeSheet } from "../_components/resume-sheet";

export const metadata = { title: "직원 이력서 작성 — eywa" };

export default async function NewResumePage() {
  const user = await requireAccess("staff");
  if (!(await canWriteTenant(user.systemRole, "staff"))) redirect("/staff?tab=resumes");

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff?tab=resumes" label="직원 이력서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">직원 이력서 작성</h1>
        <p className="text-text-dim mt-1 text-sm">
          종이 서식의 각 칸에 바로 입력하세요 — 저장하면 데이터베이스(인사·직원)에 보관되고 언제든 다시 수정·A4 인쇄할 수 있습니다.
        </p>
      </header>
      <ResumeSheet data={emptyResume()} canWrite startEditing />
    </div>
  );
}
