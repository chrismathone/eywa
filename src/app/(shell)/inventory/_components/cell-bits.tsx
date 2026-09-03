import { dashIfEmpty, unknownIfEmpty } from "@/features/inventory/unknown-value";

/**
 * 표 칸의 값/빈칸 표기 — 빈 값은 **가운데 정렬**로 `—`(또는 `미기재`)를 옅게 그린다
 * (원장 2026-09-02: *"없을 경우 가운데 중앙정렬로 - 표시할것"*). 값이 있으면 좌측 정렬 그대로(데이터 표 규약).
 */
export function EmptyCell({ label }: { label: string }) {
  return <span className="text-text-faint block text-center">{label}</span>;
}

/** 비어 있는 게 정상인 칸(사용자·폐기일·최종실사·현위치 등) — 빈 값은 `—`. */
export function DashCell({ v, num = false }: { v: string | null | undefined; num?: boolean }) {
  return v ? <span className={num ? "num" : ""}>{v}</span> : <EmptyCell label={dashIfEmpty(null)} />;
}

/** 알아야 하는데 모르는 칸(제조사·모델명·입고일 등) — 빈 값은 `미기재`. */
export function UnknownCell({ v, num = false }: { v: string | null | undefined; num?: boolean }) {
  return v ? <span className={num ? "num" : ""}>{v}</span> : <EmptyCell label={unknownIfEmpty(null)} />;
}
