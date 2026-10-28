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
  getVendors,
  type FaceData,
  type TableStatus,
} from "@/features/inventory/server/queries";
import { getInventoryCategories } from "@/features/inventory/server/category-queries";
import { canViewVendorsNow } from "@/features/inventory/server/vendor-gate";
import { loadInventoryPrefs } from "@/features/inventory/server/prefs";
import { actionNeededAssets, computeAssetStats } from "@/features/inventory/stats";
import type { AssetOption, InventoryAudit, InventoryLoan, InventorySupply, InventoryVendor } from "@/features/inventory/types";
import { ActionNeeded } from "./_components/action-needed";
import { AssetsFace } from "./_components/assets-face";
import { AuditsFace } from "./_components/audits-face";
import { InventoryCategoriesProvider } from "./_components/categories-context";
import { LoansFace } from "./_components/loans-face";
import { NotReadyBanner } from "./_components/not-ready-banner";
import { StatsRow } from "./_components/stats-row";
import { SuppliesFace } from "./_components/supplies-face";
import { VendorsFace } from "./_components/vendors-face";

type Sp = Record<string, string | undefined>;

const TITLE_SUFFIX: Record<InventoryTab, string> = { assets: "", loans: " · 대여", audits: " · 실사", supplies: " · 소모품", vendors: " · 업체리스트" };

// 면마다 문서 제목을 달리해 창 타이틀바가 "재고관리 · 대여"로 라이브 갱신된다(route-window 관찰).
// ⚠️ 접두 "재고관리"는 사이드바 라벨(navigation.ts)과 같아야 한다.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const asked = resolveInventoryTab((await searchParams).tab);
  // 업체리스트를 못 보는 사람에겐 창 제목에도 안 적는다(본문은 자산 면으로 떨어진다).
  const tab = asked === "vendors" && !(await canViewVendorsNow()) ? "assets" : asked;
  return { title: `재고관리${TITLE_SUFFIX[tab]} — 에이와` };
}

/** 활성 면의 데이터 — 자산 면은 자산 전건(항상 받는 것)만으로 그린다. */
type FaceLoad =
  /**
   * 자산 면도 **대여 기록을 함께 받는다** — 장부와 자산 상태가 어긋난 것을 표시하고(원장 2026-09-08
   * *"연동 가능하게 배선해야할듯"*), 대여 중인 자산의 사용자 편집을 막는 재료다.
   * 🔴 조회에 실패하면 **빈 배열이 아니라 null** — 빈 배열로 삼키면 열린 대여가 있는 자산이 전부
   *    '어긋남'으로 보인다(없는 사실을 만드는 쪽이 훨씬 나쁘다).
   */
  | { kind: "assets"; status: TableStatus; loans: InventoryLoan[] | null }
  | ({ kind: "loans" } & FaceData<InventoryLoan>)
  | ({ kind: "audits" } & FaceData<InventoryAudit>)
  | ({ kind: "supplies" } & FaceData<InventorySupply>)
  | ({ kind: "vendors" } & FaceData<InventoryVendor>);

function loadFace(tab: InventoryTab): Promise<FaceLoad> {
  switch (tab) {
    case "loans":
      return getLoans().then((r) => ({ kind: "loans", ...r }));
    case "audits":
      return getAudits().then((r) => ({ kind: "audits", ...r }));
    case "supplies":
      return getSupplies().then((r) => ({ kind: "supplies", ...r }));
    case "vendors":
      return getVendors().then((r) => ({ kind: "vendors", ...r }));
    default:
      return getLoans().then((r) => ({
        kind: "assets" as const,
        // 자산 면의 준비 상태는 자산 표가 정한다 — 대여 조회 실패가 자산 화면을 잠그지 않는다.
        status: "ok" as TableStatus,
        loans: r.status === "ok" ? r.rows : null,
      }));
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
  // 업체리스트 열람 게이트(재고관리를 여는 직원 전원, 2026-10-28) — 아니면 `?tab=vendors`로 와도 자산 면으로 떨어진다(주소 우회 차단, [[#77]]).
  const showVendors = await canViewVendorsNow();
  const asked = resolveInventoryTab((await searchParams).tab);
  const tab: InventoryTab = asked === "vendors" && !showVendors ? "assets" : asked;

  // 서로 독립 — 함께 받는다(B4).
  const [canWrite, counts, assets, face, prefs, categories] = await Promise.all([
    canWriteTenant(user.systemRole, "inventory"),
    getInventoryCounts(),
    getAssets(),
    loadFace(tab),
    // 보기 설정(폐기 숨김) — 계정 귀속(users.ui_prefs.inventory).
    loadInventoryPrefs(),
    // 자산 분류(0247a) — 라벨·접두·순서의 단일 소스. 표가 없으면 내장 7종으로 폴백한다([[#95]]).
    getInventoryCategories(),
  ]);

  // 표 없음(missing-table)이 그냥 실패보다 먼저 — 원인을 말하는 문구가 뜬다.
  // 🔑 업체리스트는 **다른 마이그레이션**(0448a)의 표라 따로 센다 — 섞으면 "0242a를 적용하라"는 거짓 배너가 뜬다.
  const faceStatus: TableStatus = face.kind === "vendors" ? "ok" : face.status;
  const status: TableStatus =
    assets.status === "missing-table" || faceStatus === "missing-table"
      ? "missing-table"
      : assets.status === "failed" || faceStatus === "failed"
        ? "failed"
        : "ok";
  // 🔴 분류 조회 **실패**도 편집을 잠근다 — 그 상태의 드롭다운은 내장 7종 폴백이라 학원이 추가한 분류를 못 고르고,
  //    수정 저장 한 번이 분류를 조용히 바꾼다. (표 없음 = 0247a 이전이라 폴백이 곧 사실이므로 안 잠근다.)
  const editable = canWrite && status === "ok" && categories.status !== "failed";
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
      <NotReadyBanner status={status} categoryStatus={categories.status} vendorStatus={face.kind === "vendors" ? face.status : undefined} />
      {action.length > 0 ? <ActionNeeded assets={action} categories={categories.rows} /> : null}
      <FaceTabs faces={inventoryFaces(counts, { showVendors })} active={tab} ariaLabel="재고관리 면 전환" />
      {/* 분류는 클라 컴포넌트 여럿(표·툴바·다이얼로그 4개)이 읽으므로 prop 배선 대신 프로바이더 하나로 준다. */}
      <InventoryCategoriesProvider categories={categories.rows}>
        {face.kind === "assets" ? (
          <AssetsFace
            assets={assets.rows}
            loans={face.loans}
            canWrite={editable}
            today={today}
            hideDisposed={prefs.hideDisposed}
          />
        ) : null}
        {face.kind === "loans" ? <LoansFace loans={face.rows} assets={assetOptions} canWrite={editable} today={today} /> : null}
        {face.kind === "audits" ? <AuditsFace audits={face.rows} assets={assetOptions} canWrite={editable} today={today} /> : null}
        {face.kind === "vendors" ? <VendorsFace vendors={face.rows} canWrite={canWrite && face.status === "ok"} /> : null}
        {face.kind === "supplies" ? (
          <SuppliesFace supplies={face.rows} canWrite={editable} today={today} userName={user.displayName} />
        ) : null}
      </InventoryCategoriesProvider>
    </div>
  );
}
