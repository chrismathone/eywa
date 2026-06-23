import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { getEnrollmentConsultationById } from "@/features/enrollment/server/queries";
import { ConsultationFullForm } from "../../_components/consultation-full-form";

export const metadata = { title: "등록상담 수정 — eywa" };

export default async function EditEnrollmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("enrollment");
  const { id } = await params;
  const c = await getEnrollmentConsultationById(id);
  if (!c) notFound();
  const f = c.fields;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/enrollment/${id}`} label="상세로" />
      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">등록상담 수정</p>
        <h1 className="display text-foreground text-2xl">{c.prospectName}</h1>
      </header>

      <ConsultationFullForm
        mode="edit"
        initial={{
          id: c.id,
          prospectName: c.prospectName,
          prospectGrade: c.prospectGrade,
          prospectSchool: c.prospectSchool,
          parentName: c.parentName,
          parentPhone: c.parentPhone,
          parentRequest: c.parentRequest,
          englishName: f.englishName,
          gender: f.gender,
          bloodType: f.bloodType,
          birthDate: f.birthDate,
          studentPhone: f.studentPhone,
          homePhone: f.homePhone,
          parentRelation: f.parentRelation,
          address: f.address,
          zipCode: f.zipCode,
          addressDetail: f.addressDetail,
          consultationPath: f.consultationPath,
          subject: f.subject,
          careerGoal: f.careerGoal,
          siblings: f.siblings,
          safetyNotes: f.safetyNotes,
          registrationStatus: f.registrationStatus,
          paymentAmount: f.paymentAmount,
          paymentDate: f.paymentDate,
          registrar: f.registrar,
          followUpDate: f.followUpDate,
          followUpContent: f.followUpContent,
          nonRegistrationReason: f.nonRegistrationReason,
          shuttleBusRequest: f.shuttleBusRequest,
          privacyAgreement: f.privacyAgreement,
          installmentAgreement: f.installmentAgreement,
          subjectDetails: f.subjectDetails,
        }}
      />
    </div>
  );
}
