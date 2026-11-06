// makeedu 동기화 실패 사유(스크래퍼/오케스트레이터의 기술 에러 원문)를 원장이 읽을 수 있는 한글로 변환(순수).
// UI 규칙: 기술 에러 원문(예 "scrape.cjs exited 1")을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
// sync-all.cjs가 자식 stderr의 실제 원인을 "… — <원인>" 꼬리로 실어 보내므로(makeedu_sync_runs.error), 그 원인 문구를 매칭한다.

// 🔴 2026-11-06 — makeedu 자동 로그인 멈춤 갈래(워커 scripts/_makeedu/login-guard.cjs와 같은 표 · 시험이 워커 문장으로 맞춘다).
//   사람 확인(CAPTCHA_REQUIRED · NO_REJECT 재인증) = 'makeedu 다시 로그인'으로 풀린다.
//   비밀번호(NO_LOGIN_CNT · NO_CHK) = '연동 계정'에서 비밀번호를 확인해 다시 저장해야 풀린다.
//   계정(NOK · NO_PASS · NO_PTYPE · NOK_LIMIT · 모르는 코드) = makeedu에서 해결한 뒤 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도.
//   BLOCK_UNREADABLE = 동기화 PC의 멈춤 기록을 읽지 못함(내부 · makeedu 응답 아님) — 안전을 위해 멈춤 · 내용이 깨졌으면 비밀번호를 한 번 더 저장하면 다시 시도 ·
//                      파일을 열 수 없으면(잠김·권한·백신) PC 재시작·백신 예외·폴더 권한(비밀번호 저장으로는 안 풀림).
const PC_APP = "동기화 PC의 AYWA 연동 앱";
const ACCOUNT_THEN = `makeedu에서 해결한 뒤 ${PC_APP} '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다`;
const ACCOUNT_WHAT: Record<string, string> = {
  NOK: "makeedu 계정이 미인증 상태입니다",
  NO_PASS: "makeedu 호출정보가 올바르지 않습니다",
  NO_PTYPE: "makeedu가 이 계정을 무료형·실속형(라이트) 사용자로 안내합니다",
  NOK_LIMIT: "makeedu가 사용 기한·결제 화면으로 안내합니다",
};

// 워커가 멈춤 표시를 본·예비 어디에도 못 남겼다(login-guard blockNote 'write_failed') — 다음 실행이 같은 자격으로 다시 보낼 수 있다(재리뷰 경미 3).
const WRITE_FAILED_HEAD = "⚠️ 멈춤 표시 저장 실패 — 다음 실행이 같은 자격으로 다시 시도할 수 있음(잠김 위험)";

export function humanizeMakeeduSyncError(raw: string | null | undefined): string | null {
  const r = (raw ?? "").trim();
  if (!r) return null;
  const reason = humanizeReason(r);
  // 어떤 사유든(사람 확인·비밀번호 틀림 등 코드별 규칙보다 앞에서) 앞머리로 크게 · 원래 사유는 뒤에 그대로.
  return /멈춤 표시 저장 실패/.test(r) ? `${WRITE_FAILED_HEAD} · ${reason}` : reason;
}

