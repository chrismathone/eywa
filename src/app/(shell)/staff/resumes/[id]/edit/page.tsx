import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import { getStaffResumeById } from "@/features/staff/server/resume-queries";
import { ResumeForm } from "../../_components/resume-form";

export const metadata = { title: "직원 이력서 수정 — eywa" };

export default async function EditResumePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("staff");
  const { id } = await params;
  if (!(await canWriteTenant(user.systemRole, "staff"))) redirect(`/staff/resumes/${id}`);
  const resume = await getStaffResumeById(id);
  if (!resume) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <BackLink href={`/staff/resumes/${id}`} label="이력서 보기로" />
        <h1 className="text-foreground mt-1 text-lg font-bold">
          직원 이력서 수정 — {resume.data.personal.name || "(이름 미입력)"}
        </h1>
      </header>
      <ResumeForm mode="edit" id={id} initial={resume.data} />
    </div>
  );
}
