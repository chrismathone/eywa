import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  getMyClassReviewFilter,
  getReviewPrivileges,
  getReviewViewer,
  listClassReviews,
  myScoreSlot,
  observerLimitOf,
} from "@/features/class-review/server/queries";
import { GRADE_CUTS, GRADE_FALLBACK } from "@/features/class-review/checklist";
import { ReviewTable } from "./_components/review-table";

export const metadata = { title: "수업 평가 — eywa" };

/**
 * 수업 평가 체크리스트(참관) 목록 — 시트 "수업 상향화 체크리스트" 이식 초안(2026-08-04).
 * 접근은 class_review 메뉴 게이트(기본 전원 차단, 개인 예외로만 개방 — 테스트 단계).
 * 보기 필터(전체/내 평가 대기/완료/미완료/선착순 — 평가지 기준)는 계정 귀속(원장 지시 2026-08-05).
 *
 * 강사 직급은 **자기 평가 전용**(원장 2026-08-19) — 목록에 본인 평가지만, 점수도 본인 채점만
 * 내려온다(가림은 listClassReviews). 여기선 그 사실과 어긋나는 화면 요소만 걷어낸다:
 * 서버가 거절하는 '새 평가' 버튼(죽은 버튼)과 "제출된 채점들의 평균"이라는 캡션(본인 것 하나뿐이다).
 */
export default async function ClassReviewPage() {
  const viewer = await requireAccess("class_review");
  // 자기 평가 전용 판정·평가지 소유 id는 서버 단일 소스에서('다른 강사 뷰'면 그 강사의 눈, #77).
  const [{ rows }, settings, priv, myFilter, rv] = await Promise.all([
    listClassReviews(),
    getTenantSettings(),
    getReviewPrivileges(),
    getMyClassReviewFilter(viewer),
    getReviewViewer(),
  ]);
  const selfOnly = rv.selfOnly;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const cutsLabel =
    GRADE_CUTS.map((c) => `${c.grade}≥${c.min}`).join(" · ") + ` · 미만 ${GRADE_FALLBACK}`;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-5 p-6">
      <PageHeader
        eyebrow="운영"
        title="수업 평가 체크리스트"
        description={
          selfOnly
            ? "내 수업 평가에 본인 평가를 작성합니다. 평가자 채점·종합 결과는 사무실에서 관리합니다."
            : "평가 문항(4점 척도)을 평가자와 본인이 각자 채점하고 나란히 비교합니다."
        }
        embedLabel="수업 평가 체크리스트"
        actions={
          <span className="flex items-center gap-2">
            {priv.seeNames ? (
              <Button variant="outline" render={<Link href="/class-review/board" />}>
                종합 보기
              </Button>
            ) : null}
            {priv.editTemplate ? (
              <Button variant="outline" render={<Link href="/class-review/template" />}>
                문항 편집
              </Button>
            ) : null}
            {/* 평가 건 개설은 사무실 몫 — 강사에겐 서버 액션이 거절하므로 버튼 자체를 안 그린다(#77). */}
            {selfOnly ? null : (
              <Button render={<Link href="/class-review/new" />}>
                + 새 평가
              </Button>
            )}
          </span>
        }
      />

      {rows.length === 0 ? (
        <div className="border-line rounded-2xl border border-dashed p-10 text-center">
          <p className="text-text-dim text-sm">
            {selfOnly
              ? "아직 내 수업 평가 건이 없습니다 — 사무실에서 평가 건을 만들면 여기에 표시됩니다."
              : "아직 평가 건이 없습니다 — ‘새 평가’로 시작하세요."}
          </p>
        </div>
      ) : (
        <ReviewTable
          initialFilter={myFilter}
          rows={rows.map((r) => {
            const mine = myScoreSlot(r, rv.id);
            return {
              id: r.id,
              date: r.header.date,
              teacherName: r.header.teacherName,
              subjectLabel: r.header.subject ? subjects.labelOf(r.header.subject) : null,
              subjectColor: r.header.subject ? subjects.colorOf(r.header.subject) : null,
              mode: r.header.observerMode === "open" ? ("open" as const) : ("assigned" as const),
              // ⚠️ 인원을 글자로 박지 말 것 — 정원은 평가마다 다르다(생성 시 선택, 문서에 동결).
              modeLabel:
                r.header.observerMode === "open" ? `선착순 ${observerLimitOf(r)}명` : "평가자 지정",
              myTurn: !!mine && !mine.submitted,
              incomplete: r.submittedCount < r.observerSlots,
              submitted: `${r.submittedCount}/${r.observerSlots}`,
              percent: r.averages ? r.averages.percent.toFixed(1) : null,
              grade: r.averages ? r.averages.grade : null,
            };
          })}
        />
      )}
      <p className="text-text-dim text-xs">
        {selfOnly
          ? `표시되는 점수는 본인 평가입니다 — 100점 기준 환산 · 등급 컷 ${cutsLabel}`
          : `환산점수 = 제출된 채점들의 문항 평균으로 계산한 100점 기준 점수 · 등급 컷 ${cutsLabel}`}
      </p>
    </div>
  );
}
