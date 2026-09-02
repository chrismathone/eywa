import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { FaceTabs } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { inventoryFaces, resolveInventoryTab, type InventoryTab } from "@/features/inventory/faces";
import {
  getAssets,
  getAudits,
  getInventoryCounts,
  getLoans,
  getSupplies,
  type FaceData,
  type TableStatus,
} from "@/features/inventory/server/queries";
import { actionNeededAssets, computeAssetStats } from "@/features/inventory/stats";
import type { AssetOption, InventoryAudit, InventoryLoan, InventorySupply } from "@/features/inventory/types";
import { ActionNeeded } from "./_components/action-needed";
import { AssetsFace } from "./_components/assets-face";
import { AuditsFace } from "./_components/audits-face";
import { LoansFace } from "./_components/loans-face";
import { NotReadyBanner } from "./_components/not-ready-banner";
import { StatsRow } from "./_components/stats-row";
import { SuppliesFace } from "./_components/supplies-face";

type Sp = Record<string, string | undefined>;

const TITLE_SUFFIX: Record<InventoryTab, string> = { assets: "", loans: " · 대여", audits: " · 실사", supplies: " · 소모품" };

// 면마다 문서 제목을 달리해 창 타이틀바가 "재고관리 · 대여"로 라이브 갱신된다(route-window 관찰).
// ⚠️ 접두 "재고관리"는 사이드바 라벨(navigation.ts)과 같아야 한다.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const tab = resolveInventoryTab((await searchParams).tab);
  return { title: `재고관리${TITLE_SUFFIX[tab]} — eywa` };
}

/** 활성 면의 데이터 — 자산 면은 자산 전건(항상 받는 것)만으로 그린다. */
type FaceLoad =
  | { kind: "assets"; status: TableStatus }
  | ({ kind: "loans" } & FaceData<InventoryLoan>)
  | ({ kind: "audits" } & FaceData<InventoryAudit>)
  | ({ kind: "supplies" } & FaceData<InventorySupply>);

function loadFace(tab: InventoryTab): Promise<FaceLoad> {
  switch (tab) {
    case "loans":
      return getLoans().then((r) => ({ kind: "loans", ...r }));
    case "audits":
      return getAudits().then((r) => ({ kind: "audits", ...r }));
    case "supplies":
      return getSupplies().then((r) => ({ kind: "supplies", ...r }));
    default:
      return Promise.resolve({ kind: "assets", status: "ok" });
  }
}

/**
 * 재고관리 — 전자기기 자산관리대장(원장 2026-09-02, 구글시트 개편 시안 이식). 시안의 시트 4개 = 면 4개
 * (자산 · 대여 · 실사 · 소모품). "자산 1대 = 영구 행 1개"라 상단 스탯은 수기 숫자가 아니라 **자산 표에서 센다**.
 *
 * 접근 = `inventory` 메뉴(사무실 full / 회계 readonly). 쓰기 판정은 화면·액션이 **같은 함수**(canWriteTenant)를
 * 쓴다([[#77]] — UI 조건은 게이트가 아니다). 표가 아직 없으면(0242a 미적용) 화면은 살고 편집만 잠긴다([[#95]]).
 * 자산 전건은 면과 무관하게 받는다 — 스탯·조치 목록·대여/실사 다이얼로그의 자산 선택이 전부 그걸 읽는다.
 * 다른 면(대여·실사·소모품)은 **활성 면의 것만** 받고, 탭 배지용 건수 4개는 head 카운트로 함께 받는다(B2·B4).
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const user = await requireAccess("inventory");
  const tab = resolveInventoryTab((await searchParams).tab);

  // 서로 독립 — 함께 받는다(B4).
  const [canWrite, counts, assets, face] = await Promise.all([
    canWriteTenant(user.systemRole, "inventory"),
    getInventoryCounts(),
    getAssets(),
    loadFace(tab),
  ]);

  // 표 없음(missing-table)이 그냥 실패보다 먼저 — 원인을 말하는 문구가 뜬다.
  const status: TableStatus =
    assets.status === "missing-table" || face.status === "missing-table"
      ? "missing-table"
      : assets.status === "failed" || face.status === "failed"
        ? "failed"
        : "ok";
  const editable = canWrite && status === "ok";
  const stats = computeAssetStats(assets.rows);
  const action = actionNeededAssets(assets.rows);
  const today = kstToday();
  const assetOptions: AssetOption[] = assets.rows.map((a) => ({
    id: a.id, assetCode: a.assetCode, category: a.category, model: a.model, status: a.status, location: a.location,
  }));

  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <PageHeader
        eyebrow="운영"
        title="재고관리"
        description="자산 1대 = 영구 행 1개. 월별 시트 복사 대신 대여·실사 이력을 누적합니다."
        embedLabel="전자기기 자산관리대장 — 자산 · 대여 · 실사 · 소모품"
        stats={<StatsRow stats={stats} />}
      />
      <NotReadyBanner status={status} />
      {action.length > 0 ? <ActionNeeded assets={action} /> : null}
      <FaceTabs faces={inventoryFaces(counts)} active={tab} ariaLabel="재고관리 면 전환" />
      {face.kind === "assets" ? <AssetsFace assets={assets.rows} canWrite={editable} today={today} /> : null}
      {face.kind === "loans" ? <LoansFace loans={face.rows} assets={assetOptions} canWrite={editable} today={today} /> : null}
      {face.kind === "audits" ? <AuditsFace audits={face.rows} assets={assetOptions} canWrite={editable} today={today} /> : null}
      {face.kind === "supplies" ? (
        <SuppliesFace supplies={face.rows} canWrite={editable} today={today} userName={user.displayName} />
      ) : null}
    </div>
  );
}
