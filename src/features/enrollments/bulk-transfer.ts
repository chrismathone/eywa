import type { BulkCandidate } from "./bulk-assign";

export const BULK_TRANSFER_MAX = 100;
export const TRANSFER_UNKNOWN = "이동 결과를 확인하지 못했습니다. 학생의 수강 내역을 확인한 뒤 목록을 새로 불러와 주세요.";

/** 수강에는 updated_at이 없으므로, 조회 당시 이동에 영향을 주는 값을 비교한다. */
export type TransferSnapshot = {
  studentId: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  isTransferred: boolean;
  attendanceDays: string[];
};

export type TransferCandidate = BulkCandidate & { snapshot: TransferSnapshot };

export function isTransferDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function transferBlockReason(snapshot: TransferSnapshot, date: string): string | null {
  if (snapshot.isTransferred) return "이미 반 이동이 처리되었거나 예약되어 있습니다";
  if (date < snapshot.startDate) return `${snapshot.startDate} 수강 시작 전입니다`;
  if (snapshot.endDate && snapshot.endDate < date) return `${snapshot.endDate}에 종료되는 수강입니다`;
  return null;
}

export function transferErrorMessage(error?: string): string {
  if (/overlap|exclusion|23P01/i.test(error ?? "")) return "목적지 반의 기존 수강과 기간이 겹칩니다. 반이나 이동일을 확인해 주세요.";
  const messages: Record<string, string> = {
    transfer_source_changed: "수강 정보가 변경되었습니다. 목록을 새로 불러와 주세요.",
    transfer_already_moved: "이미 반 이동이 처리되었거나 예약되어 있습니다. 수강 내역을 확인해 주세요.",
    transfer_source_missing: "출발 반의 수강을 찾을 수 없습니다. 목록을 새로 불러와 주세요.",
    transfer_invalid_period: "이동일이 기존 수강 기간 밖입니다. 이동일을 확인해 주세요.",
    transfer_target_missing: "목적지 반을 찾을 수 없거나 운영이 종료되었습니다.",
  };
  return messages[error ?? ""] ?? "반 이동에 실패했습니다. 수강 내역을 확인해 주세요.";
}
