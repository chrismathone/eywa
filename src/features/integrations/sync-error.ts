// makeedu 동기화 실패 사유(스크래퍼/오케스트레이터의 기술 에러 원문)를 원장이 읽을 수 있는 한글로 변환(순수).
// UI 규칙: 기술 에러 원문(예 "scrape.cjs exited 1")을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
// sync-all.cjs가 자식 stderr의 실제 원인을 "… — <원인>" 꼬리로 실어 보내므로(makeedu_sync_runs.error), 그 원인 문구를 매칭한다.
export function humanizeMakeeduSyncError(raw: string | null | undefined): string | null {
  const r = (raw ?? "").trim();
  if (!r) return null;
  // 특정 → 일반 순서. 한 문자열에 "exited"와 실제 원인이 함께 있어도 원인 매칭이 먼저 잡히도록 아래에서 위로 우선.
  if (/MAKEEDU_ID|MAKEEDU_PW|\.env\.local[^]*없|로그인 정보[^]*없/i.test(r))
    return "동기화 PC에 makeedu 로그인 정보(ID/PW)가 없습니다 — 동기화 PC의 설정(.env.local) 확인";
  if (/재인증|loginReCert|reCert|CAPTCHA|캡차|보안문자/i.test(r))
    return "makeedu 보안 재인증(캡차) 벽 — 신뢰 PC에서 다시 로그인해야 합니다";
  if (/세션[^]*(무효|만료)|만료[^]*세션|storageState|STORAGE_STATE/i.test(r))
    return "makeedu 세션 만료 — 동기화 PC에서 다시 로그인이 필요합니다";
  if (/로그인 실패|login\.do|아이디\/비밀번호|비밀번호 확인/i.test(r))
    return "makeedu 로그인 실패 — 아이디/비밀번호를 확인하세요";
  if (/DATABASE_URL|ECONNREFUSED|ENOTFOUND|ETIMEDOUT.*5432|postgres|데이터베이스/i.test(r))
    return "데이터베이스 연결 실패 — 동기화 PC의 DB 설정·네트워크 확인";
  if (/timeout|ETIMEDOUT|시그널|시간 ?초과/i.test(r))
    return "처리 시간 초과 — 다음 자동 실행에서 자동 재시도됩니다";
  if (/exited|스크래핑 실패|임포터 실패/i.test(r))
    return "동기화 실행 실패 — 자세한 원인은 동기화 PC 로그를 확인하세요";
  return "동기화 실패 — 마우스를 올려 원문 확인";
}
