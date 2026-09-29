import "server-only";
import { logAction, logActionAs } from "@/features/audit/server/log";

// 파일 내보내기(엑셀) 접속기록 — 보안 감사 2026-09-29.
// 원생목록(학부모 연락처)·수납·지출·회차 확정 파일이 **누가 언제 받아 갔는지 한 줄도 안 남았다**.
// 개인정보 안전성 확보조치 기준의 "다운로드 접속기록"에 해당하는 자리라, 파일을 돌려주기 직전에 한 줄 남긴다.
// ⚠️ 기록 실패가 다운로드를 막지 않는다(logAction이 스스로 삼킨다).

/** 받은 조건(쿼리스트링) — 원문은 감사 화면 툴팁으로만 보인다(raw 코드 노출 금지). */
function filtersOf(request: Request): string {
  return new URL(request.url).search.replace(/^\?/, "");
}

/** 로그인 사용자의 파일 다운로드. `label` = 화면에 보일 파일 이름(한글, 예: "원생목록"). */
export async function logExportDownload(request: Request, label: string): Promise<void> {
  const filters = filtersOf(request);
  await logAction({
    action: "data_export_download",
    targetLabel: label,
    metadata: { filters: filters || null, filtered: filters.length > 0 },
  });
}

/** 세션 없는 반출(토큰 인증 API) — 행위자 = 그 API 이름. tenantId는 호출부가 검증을 끝낸 값만. */
export async function logExportDownloadAs(
  tenantId: string,
  actorName: string,
  request: Request,
  label: string,
): Promise<void> {
  const filters = filtersOf(request);
  await logActionAs(
    { tenantId, actorName },
    {
      action: "data_export_download",
      targetLabel: label,
      metadata: { filters: filters || null, filtered: filters.length > 0 },
    },
  );
}
