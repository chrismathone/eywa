import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getStaffResumeById } from "@/features/staff/server/resume-queries";
import { ResumeSheet } from "../_components/resume-sheet";

export const metadata = { title: "직원 이력서 — eywa" };

export default async function ResumeViewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("staff");
  const { id } = await params;
  const [resume, canWrite] = await Promise.all([
    getStaffResumeById(id),
    canWriteTenant(user.systemRole, "staff"),
  ]);
  if (!resume) notFound();
  const name = resume.data.personal.name || "(이름 미입력)";

  return (
    <div className="print-portrait space-y-4 p-6">
      <header className="print:hidden">
        <BackLink href="/staff?tab=resumes" label="직원 이력서 목록으로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">직원 이력서 — {name}</h1>
        <p className="text-text-dim text-xs">
          {new Date(resume.createdAt).toLocaleDateString("ko-KR")} 작성
          {resume.authorName ? ` · ${resume.authorName}` : ""} · 데이터베이스(인사·직원)에 저장됨
        </p>
      </header>
      <ResumeSheet data={resume.data} id={id} canWrite={canWrite} />
    </div>
  );
}
