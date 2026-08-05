import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  getMyClassReviewFilter,
  getReviewPrivileges,
  listClassReviews,
  myScoreSlot,
} from "@/features/class-review/server/queries";
import { GRADE_CUTS, GRADE_FALLBACK } from "@/features/class-review/checklist";
import { ReviewTable } from "./_components/review-table";

export const metadata = { title: "수업 평가 — eywa" };

/**
 * 수업 평가 체크리스트(참관) 목록 — 시트 "수업 상향화 체크리스트" 이식 초안(2026-08-04).
 * 접근은 class_review 메뉴 게이트(기본 전원 차단, 개인 예외로만 개방 — 테스트 단계).
 * 보기 필터(전체/내 평가 대기/완료/미완료/선착순 — 평가지 기준)는 계정 귀속(원장 지시 2026-08-05).
 */
export default async function ClassReviewPage() {
  const viewer = await requireAccess("class_review");
  const [{ rows }, settings, priv, myFilter] = await Promise.all([
    listClassReviews(),
    getTenantSettings(),
    getReviewPrivileges(viewer),
    getMyClassReviewFilter(viewer),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const cutsLabel =
    GRADE_CUTS.map((c) => `${c.grade}≥${c.min}`).join(" · ") + ` · 미만 ${GRADE_FALLBACK}`;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <PageHeader
        eyebrow="운영"
        title="수업 평가 체크리스트"
        description="참관 문항(4점 척도)을 평가자와 본인이 각자 채점하고 나란히 비교합니다."
        embedLabel="수업 평가 체크리스트"
        actions={
          <span className="flex items-center gap-2">
            {priv.seeNames ? (
              <Button variant="outline" size="sm" render={<Link href="/class-review/board" />}>
                종합 보기
              </Button>
            ) : null}
            {priv.editTemplate ? (
              <Button variant="outline" size="sm" render={<Link href="/class-review/template" />}>
                문항 편집
              </Button>
            ) : null}
            <Button size="sm" render={<Link href="/class-review/new" />}>
              + 새 참관
            </Button>
          </span>
        }
      />

      {rows.length === 0 ? (
        <div className="border-line rounded-2xl border border-dashed p-10 text-center">
          <p className="text-text-dim text-sm">아직 참관 건이 없습니다 — &lsquo;새 참관&rsquo;으로 시작하세요.</p>
        </div>
      ) : (
        <ReviewTable
          initialFilter={myFilter}
          rows={rows.map((r) => {
            const mine = myScoreSlot(r, viewer.id);
            return {
              id: r.id,
              date: r.header.date,
              teacherName: r.header.teacherName,
              subjectLabel: r.header.subject ? subjects.labelOf(r.header.subject) : null,
              subjectColor: r.header.subject ? subjects.colorOf(r.header.subject) : null,
              mode: r.header.observerMode === "open" ? ("open" as const) : ("assigned" as const),
              modeLabel: r.header.observerMode === "open" ? "선착순 3명" : "평가자 지정",
              myTurn: !!mine && !mine.submitted,
              incomplete: r.submittedCount < r.observerSlots,
              submitted: `${r.submittedCount}/${r.observerSlots}`,
              percent: r.averages ? r.averages.percent.toFixed(1) : null,
              grade: r.averages ? r.averages.grade : null,
            };
          })}
        />
      )}
      <p className="text-text-dim text-[11px]">
        환산점수 = 제출된 채점들의 문항 평균으로 계산한 100점 기준 점수 · 등급 컷 {cutsLabel}
      </p>
    </div>
  );
}
