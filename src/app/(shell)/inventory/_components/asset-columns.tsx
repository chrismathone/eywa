import type { CategoryMaps } from "@/features/inventory/category";
import { assetStatusLabel } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { DashCell, UnknownCell } from "./cell-bits";
import type { Column } from "./sortable-table";
import { AssetStatusPill } from "@/features/inventory/components/status-pill";

/**
 * 자산 마스터 열 — 시안 그대로 `자산ID · 분류 · 제조사 · 모델명 · 입고일 · 상태 · 현위치 · 사용자 · 최종실사 · 폐기일 · 비고`
 * + **QR**(원장 2026-09-02: *"QR 열 하나 더 비고 옆에 추가 · 보기 버튼 누르면 QR 보여줘"*).
 * 시리얼번호는 컬럼만 있고 열로 내지 않는다(원본 전건 비어 있어 빈 열이 된다 — 폼에서만 적는다).
 * "미기재" 규약: 제조사·모델명·입고일 = 미기재 / 사용자·최종실사·폐기일·현위치 = —(빈 값은 가운데 정렬).
 * 폭은 `colgroup` 고정(모델명·비고만 가변) — 필터로 행이 바뀌어도 열이 안 밀린다.
 * `onStatusDoubleClick` — 상태 칸 더블클릭 = 상태 변경. `onQrClick` — QR 열 [보기].
 */
export function assetColumns(
  /** 분류 라벨 단일 소스(0247a) — 화면이 라벨 표를 다시 갖지 않는다. */
  cats: CategoryMaps,
  opts: {
    /** 자산 마스터 순서의 고정 번호(1부터) — 정렬·필터해도 그 자산의 번호는 그대로(라벨 인쇄 범위가 이 번호를 가리킨다). */
    noOf?: (a: InventoryAsset) => number | null;
    onStatusDoubleClick?: (a: InventoryAsset) => void;
    /** 사용자 칸 더블클릭 = 사용자 지정(원장 2026-09-08). */
    onHolderDoubleClick?: (a: InventoryAsset) => void;
    /** 대여 장부와 어긋난 자산인가 — 상태 칸에 표식을 단다(판정은 `loan-link.ts`). */
    mismatchOf?: (a: InventoryAsset) => { expected: string; reason: string } | null;
    onQrClick?: (a: InventoryAsset) => void;
  } = {},
): Column<InventoryAsset>[] {
  return [
    { key: "no", label: "No", width: 56, render: (a) => <span className="num text-text-dim">{opts.noOf?.(a) ?? ""}</span>, sortValue: (a) => opts.noOf?.(a) ?? null, className: "whitespace-nowrap" },
    { key: "assetCode", label: "자산ID", width: 88, render: (a) => <span className="font-mono text-xs font-bold">{a.assetCode}</span>, className: "whitespace-nowrap" },
    { key: "category", label: "분류", width: 78, render: (a) => cats.labelOf(a.category), sortValue: (a) => cats.labelOf(a.category), className: "whitespace-nowrap" },
    { key: "maker", label: "제조사", width: 96, render: (a) => <UnknownCell v={a.maker} />, className: "whitespace-nowrap" },
    { key: "model", label: "모델명", minWidth: 150, render: (a) => <UnknownCell v={a.model} />, className: "whitespace-nowrap" },
    { key: "acquiredOn", label: "입고일", width: 100, render: (a) => <UnknownCell v={a.acquiredOn} num />, className: "whitespace-nowrap" },
    {
      key: "status", label: "상태", width: 92,
      // 🔴 어긋난 자산은 상태 옆에 `!` — 색을 바꾸지 않는다(상태 색은 그 상태의 뜻이라 건드리면 거짓이 된다).
      render: (a) => {
        const m = opts.mismatchOf?.(a) ?? null;
        return (
          <span className="inline-flex items-center gap-1">
            <AssetStatusPill status={a.status} />
            {m ? (
              <span
                className="text-amber text-xs font-bold"
                title={`${m.reason} — 상태 칸을 더블클릭해 맞출 수 있습니다`}
              >
                !
              </span>
            ) : null}
          </span>
        );
      },
      sortValue: (a) => assetStatusLabel(a.status),
      className: "whitespace-nowrap",
      onDoubleClick: opts.onStatusDoubleClick,
    },
    // 폐기 자산은 값이 남아 있어도 "—"(브리프 규약) — 지난 위치는 수정 폼에서 보인다.
    { key: "location", label: "현위치", width: 128, render: (a) => <DashCell v={a.status === "disposed" ? null : a.location} />, sortValue: (a) => (a.status === "disposed" ? null : a.location), className: "whitespace-nowrap" },
    {
      key: "holderName", label: "사용자", width: 88,
      render: (a) => <DashCell v={a.holderName} />,
      className: "whitespace-nowrap",
      onDoubleClick: opts.onHolderDoubleClick,
    },
    { key: "lastAuditedOn", label: "최종실사", width: 100, render: (a) => <DashCell v={a.lastAuditedOn} num />, className: "whitespace-nowrap" },
    { key: "disposedOn", label: "폐기일", width: 100, render: (a) => <DashCell v={a.disposedOn} num />, className: "whitespace-nowrap" },
    { key: "note", label: "비고", minWidth: 160, render: (a) => <span className="text-text-dim" title={a.note ?? undefined}>{a.note ?? ""}</span>, className: "whitespace-nowrap" },
    {
      key: "qr", label: "QR", width: 64,
      // QR은 자산ID에서 파생하므로 새 자산도 자동으로 있다 — 정렬 값은 없음(전부 같다).
      render: (a) =>
        opts.onQrClick ? (
          <button type="button" className="text-primary block w-full text-center text-xs font-medium hover:underline" onClick={() => opts.onQrClick?.(a)}>
            보기
          </button>
        ) : null,
      sortValue: () => null,
      className: "whitespace-nowrap",
    },
  ];
}
