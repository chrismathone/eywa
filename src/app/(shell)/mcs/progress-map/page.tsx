import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { MathProgressDashboard } from "@/features/math-progress-map/components/math-progress-dashboard";
import { buildSampleProgress } from "@/features/math-progress-map/sample";
import { canPreviewProgressMap } from "@/features/math-progress-map/server/access";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata: Metadata = { title: "수학 학습 진도맵 — eywa" };

/**
 * 수학 학습 진도맵(시안) — **숨은 기능**(원장 2026-09-14). 공개 범위는 2026-09-16에 **관리자 이상**으로 넓혔다
 * (*"진도맵 시안을 모든 관리자이상에게 공개"* — 그전엔 계정 하나). 사이드바·메뉴·팰릿에 없고, MCS 랜딩 머리의 링크와 직접 주소로만 열린다.
 * 게이트 둘: ① 수학 강사 시트 권한(`mcs`) ② 공개 범위(`canPreviewProgressMap`, super_admin 통과) — 밖은 404.
 * 데이터는 아직 **샘플**(김민준, 2026-09-16 기준)이다 — 실데이터 어댑터는 후속.
 */
export default async function ProgressMapPage() {
  await requireAccess("mcs");
  if (!(await canPreviewProgressMap())) notFound();
  const progress = buildSampleProgress();
  return (
    <div className="flex flex-col gap-4">
      <div className="compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title="수학 학습 진도맵"
          description="학생 한 명의 연간 커리큘럼 위치 — 시안(샘플 데이터)"
        />
      </div>
      <MathProgressDashboard progress={progress} />
    </div>
  );
}
