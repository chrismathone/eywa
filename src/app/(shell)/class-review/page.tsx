import Link from "next/link";
import { FaceTabs } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
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
import { classReviewFaces, resolveClassReviewTab } from "@/features/class-review/faces";
import { PortfolioFace } from "./_components/portfolio/portfolio-face";
import { WorkFace } from "./_components/work-face";
import { loadTeacherWork } from "@/features/dashboard/overview/teacher-work-server";
import { withStaffTasks } from "@/features/staff-tasks/server/teacher-work";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { kstToday } from "@/lib/date-kst";
import { ReviewTable } from "./_components/review-table";
import { ReviewSummaryGate } from "./_components/review-summary-gate";

type Sp = { tab?: string; teacher?: string };

// 면마다 문서 제목을 달리해 창 타이틀바가 따라온다. 접두 "직원 평가"는 사이드바 라벨과 같아야 한다.
// 열 수 없는 면의 이름은 제목에도 싣지 않는다(본문과 같은 판정).
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const [sp, priv] = await Promise.all([searchParams, getReviewPrivileges()]);
  const tab = resolveClassReviewTab(sp.tab, { portfolio: priv.seePortfolio });
  return { title: `직원 평가${tab === "portfolio" ? " · 직원 포트폴리오" : tab === "work" ? " · 업무 현황" : ""} — 에이와` };
}

// 포트폴리오의 [지금 집계]가 이 화면에서 도는 서버 액션이다 — 기본 상한으로는 집계가 끝나기 전에 끊긴다.
export const maxDuration = 120;

/**
 * 수업 평가 체크리스트(참관) 목록 — 시트 "수업 상향화 체크리스트" 이식 초안(2026-08-04).
 * 접근은 class_review 메뉴 게이트(기본 전원 차단, 개인 예외로만 개방 — 테스트 단계).
 * 보기 필터(전체/내 평가 대기/완료/미완료/선착순 — 평가지 기준)는 계정 귀속(원장 지시 2026-08-05).
 *
 * 강사 직급은 **자기 평가 전용**(원장 2026-08-19) — 목록에 본인 평가지만, 점수도 본인 채점만
 * 내려온다(가림은 listClassReviews). 여기선 그 사실과 어긋나는 화면 요소만 걷어낸다:
 * 서버가 거절하는 '새 평가' 버튼(죽은 버튼)과 "제출된 채점들의 평균"이라는 캡션(본인 것 하나뿐이다).
 */
