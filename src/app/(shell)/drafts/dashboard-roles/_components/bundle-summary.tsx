/**
 * 묶음 한 줄 — 누구·몇 명 · 보이는 범위 · 빼는 범위. **서버 컴포넌트**다.
 * 실측 인원(`BUNDLE_PEOPLE`, server-only)이 클라이언트 번들에 실리지 않게 서버가 그려 보드에 넘긴다.
 * 조사 요약을 못 보는 사람(다른 지점 원장)에겐 인원 줄을 빼고, 슈퍼관리자 계정은 슈퍼관리자에게만 센다.
 */
import type { Bundle } from "../_data/bundles";
import { BUNDLE_PEOPLE } from "../_data/research";
import type { DraftViewer } from "../_server/access";

export function BundleSummary({ bundle, viewer }: { bundle: Bundle; viewer: DraftViewer }) {
  const p = BUNDLE_PEOPLE[bundle.id];
  const people = viewer.research ? (viewer.superAdmin ? (p.withSuperAdmin ?? p.base) : p.base) : null;
  return (
    <div className="bg-card shadow-card grid gap-3 rounded-2xl px-4 py-3 text-sm lg:grid-cols-[1.2fr_1fr_1.4fr]">
      <div>
        <p className="text-xs font-bold">누구{people ? " · 몇 명" : ""}</p>
        <p className="font-bold">{bundle.rule}</p>
        {people ? <p>{people}</p> : null}
      </div>
      <div>
        <p className="text-xs font-bold">보이는 범위</p>
        <p>{bundle.sees}</p>
      </div>
      <div>
        <p className="text-xs font-bold">빼는 범위</p>
        <p>{bundle.hides}</p>
      </div>
    </div>
  );
}
