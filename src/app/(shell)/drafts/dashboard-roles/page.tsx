import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { RoleDraftBoard } from "./_components/board";
import { BundleSummary } from "./_components/bundle-summary";
import { Research } from "./_components/research";
import { BUNDLES, type BundleId } from "./_data/bundles";
import { getDraftViewer } from "./_server/access";

/**
 * 역할별 운영실 시안 — 원장 지시(2026-10-01) *"원장 이외에 보면 안되는 세부 데이터들을 관리자나 실장 등
 * 일부 직원에게 노출하면 안되기 때문"*. 목적은 **노출 통제**다(모양만 다른 대시보드가 아니다).
 *
 * 🔴 숨은 시안: 원장 + 슈퍼관리자만(범위 밖은 없는 주소와 똑같이 `notFound()`), 메뉴·사이드바 미노출.
 * 🔴 업무 데이터를 읽지 않는다 — 시안 숫자·이름은 `_data/fake.ts`의 가짜 값. 조사 요약(`_data/research.ts`,
 *    server-only)은 침산 실측 건수라 침산 원장·슈퍼관리자에게만, 서버가 그려서 넘긴다.
 */
export default async function DashboardRoleDraftsPage() {
  const viewer = await getDraftViewer();
  if (!viewer) notFound();
  const summaries = Object.fromEntries(
    BUNDLES.map((b) => [b.id, <BundleSummary key={b.id} bundle={b} viewer={viewer} />]),
  ) as Record<BundleId, ReactNode>;
  const research = viewer.research ? (
    <Research superAdmin={viewer.superAdmin} />
  ) : (
    <p className="bg-card shadow-card rounded-2xl px-4 py-3 text-sm">
      조사 요약은 다른 지점의 실측 자료라 이 지점에선 보이지 않는다. 위에서 역할 묶음을 골라 시안을 본다.
    </p>
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="숨은 시안 · 원장 · 슈퍼관리자만"
        title="역할별 운영실 시안"
        description="원장만 볼 세부 데이터가 다른 직원에게 새지 않게 — 역할과 담당 과목에 맞춘 운영실 시안 20개. 시안의 숫자·이름은 전부 가짜다."
        embedLabel="역할별 운영실 시안 · 가짜 데이터"
      />
      <RoleDraftBoard research={research} summaries={summaries} />
    </div>
  );
}
