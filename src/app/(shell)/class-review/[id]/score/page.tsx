import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "@/components/icons/eywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { getClassReview, myScoreSlot } from "@/features/class-review/server/queries";
import { ScorePanel } from "../../_components/score-panel";

export const metadata = { title: "수업 평가 채점 — eywa" };

/**
 * 채점 전용 페이지(원장 지시 2026-08-04) — 상세(보기)와 분리. 자격자만 진입(아니면 상세로 돌려보냄).
 * 저장하면 상세로 복귀한다.
 */
export default async function ClassReviewScorePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireAccess("class_review");
  const { id } = await params;
  const found = await getClassReview(id);
  if (!found) notFound();
  const { doc, areas } = found;

  const mine = myScoreSlot(doc, viewer.id);
  if (!mine) redirect(`/class-review/${id}`);
  const mySheet = doc.submissions[mine.slot] ?? null;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <div>
        <Link
          href={`/class-review/${id}`}
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 상세로 돌아가기
        </Link>
        <PageHeader
          eyebrow="수업 평가"
          title={`${mine.slot === "self" ? "본인 평가" : "채점"} — ${doc.header.teacherName} · ${doc.header.date}`}
          description="문항마다 1~4점을 누르고 마지막에 저장하세요. 저장하면 상세 화면으로 돌아갑니다."
          embedLabel={`채점 — ${doc.header.teacherName}`}
        />
      </div>
      <ScorePanel
        docId={doc.id}
        areas={areas}
        initialScores={mySheet?.scores ?? []}
        initialComment={mySheet?.comment ?? ""}
        backHref={`/class-review/${id}`}
      />
    </div>
  );
}
