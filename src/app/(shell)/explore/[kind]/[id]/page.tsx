import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { isExploreKind, parseTrail } from "@/features/explore/model";
import { loadExploreCenter, resolveTrailLabels } from "@/features/explore/server/queries";
import { ExploreView } from "@/features/explore/components/explore-view";
import { ExploreNotice } from "@/features/explore/components/explore-landing";

export const metadata = { title: "연결 탐색 — 에이와" };

/**
 * 연결 탐색 — `/explore/<student|class|teacher>/<id>?t=<이전 중심들>&sector=<조각>`.
 * 종류별 메뉴 권한(원생 = 원생목록 · 수업/강사 = 수업목록)을 먼저 지나고, 대상 자체의 스코프(담당 학생·담당 반·본인)는
 * 조회([`loadExploreCenter`](src/features/explore/server/queries.ts))가 기존 게이트로 가른다. 수납·직원 정보 등은 조각 단위로 또 가린다.
 */
export default async function ExploreCenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ t?: string; sector?: string }>;
}) {
  const { kind, id } = await params;
  if (!isExploreKind(kind)) notFound();
  await requireAccess(kind === "student" ? "students" : "classes");
  const sp = await searchParams;
  const trailItems = parseTrail(sp.t).filter((t) => !(t.kind === kind && t.id === id));
  const [load, trail] = await Promise.all([loadExploreCenter(kind, id), resolveTrailLabels(trailItems)]);
  if (load.state === "notfound") notFound();
  if (load.state === "forbidden") return <ExploreNotice title="열람할 수 없는 대상입니다" message={load.reason} />;
  return <ExploreView key={`${kind}:${id}`} model={load.model} trail={trail} initialSector={typeof sp.sector === "string" ? sp.sector : null} />;
}
