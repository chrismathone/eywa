import { allocationCoverage } from "@/features/billing/session-terms/allocation";

/** 불완전한 금액은 일치/정상 색으로 표시하지 않는다. 저장 금액 자체는 호출부가 그대로 표시한다. */
export function AllocationMoney({
  value,
  missingPriceRows,
  pricedRows,
  missingConfirmedRows = 0,
  difference = false,
}: {
  value: number;
  missingPriceRows: number;
  pricedRows: number;
  missingConfirmedRows?: number;
  difference?: boolean;
}) {
  const coverage = allocationCoverage({ missingPriceRows, pricedRows });
  if (difference && missingConfirmedRows > 0)
    return <span className="text-amber text-sm" title={`확정 금액 ${missingConfirmedRows}건 미계산`}>미계산</span>;
  if (coverage === "unavailable" || (difference && coverage === "partial"))
    return (
      <span
        className="text-amber text-sm"
        title={`단가 미입력 ${missingPriceRows}건`}
      >
        미계산
      </span>
    );
  const tone =
    coverage === "partial"
      ? "text-amber"
      : !difference
        ? ""
        : value === 0
          ? "text-green"
          : value > 0
            ? "text-danger"
            : "text-amber";
  return (
    <span className={tone}>
      {value > 0 && difference ? "+" : ""}
      {value.toLocaleString("ko-KR")}원
      {coverage === "partial" ? (
        <span
          className="ml-1 whitespace-nowrap text-xs"
          title={`단가 미입력 ${missingPriceRows}건 제외`}
        >
          일부 집계
        </span>
      ) : null}
    </span>
  );
}
