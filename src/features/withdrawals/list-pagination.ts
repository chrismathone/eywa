export const WITHDRAWAL_PAGE_SIZE = 8;
export const WITHDRAWAL_PAGE_MAX = 50;

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
