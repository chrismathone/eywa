import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { buildGroupModel, isExploreKind, isSectorKeyShape, parseTrail, sameCenter } from "@/features/explore/model";
import { loadExploreCenter, resolveTrailLabels } from "@/features/explore/server/queries";
import { ExploreView } from "@/features/explore/components/explore-view";
import { ExploreNotice } from "@/features/explore/components/explore-landing";
import { parseExplorePrefs } from "@/features/explore/view-prefs";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";

export const metadata = { title: "연결 탐색 — 에이와" };

/**
 * 영역 중심(2단계 도넛) — `/explore/<종류>/<id>/<영역>`: 실제 대상의 조각 하나(출결·상담·수학 …)를 가운데 놓고 그 항목들을 주변에 펼친다
 * (원장 2026-11-03 *"전부 다 더블클릭 흡수 동작"*). 조회·권한은 1단계와 **같은 모델**에서 자른다(`buildGroupModel`) — 숫자·문구가 같다.
 */
export default async function ExploreGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string; sector: string }>;
  searchParams: Promise<{ t?: string; sector?: string }>;
}) {
  const { kind, id, sector: rawSector } = await params;
  // Next 16은 경로 매개변수를 디코딩하지 않는다 — `subject:math`가 `subject%3Amath`로 온다. 못 푸는 글자는 없는 주소.
  const sector = decodeSegment(rawSector);
  if (!isExploreKind(kind) || sector === null || !isSectorKeyShape(sector)) notFound();
  await requireAccess(kind === "student" ? "students" : "classes");
  const sp = await searchParams;
  const self = { kind, id, sector };
  const trailItems = parseTrail(sp.t).filter((t) => !sameCenter(t, self));
  const [load, trail, uiPrefs] = await Promise.all([loadExploreCenter(kind, id), resolveTrailLabels(trailItems), readMyUiPrefs()]);
  if (load.state === "notfound") notFound();
  if (load.state === "forbidden") return <ExploreNotice title="열람할 수 없는 대상입니다" message={load.reason} />;
  const group = buildGroupModel(load.model, sector);
  if (!group) notFound();
  return (
    <ExploreView
      key={`${kind}:${id}:${sector}`}
      model={group}
      trail={trail}
      initialSector={typeof sp.sector === "string" ? sp.sector : null}
      prefs={parseExplorePrefs(uiPrefs.explore)}
      contribution={null}
      facts={null}
    />
  );
}

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
