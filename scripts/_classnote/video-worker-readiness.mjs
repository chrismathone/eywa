/** 하트비트가 살아 있다는 이유만으로 구버전·다른 저장 폴더를 적용 완료로 표시하지 않는다.
 *  homeworkVideoTenantFolders 가 있으면 하트비트 폴더를 저장된 지점 루트(savedRootId)와 비교한다.
 *  그 키가 없는 구워커는 env 폴더(folderId)와 비교한다. 키 부재만으로 준비 안 됨이 되지 않는다. */
export function videoWorkerReadiness(row, { now = Date.now(), folderId, savedRootId = null, startedAfter = null } = {}) {
  if (!row) return { ready: false, reason: "이 PC의 워커 기록이 없습니다." };
  const lastSeen = row.last_seen ? new Date(row.last_seen).getTime() : NaN;
  if (!Number.isFinite(lastSeen) || now - lastSeen > 90_000 || lastSeen > now + 90_000)
    return { ready: false, reason: "워커의 최근 응답을 기다리고 있습니다." };
  const started = row.started_at ? new Date(row.started_at).getTime() : NaN;
  if (startedAfter && (!Number.isFinite(started) || started < Date.parse(startedAfter)))
    return { ready: false, reason: "재시작 전 워커입니다. 새 프로세스를 기다립니다." };
  const result = row.last_results ?? {};
  if (result.postMode !== true) return { ready: false, reason: "실행 중인 워커가 시험 모드입니다." };
  if (result.caps?.homeworkVideoArchive !== true)
    return { ready: false, reason: "영상 보관 기능이 없는 구버전 워커입니다." };
  if (!result.videoArchive?.enabled) return { ready: false, reason: "영상 보관 설정이 적용되지 않았습니다." };
  const tenantFolders = result.caps?.homeworkVideoTenantFolders === true;
  const expected = tenantFolders ? savedRootId : folderId;
  if (!expected || result.videoArchive.folderId !== expected)
    return { ready: false, reason: tenantFolders ? "워커의 영상 저장 폴더가 지점 설정과 다릅니다." : "워커의 영상 저장 폴더가 요청한 폴더와 다릅니다." };
  return { ready: true, reason: "새 워커와 영상 저장 폴더 적용을 확인했습니다." };
}
