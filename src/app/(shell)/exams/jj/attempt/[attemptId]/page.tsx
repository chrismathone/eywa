import { notFound } from "next/navigation";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { JjExamSheet } from "@/features/ijw/components/jj-exam-sheet";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjViewer } from "@/features/ijw/server/queries";
import { getJjAttempt } from "@/features/ijw/server/sheet-queries";
import { JJ_SCOPE_FAILED, JjFailBanner } from "../../../_components/jj-shared";

/**
 * 성적관리 › 영어 › JJ실 › **응시 한 건의 시험 결과지**(인재원 설명서 3번, 2026-09-11).
 * 학생 상세 '최근 본 시험'의 '결과지'가 여는 창. 결과지는 학부모 카드와 **같은 조각**(JjExamSheet)을 넓은 틀로 그린다.
 * 🔴 게이트는 시험 결과 창(jj/[deckId])과 같다 — 연동 설정 + 담당 반에 영어(hasEnglish) + 강사면 자기 학생의 응시만
 *    (getJjAttempt). 남의 학생·없는 응시는 같은 404(주소를 직접 쳐도 같은 답, #77).
 * ⚠️ 인재원 호출(최대 8초)이 창 첫 페인트를 막지 않게 loading.tsx가 먼저 선다(B7).
 */
export const metadata = { title: "JJ실 시험 결과지 — eywa" };

export default async function JjAttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const user = await requireAccess("exams");
  if (!ijwConfigFor(user.tenantId)) notFound();
  const [{ attemptId }, viewer] = await Promise.all([params, getJjViewer()]);
  if (!viewer || !viewer.hasEnglish) notFound();
  if (!attemptId || attemptId.length > 120) notFound();
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const res = await getJjAttempt(viewer, attemptId);
  if (res.state === "missing") notFound();
  if (res.state === "error") return <JjFailBanner message={res.failure.message} detail={res.failure.detail} />;
  const { exam, eywa } = res;
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {eywa ? (
          <WindowLink
            href={`/students/${eywa.studentId}?tab=grades`}
            title={eywa.name}
            className="text-primary font-bold hover:underline"
          >
            {eywa.name} 학생 상세
          </WindowLink>
        ) : (
          <span className="text-foreground font-bold">{exam.student.name || exam.student.id}</span>
        )}
        {exam.student.className ? <span className="text-text-dim">인재원 반 {exam.student.className}</span> : null}
        <WindowLink
          href={`/exams/jj/${encodeURIComponent(exam.deck.id)}`}
          title={`${exam.deck.name} — 이 시험 전체 결과`}
          className="text-primary font-bold hover:underline"
        >
          이 시험 전체 결과
        </WindowLink>
      </nav>
      <JjExamSheet exam={exam} layout="wide" />
    </div>
  );
}
