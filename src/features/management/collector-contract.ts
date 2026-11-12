/**
 * 학원 PC 파일 수집기 계약 — 서버·화면·PC 프로그램(`apps/collection-agent`)이 같은 값을 쓴다.
 * 복제본(aywa-next)의 복제본 주소·Vercel 보호 우회 키는 뺐다. PC 프로그램은 이 주소로만 보낸다(연결 파일의 주소를 믿지 않는다).
 */
export const collectorOrigin = "https://www.aywa.co.kr";
export const collectorScope = "source-evidence-only-v1";
export const COLLECTOR_PACKAGE_VERSION = "1.1.0";
export const COLLECTOR_PACKAGE_PATH = `/downloads/aywa-collection-pc-${COLLECTOR_PACKAGE_VERSION}.zip`;
export type CollectorResult = { code: string; source?: string; months?: string[]; issues?: number };
export type CollectorDevice = { id: string; name: string; created_at: string; expires_at: string; revoked_at: string | null; last_seen_at: string | null; last_success_at: string | null; last_result: CollectorResult | null };

/** PC가 남긴 처리 결과 코드 → 화면 문구(원문 코드를 화면에 내보내지 않는다). */
export function collectorResultLabel(result: CollectorResult | null): string {
  if (!result) return "아직 없음";
  if (result.code === "saved") return `${result.months?.length ?? 0}개월 비교 처리 · 확인 항목 ${result.issues ?? 0}개`;
  if (result.code === "invalid_file") return "파일 형식 확인 필요";
  if (result.code === "file_changed") return "전송 중 파일이 바뀜 · 다시 시도";
  if (result.code === "review_required") return "대조하지 못함 · 원장 저장·파일 형식·월 확인";
  if (result.code === "connection_unavailable") return "일시 오류 · 다음 주기에 다시 시도";
  if (result.code === "invalid_metadata") return "폴더(자료 종류·월) 확인 필요";
  return "처리 확인 필요 · PC 상태 파일 확인";
}
