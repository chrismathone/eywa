/**
 * ClassNote 명부 퇴원처리(퇴소) 직전 백업의 저장 위치 — 순수(Vitest). 내부 라우트 `api/internal/classnote-offboard-backup`이 쓴다.
 * 버킷 = 기존 비공개 `classnote-backups`(ClassNote 보관본 — 형식 제한 없음 · 새 SQL 없음) · 경로 = `{지점}/offboard/{YYYY-MM-DD}/{원아번호}.json`.
 * 🔴 경로는 여기서만 만든다 — 워커가 준 값을 그대로 이어 붙이지 않는다(지점·날짜·원아 번호 꼴을 확인한 것만).
 */
export const OFFBOARD_BACKUP_BUCKET = "classnote-backups";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 그날 백업 폴더(지점·날짜 꼴을 확인한 뒤에만 부를 것). */
export const offboardBackupDir = (tenantId: string, date: string) => `${tenantId.toLowerCase()}/offboard/${date}`;

/** 백업 파일 경로 — 꼴이 틀리면 null(지점 = UUID · 날짜 = YYYY-MM-DD · 원아 = 양의 정수). */
export function offboardBackupPath(tenantId: unknown, childId: unknown, date: unknown): string | null {
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return null;
  if (typeof date !== "string" || !DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  const id = typeof childId === "number" ? childId : typeof childId === "string" && /^[1-9]\d{0,15}$/.test(childId) ? Number(childId) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return `${offboardBackupDir(tenantId, date)}/${id}.json`;
}