function humanizeReason(r: string): string {
  // 특정 → 일반 순서. 한 문자열에 "exited"와 실제 원인이 함께 있어도 원인 매칭이 먼저 잡히도록 아래에서 위로 우선.
  // 워커(login-guard.cjs)는 makeedu 응답 코드를 `[CODE]`로 붙여 보낸다. 재인증·로그인 실패 규칙보다 **먼저** 잡는다 —
  // 예전엔 사람 확인 요구가 "ID/PW 확인"으로 읽혀 엉뚱한 곳을 봤다.
  if (/CAPTCHA_REQUIRED|NO_REJECT|사람 확인/.test(r))
    return `makeedu가 자동 로그인에 사람 확인을 요구합니다 — ${PC_APP}에서 'makeedu 다시 로그인'이 필요합니다`;
  // 판정 불가(응답 없음 · 접속 실패 · 세션 파일 잠김) — 아래 'login.do' 규칙에 걸려 "아이디/비밀번호 확인"으로 오진하지 않게 먼저(리뷰 2026-11-06).
  if (/판정 불가|net::ERR_/.test(r))
    return "makeedu 로그인 상태를 확인하지 못했습니다(네트워크·사이트 문제 등 — 판정 불가) — 자동 로그인은 멈추지 않았고 다음 자동 실행에서 다시 확인합니다";
  const code = /\[([A-Za-z_]{1,40})\]/.exec(r)?.[1] ?? null;
  // 같은 BLOCK_UNREADABLE 중 멈춤 기록 파일 **읽기 자체가 실패**(잠김·권한·백신)한 경우 — 비밀번호 저장으로 풀리지 않으므로 그 안내를 하지 않는다(fix4).
  // 워커 문구의 표식('멈춤 기록 파일을 열 수 없')으로 가른다 — 아래 BLOCK_UNREADABLE 규칙보다 먼저.
  if (/멈춤 기록 파일을 열 수 없/.test(r))
    return "동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등) — 안전을 위해 자동 로그인을 멈춰 두었습니다 · 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다)";
  // 동기화 PC의 멈춤 기록(login-blocked.json) 내용이 깨져 읽지 못함 — makeedu가 거절한 게 아니다(재리뷰 경미 4 · 진짜 모르는 makeedu 응답과 구분).
  if (code === "BLOCK_UNREADABLE" || /멈춤 기록을 읽지 못/.test(r))
    return `동기화 PC의 makeedu 자동 로그인 멈춤 기록을 읽지 못했습니다 — 안전을 위해 자동 로그인을 멈췄습니다 · ${PC_APP} '연동 계정'에서 makeedu 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다`;
  if (code === "NO_LOGIN_CNT" || /비밀번호가 맞지 않|로그인 정보가 올바르지 않습니다 ·/.test(r)) {
    const left = /남은 시도 (\d+)회/.exec(r)?.[1];
    return `makeedu 로그인 정보가 올바르지 않습니다${left ? ` · 남은 시도 ${left}회` : ""} — ${PC_APP} '연동 계정'에서 비밀번호를 확인해 다시 저장해야 자동 로그인이 풀립니다(더 틀리면 계정이 잠길 수 있습니다)`;
  }
  if (code === "NO_CHK")
    return `makeedu 인증정보가 올바르지 않습니다 — ${PC_APP} '연동 계정'에서 비밀번호를 확인해 다시 저장해야 자동 로그인이 풀립니다`;
  if (code && ACCOUNT_WHAT[code]) return `${ACCOUNT_WHAT[code]} — ${ACCOUNT_THEN}`;
  // 멈춤 표시를 못 남긴 실행(write_failed)은 '자동 로그인 멈춤' 꼬리 대신 '멈춤 표시 저장 실패' 꼬리가 붙는다 — 같은 사유로 읽는다.
  if (/자동 로그인 멈춤|멈춤 표시 저장 실패/.test(r))
    return `makeedu가 알 수 없는 응답(${code ?? "코드 없음"})으로 로그인을 거절했습니다 — ${ACCOUNT_THEN}`;
  if (/MAKEEDU_ID|MAKEEDU_PW|\.env\.local[^]*없|로그인 정보[^]*없/i.test(r))
    return "동기화 PC에 makeedu 로그인 정보(ID/PW)가 없습니다 — 동기화 PC의 설정(.env.local) 확인";
  // 임포터의 0행 가드가 남기는 문장(import-invoices) — 세션 만료 규칙보다 **먼저** 잡는다.
  // 그 문장엔 "세션 만료 의심"이 들어 있어 아래 규칙에 걸리면 **추측이 단정으로 바뀐다**.
  // 여기선 확실한 사실(못 읽어서 반영 안 함)을 말하고 원인은 의심으로만 남긴다.
  if (/스크랩 0행|0행 가드|목록을 못 읽/i.test(r))
    return "makeedu 목록을 못 읽어 이번 회차는 반영하지 않았습니다 — 세션 만료·화면 변경 의심(다음 자동 실행에서 재시도)";
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
