import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { ConsultationCase } from "@/features/management-agent/components/consultation-case";

export const metadata = { title: "후속조치 처리 기록 — 에이와" };
export default async function FollowupPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("consultations");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  return <div className="space-y-4">
    <BackLink href="/consultations" label="원생상담으로" />
    <ConsultationCase consultationId={id} byCaseId />
  </div>;
}
