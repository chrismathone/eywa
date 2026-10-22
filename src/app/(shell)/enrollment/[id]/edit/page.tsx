import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnrollmentConsultationById } from "@/features/enrollment/server/queries";
import { loadConsultationReferrer, referrerCandidatesFor } from "@/features/enrollment/server/referrer-queries";
import { createClient } from "@/lib/supabase/server";
import { ConsultationFullForm } from "../../_components/consultation-full-form";

export const metadata = { title: "신규 콜&상담 수정 — 에이와" };

export default async function EditEnrollmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAccess("enrollment");
  const { id } = await params;
  const db = (await createClient()) as unknown as SupabaseClient;
  const [c, ref] = await Promise.all([getEnrollmentConsultationById(id), loadConsultationReferrer(db, id)]);
  if (!c) notFound();
  const f = c.fields;
  // 아직 잇지 않은 소개 — 글에 이름이 그대로 나온 원생·직원을 후보로(소개 흔적이 있을 때만 목록을 읽는다).
  const candidates = ref.ready && !ref.referrer
    ? await referrerCandidatesFor(db, viewer.tenantId, { referrerName: ref.referrerName, path: f.consultationPath, texts: [c.parentRequest, f.safetyNotes, f.siblingsDetails] })
      .catch(() => [])
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/enrollment/${id}`} label="상세로" />
      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">신규 콜&상담 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{c.prospectName}</h1>
      </header>

      <ConsultationFullForm
        key={c.id}
        recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
        mode="edit"
        confirmConsultedOnSave={c.fromPublicIntake && ["pending", "scheduled"].includes(c.outcome)}
        aiSuggestedParentRequest={c.aiFormSuggestions?.parentRequest ?? null}
        existingRecordings={c.recordings.map((r) => ({ createdAt: r.createdAt, status: r.status }))}
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
          outcome: c.outcome,
          followUpContent: f.followUpContent,
          nonRegistrationReason: f.nonRegistrationReason,
          shuttleBusRequest: f.shuttleBusRequest,
          privacyAgreement: f.privacyAgreement,
          installmentAgreement: f.installmentAgreement,
          subjectDetails: f.subjectDetails,
          intakeChecklist: f.intakeChecklist,
          counselor: f.counselor,
          receivedDate: f.receivedDate,
          studentType: f.studentType,
          siblingsDetails: f.siblingsDetails,
          consultationDate: f.consultationDate,
          prevAcademy: (c.learningHistory as { prevAcademy?: string | null } | null)?.prevAcademy ?? null,
          lastScore: (c.learningHistory as { lastScore?: string | null } | null)?.lastScore ?? null,
          referrerReady: ref.ready,
          referrer: ref.referrer,
          referrerName: ref.referrerName,
          referrerCandidates: candidates,
        }}
      />
    </div>
  );
}