export default async function ClassReviewPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const viewer = await requireAccess("class_review");
  const [sp, privileges] = await Promise.all([searchParams, getReviewPrivileges()]);
  const faceOptions = { portfolio: privileges.seePortfolio };
  const faces = classReviewFaces(faceOptions);
  // 면이 하나뿐이면(포트폴리오를 못 보는 사람) 탭 줄을 그리지 않는다 — 종전 화면 그대로다.
  const faceTabs = faces.length > 1
    ? <FaceTabs faces={faces} active={resolveClassReviewTab(sp.tab, faceOptions)} ariaLabel="직원 평가 면 전환" />
    : null;
  if (resolveClassReviewTab(sp.tab, faceOptions) === "portfolio") {
    return (
      <div className="w-full min-w-0 space-y-5 p-6">
        <PageHeader
          eyebrow="운영"
          title="직원 포트폴리오"
          description="강사별 월간 점수와 근거를 봅니다. 매월 1일에 새로 시작해 말일에 마감합니다."
          embedLabel="직원 포트폴리오"
        />
        {faceTabs}
        <PortfolioFace role={viewer.systemRole} teacherId={sp.teacher ?? null} />
      </div>
    );
  }
  // 업무 현황 — 대시보드 '강사별 업무 현황'을 옮겨 온 면(원장 2026-10-29·30 · 원장만 = 포트폴리오와 같은 판정).
  if (resolveClassReviewTab(sp.tab, faceOptions) === "work") {
    const settings = await getTenantSettings();
    const data = await withStaffTasks(loadTeacherWork(viewer.tenantId, kstToday(), null, settings));
    return (
      <div className="w-full min-w-0 space-y-5 p-6">
        <PageHeader
          eyebrow="운영"
          title="업무 현황"
          description="학원 전체 합계를 먼저 보고, 강사별 표는 [강사별 보기]로 엽니다. 보고서·영상은 최근 7일, 출결은 어제까지 7일 기준입니다."
          embedLabel="업무 현황"
        />
        {faceTabs}
        <WorkFace data={data} subjects={subjectLabelRecord(settings.operations.subjects)} />
      </div>
    );
  }
  // 자기 평가 전용 판정·평가지 소유 id는 서버 단일 소스에서('다른 강사 뷰'면 그 강사의 눈, #77).
  // 쓰기 판정 = 서버 액션(requireWrite)과 같은 canWriteTenant("class_review") — 읽기 권한이면 '새 평가'·'문항 편집'을 그리지 않는다.
  const [{ rows }, settings, priv, myFilter, rv, canWrite] = await Promise.all([
    listClassReviews(),
    getTenantSettings(),
    getReviewPrivileges(),
    getMyClassReviewFilter(viewer),
    getReviewViewer(),
    canWriteTenant(viewer.systemRole, "class_review"),
  ]);
  const selfOnly = rv.selfOnly;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const cutsLabel =
    GRADE_CUTS.map((c) => `${c.grade}≥${c.min}`).join(" · ") + ` · 미만 ${GRADE_FALLBACK}`;

  const reviewRows = rows.map((r) => {
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
              // 읽기 권한이면 '내 평가 대기'로 재촉하지 않는다 — 채점 단추가 없다(write-lock.ts · 2026-11-05 리뷰).
              myTurn: canWrite && !!mine && !mine.submitted,
              incomplete: r.submittedCount < r.observerSlots,
              submitted: `${r.submittedCount}/${r.observerSlots}`,
              percent: r.averages ? r.averages.percent.toFixed(1) : null,
              grade: r.averages ? r.averages.grade : null,
            };
  });
  return (
    <div className="w-full min-w-0 space-y-5 p-6">
      <PageHeader
        eyebrow="운영"
        title="직원 평가 체크리스트"
        description={
          selfOnly
            ? "내 직원 평가에 본인 평가를 작성합니다. 평가자 채점·종합 결과는 사무실에서 관리합니다."
            : "평가 문항(4점 척도)을 평가자와 본인이 각자 채점하고 나란히 비교합니다."
        }
        embedLabel="직원 평가 체크리스트"
        actions={
          <span className="flex items-center gap-2">
            {priv.seeNames ? (
              <Button variant="outline" render={<Link href="/class-review/board" />}>
                종합 보기
              </Button>
            ) : null}
            {/* 문항 편집 자격(editTemplate)은 쓰기 권한을 보지 않는다 — 서버 저장은 둘 다 요구하므로 화면도 둘 다 본다. */}
            {priv.editTemplate && canWrite ? (
              <Button variant="outline" render={<Link href="/class-review/template" />}>
                문항 편집
              </Button>
            ) : null}
            {/* 평가 건 개설은 사무실 몫 — 강사·읽기 권한에겐 서버 액션이 거절하므로 버튼 자체를 안 그린다(#77). */}
            {selfOnly || !canWrite ? null : (
              <Button render={<Link href="/class-review/new" />}>
                + 새 평가
              </Button>
            )}
          </span>
        }
      />
      {faceTabs}

      {rows.length === 0 ? (
        <div className="border-line rounded-2xl border border-dashed p-10 text-center">
          <p className="text-text-dim text-sm">
            {selfOnly
              ? "아직 내 직원 평가 건이 없습니다 — 사무실에서 평가 건을 만들면 여기에 표시됩니다."
              : canWrite
                ? "아직 평가 건이 없습니다 — ‘새 평가’로 시작하세요."
                : "아직 평가 건이 없습니다 — 평가 건이 만들어지면 여기에 표시됩니다."}
          </p>
        </div>
      ) : (
        // 요약 먼저 — 강사 이름 목록은 눌러서(원장 2026-10-29). 자기 평가 전용(강사)은 본인 평가지뿐이라 목록 그대로.
        selfOnly ? <ReviewTable initialFilter={myFilter} rows={reviewRows} />
          : <ReviewSummaryGate rows={reviewRows}><ReviewTable initialFilter={myFilter} rows={reviewRows} /></ReviewSummaryGate>
      )}
      <p className="text-text-dim text-xs">
        {selfOnly
          ? `표시되는 점수는 본인 평가입니다 — 100점 기준 환산 · 등급 컷 ${cutsLabel}`
          : `환산점수 = 제출된 채점들의 문항 평균으로 계산한 100점 기준 점수 · 등급 컷 ${cutsLabel}`}
      </p>
    </div>
  );
}

