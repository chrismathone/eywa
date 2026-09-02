import { Pill } from "@/components/atoms/pill";
import { auditResultMeta } from "@/features/inventory/audit-result";
import { loanStatusMeta } from "@/features/inventory/loan-status";
import { assetStatusMeta } from "@/features/inventory/status";

/** 상태 배지 3종 — 라벨·색은 features/inventory의 단일 소스(tone)에서 온다. 화면에 로컬 맵을 두지 않는다. */
export function AssetStatusPill({ status }: { status: string }) {
  const m = assetStatusMeta(status);
  return <Pill color={m.color}>{m.label}</Pill>;
}

export function LoanStatusPill({ status }: { status: string }) {
  const m = loanStatusMeta(status);
  return <Pill color={m.color}>{m.label}</Pill>;
}

export function AuditResultPill({ result }: { result: string }) {
  const m = auditResultMeta(result);
  return <Pill color={m.color}>{m.label}</Pill>;
}
