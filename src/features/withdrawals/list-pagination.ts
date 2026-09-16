export const WITHDRAWAL_PAGE_SIZE = 8;
export const WITHDRAWAL_PAGE_MAX = 50;
/**
 * 창에 맞춘 행 수의 **하한**(앱 공용 `PAGE_SIZE_MIN`과 같은 값).
 *
 * 🔴 창 높이로 재면 최소 창(`ROUTE_WINDOW_SIZE.withdrawals` 1040×720)에선 목록 위 KPI·툴바·차트가
 *    ~520px을 먹어 남는 자리가 한 행도 안 된다 → 1행짜리 목록이 되어 459명을 459쪽으로 넘기게 된다.
 *    거기선 조금 스크롤되는 편이 낫다. ⚠️ `fitWithdrawalRows`의 `max(1, …)`은 그대로 둔다(순수 계산의 바닥).
 */
export const WITHDRAWAL_PAGE_MIN = 5;

export function withdrawalPageSize(raw: string | number | undefined): number {
  const size = Number(raw);
  return Number.isFinite(size) && size > 0
    ? Math.min(WITHDRAWAL_PAGE_MAX, Math.max(1, Math.floor(size)))
    : WITHDRAWAL_PAGE_SIZE;
}

export function fitWithdrawalRows(height: number, chrome: number, rowHeight: number): number {
  if (!Number.isFinite(height + chrome + rowHeight) || rowHeight <= 0) return WITHDRAWAL_PAGE_SIZE;
  return Math.min(WITHDRAWAL_PAGE_MAX, Math.max(1, Math.floor((height - chrome) / rowHeight)));
}

export function withdrawalPage(raw: string | undefined, total: number, size: number) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const requested = Number(raw);
  const page = Number.isFinite(requested) ? Math.min(totalPages, Math.max(1, Math.floor(requested))) : 1;
  return { page, totalPages, start: (page - 1) * size, end: Math.min(page * size, total) };
}
