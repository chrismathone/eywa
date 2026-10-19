import {
  Toolbar,
  ToolbarSegment,
  ToolbarSegmentItem,
} from "@/components/toolbar";

/**
 * 학원 상세 **내부 탭** — 계정·기능·기본 정보를 한 화면에 쌓아 두니 계정 63명 표 아래로
 * 라이선스 카드까지 한참 내려가야 했다(원장 2026-09-26 *"스크롤 관리하지말고 지점 별 내부 관리탭
 * 만들어서 탭별로 관리가능하게 너무 스크롤 심해서 힘듬"*). 탭은 주소(`?tab=`)에 남아 새로고침·
 * 목록의 바로가기(계정·기능·설정)가 그 탭으로 바로 연다.
 */
export const TENANT_TABS = [
  { key: "accounts", label: "계정" },
  { key: "license", label: "기능·라이선스" },
  { key: "ai", label: "AI 모델" },
  { key: "settings", label: "기본 정보" },
] as const;

export type TenantTab = (typeof TENANT_TABS)[number]["key"];

export function parseTenantTab(raw: string | undefined): TenantTab {
  return TENANT_TABS.some((t) => t.key === raw)
    ? (raw as TenantTab)
    : "accounts";
}

export function tenantTabHref(tenantId: string, tab: TenantTab): string {
  return tab === "accounts"
    ? `/super-admin/tenants/${tenantId}`
    : `/super-admin/tenants/${tenantId}?tab=${tab}`;
}

export function TenantTabs({
  tenantId,
  active,
  counts,
}: {
  tenantId: string;
  active: TenantTab;
  /** 탭 이름 옆 작은 숫자(예: 계정 63). */
  counts?: Partial<Record<TenantTab, number>>;
}) {
  return (
    <Toolbar>
      <ToolbarSegment>
        {TENANT_TABS.map((t) => (
          <ToolbarSegmentItem
            key={t.key}
            active={active === t.key}
            href={tenantTabHref(tenantId, t.key)}
          >
            {t.label}
            {counts?.[t.key] !== undefined ? (
              <span className="num ml-1 opacity-70">{counts[t.key]}</span>
            ) : null}
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
    </Toolbar>
  );
}
