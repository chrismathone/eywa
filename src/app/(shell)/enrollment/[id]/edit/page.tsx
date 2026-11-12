import { notFound } from "next/navigation";
import { isFeatureLicensed } from "@/lib/license/server";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnrollmentConsultationById } from "@/features/enrollment/server/queries";
import { loadConsultationReferrer, referrerCandidatesFor } from "@/features/enrollment/server/referrer-queries";
import { createClient } from "@/lib/supabase/server";
import { detailPanelsFor, showBriefCard } from "@/features/enrollment/detail-panels";
import { ConsultationFullForm } from "../../_components/consultation-full-form";
import { PrepBriefSection } from "../prep-brief-section";

export const metadata = { title: "신규 콜&상담 수정 — 에이와" };

/**
 * 이 화면에도 브리프 '만들기·다시 작성' 단추가 있다(상세와 같은 부품) — 서버 액션은 **호출된 세그먼트의
 * maxDuration**을 따르므로 상세(`../page.tsx`)와 같은 값을 둔다. 기본값이면 `after()` 생성이 중간에 죽어
 * 상태가 'generating'에 남는다(진행바 무한).
 */
export const maxDuration = 300;

export default async function EditEnrollmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAccess("enrollment");
  const { id } = await params;
  const db = (await createClient()) as unknown as SupabaseClient;
  // 읽기 권한이면 칸을 잠그고 저장·녹음 단추를 그리지 않는다 — 저장 액션 게이트와 같은 함수·같은 키(원장 2026-11-05 · write-lock.ts).
  const [c, ref, canWrite, aiOn] = await Promise.all([
    getEnrollmentConsultationById(id),
    loadConsultationReferrer(db, id),
    canWriteTenant(viewer.systemRole, "enrollment"),
    // 브리프 자리는 AI 라이선스가 켜진 지점만(꺼지면 흔적 없이 · 검수 2026-11-11).
    isFeatureLicensed(viewer.tenantId, "ai_analysis"),
  ]);
  if (!c) notFound();
  const f = c.fields;
  // 브리프 = 상세와 같은 판정·같은 부품(원장 2026-11-11 *"브리프를 보면서 수정(입력)할 수 있게"*) — 저장해 둔 것만 보이고
  // 페이지 로드가 AI를 부르지 않는다. 없으면 상세와 같은 안내 카드(상담 전) 또는 아무것도 없음(지난 건).
  const { pastBrief } = detailPanelsFor({ outcome: c.outcome, assignedClassCount: c.assignedClassCount });
  const showBrief = showBriefCard({ hasBrief: !!c.prepBrief, status: c.prepBriefStatus, past: pastBrief, aiOn });
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

      {/* 🔴 폼 밖·폼과 같은 부모 — 펼친 판이 폼 끝까지 화면 위에 붙어 있고(sticky는 부모 상자 안에서만 붙는다),
          '다시 작성' 폼이 상담 폼 안으로 들어가지 않는다(prep-brief-collapse 머리 주석). */}
      {showBrief ? (
        <PrepBriefSection
          pinned
          consultationId={c.id}
          record={c.prepBrief}
          status={c.prepBriefStatus}
          errorText={c.prepBriefError}
          stalled={c.prepBriefStalled}
          jobAt={c.prepBriefJobAt}
          canWrite={canWrite}
          past={pastBrief}
        />
      ) : null}

      <ConsultationFullForm
        key={c.id}
        recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
        mode="edit"
        readOnly={!canWrite}
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
          assignedClassCount: c.assignedClassCount,
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
