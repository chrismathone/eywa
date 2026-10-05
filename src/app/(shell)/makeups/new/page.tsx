import { EmbedLink as Link } from "@/components/embed-link";
import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { MakeupIntakeForm } from "@/features/makeups/components/intake-form";

export const metadata = { title: "보강 접수 — 에이와" };
export default async function NewMakeupPage() {
  const actor = await requireAccess("makeups");
  const settings = await getTenantSettings();
  if (!(await canWriteTenant(actor.systemRole, "makeups")) || settings.makeups.mode !== "on") notFound();
  const enabledSubjects = new Set<string>(settings.makeups.pilotSubjects);
  const subjects = settings.operations.subjects.filter(subject => enabledSubjects.has(subject.key));
  return <div className="space-y-4 pb-6">
    <PageHeader title="보강 접수" description="학생과 보강 사유를 등록합니다" actions={<Link className="text-primary underline" href="/makeups">목록</Link>} />
    {subjects.length ? <div className="border-line rounded-lg border p-4"><MakeupIntakeForm subjects={subjects} /></div>
      : <p role="alert">보강관리에서 사용할 과목 설정을 확인해 주세요.</p>}
  </div>;
}
