import { MAKEUP_EVIDENCE } from "../status";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const show = (value: unknown) => typeof value === "number" || typeof value === "string" ? String(value) : "확인 필요";
const BASIS: Record<string, string> = { attendance_units: "출결 시수 합산", days: "서로 다른 출결 날짜", none: "청구 회차 없음", unknown: "기준 확인 필요" };

export function ReconciliationDetail({ kind, value, restricted = false }: { kind: unknown; value: unknown; restricted?: boolean }) {
  const detail = record(value);
  if (kind === "billing_review" && restricted) return <p className="text-sm">수납 확인 권한이 있는 직원이 상세 근거를 확인할 수 있습니다.</p>;
  if (kind === "billing_review") return <><dl className="grid gap-2 text-sm sm:grid-cols-2">
    <div><dt className="font-medium">청구 소비 기준</dt><dd>{BASIS[String(detail.quantity_basis)] ?? "확인 필요"}</dd></div>
    <div><dt className="font-medium">예상 추가 소비</dt><dd>{show(detail.expected_consumption)}</dd></div>
    <div><dt className="font-medium">원수업일</dt><dd>{Array.isArray(detail.original_dates) ? detail.original_dates.filter(item => typeof item === "string").join(" · ") || "미정" : "미정"}</dd></div>
    <div><dt className="font-medium">실시 날짜</dt><dd>{show(detail.session_date)}</dd></div>
  </dl><p className="text-sm">월 경계·분할 실시가 회차 소비에 미치는 영향을 확인합니다. 이 항목은 청구액을 자동 변경하지 않습니다.</p></>;
  if (kind === "units_mismatch" || kind === "units_review") return <dl className="grid gap-2 text-sm sm:grid-cols-3">
    <div><dt className="font-medium">저장 시수</dt><dd>{show(detail.actual_units ?? detail.manual_units ?? detail.session_units)}</dd></div>
    <div><dt className="font-medium">예상 보강 시수</dt><dd>{show(detail.expected_makeup_units)}</dd></div>
    <div><dt className="font-medium">예상 정규·보강 합</dt><dd>{show(detail.expected_units ?? detail.expected_total_units)}</dd></div>
  </dl>;
  return typeof detail.code === "string" ? <p className="text-sm">{MAKEUP_EVIDENCE[detail.code] ?? "연결된 출결·보고서·실시 근거를 확인해 주세요."}</p> : null;
}
