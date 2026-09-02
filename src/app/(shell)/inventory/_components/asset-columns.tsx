import { assetCategoryLabel } from "@/features/inventory/category";
import { assetStatusLabel } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { dashIfEmpty, unknownIfEmpty } from "@/features/inventory/unknown-value";
import type { Column } from "./sortable-table";
import { AssetStatusPill } from "./status-pill";

/**
 * 자산 마스터 열 — 시안 그대로 `자산ID · 분류 · 제조사 · 모델명 · 입고일 · 상태 · 현위치 · 사용자 · 최종실사 · 폐기일 · 비고`.
 * 시리얼번호는 컬럼만 있고 열로 내지 않는다(원본 전건 비어 있어 빈 열이 된다 — 폼에서만 적는다).
 * "미기재" 규약: 제조사·모델명·입고일 = 미기재 / 사용자·최종실사·폐기일·현위치 = —.
 */
export function assetColumns(): Column<InventoryAsset>[] {
  return [
    { key: "assetCode", label: "자산ID", render: (a) => <span className="font-mono text-[11.5px] font-bold">{a.assetCode}</span>, className: "whitespace-nowrap" },
    { key: "category", label: "분류", render: (a) => assetCategoryLabel(a.category), sortValue: (a) => assetCategoryLabel(a.category), className: "whitespace-nowrap" },
    { key: "maker", label: "제조사", render: (a) => <Unknown v={a.maker} />, className: "whitespace-nowrap" },
    { key: "model", label: "모델명", render: (a) => <Unknown v={a.model} />, className: "min-w-32" },
    { key: "acquiredOn", label: "입고일", render: (a) => <Unknown v={a.acquiredOn} num />, className: "whitespace-nowrap" },
    { key: "status", label: "상태", render: (a) => <AssetStatusPill status={a.status} />, sortValue: (a) => assetStatusLabel(a.status), className: "whitespace-nowrap" },
    // 폐기 자산은 값이 남아 있어도 "—"(브리프 규약) — 지난 위치는 수정 폼에서 보인다.
    { key: "location", label: "현위치", render: (a) => <Dash v={a.status === "disposed" ? null : a.location} />, sortValue: (a) => (a.status === "disposed" ? null : a.location), className: "whitespace-nowrap" },
    { key: "holderName", label: "사용자", render: (a) => <Dash v={a.holderName} />, className: "whitespace-nowrap" },
    { key: "lastAuditedOn", label: "최종실사", render: (a) => <Dash v={a.lastAuditedOn} num />, className: "whitespace-nowrap" },
    { key: "disposedOn", label: "폐기일", render: (a) => <Dash v={a.disposedOn} num />, className: "whitespace-nowrap" },
    { key: "note", label: "비고", render: (a) => <span className="text-text-dim">{a.note ?? ""}</span>, className: "min-w-40" },
  ];
}

function Unknown({ v, num = false }: { v: string | null; num?: boolean }) {
  const s = unknownIfEmpty(v);
  return v ? <span className={num ? "num" : ""}>{s}</span> : <span className="text-text-faint">{s}</span>;
}

function Dash({ v, num = false }: { v: string | null; num?: boolean }) {
  const s = dashIfEmpty(v);
  return v ? <span className={num ? "num" : ""}>{s}</span> : <span className="text-text-faint">{s}</span>;
}
