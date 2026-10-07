
import { SheetText } from "@/features/teacher-view/interface-label";
import { notFound } from "next/navigation";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjViewer } from "@/features/ijw/server/queries";
import { getVocabkingReport } from "@/features/vocabking/server/load";
import { VocabkingReportView } from "@/features/vocabking/components/vocabking-report";
import { JJ_SCOPE_FAILED, JjFailBanner } from "../../../../_components/jj-shared";

/**
 * 성적관리 › 영어 › JJ실 › 응시 한 건의 **보카킹 종합평가 리포트**(원장 2026-10-07 — 1차 구현, 시안 확인용).
 * 🔴 게이트는 결과지 창과 같다(`getVocabkingReport` → `getJjAttempt`) — 남의 학생·없는 응시는 같은 404(#77).
 * ⚠️ 인재원 호출 3건(결과지·학습·응시자)이 첫 페인트를 막지 않게 loading.tsx가 먼저 선다(B7).
 */
export const metadata = { title: "보카킹 종합평가 리포트 — 에이와" };

export default async function VocabkingReportPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const user = await requireAccess("exams");
  if (!ijwConfigFor(user.tenantId)) notFound();
  const [{ attemptId }, viewer] = await Promise.all([params, getJjViewer()]);
  if (!viewer || !viewer.hasEnglish) notFound();
  if (!attemptId || attemptId.length > 120) notFound();
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const res = await getVocabkingReport(viewer, attemptId);
  if (res.state === "missing") notFound();
  if (res.state === "error") return <JjFailBanner message={res.failure.message} detail={res.failure.detail} />;
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <WindowLink
          href={`/exams/jj/attempt/${encodeURIComponent(attemptId)}`}
          title="시험 결과지"
          className="text-primary font-bold hover:underline"
        >
          <SheetText value={"시험 결과지"} /></WindowLink>
        {res.aywa ? (
          <WindowLink
            href={`/students/${res.aywa.studentId}?tab=grades`}
            title={res.aywa.name}
            className="text-primary font-bold hover:underline"
          >
            {res.aywa.name} <SheetText value={"학생 상세"} /></WindowLink>
        ) : null}
      </nav>
      <VocabkingReportView report={res.report} />
    </div>
  );
}
