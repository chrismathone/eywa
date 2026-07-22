/**
 * ClassNote 학부모 읽음 동기화 (A안 3단계) — 피드의 `read_by_parent.date_read`를 eywa로 옮긴다.
 *
 * 왜 워커인가: 읽음은 ClassNote 로그인 세션이 있어야 보이고(Vercel은 Playwright 불가), 마침 학부모 글·댓글
 * 폴러가 **같은 피드**를 이미 읽고 있어 **추가 요청 0**으로 얻을 수 있다(num_comments와 동일 구조).
 *
 * 매칭 키(0122a·docs/classnote-read-sync-plan.md 실측):
 *  - **edutrix 발송분**(현재 대부분): 본문 `edutrix.vercel.app/share/{uuid}` = edutrix `reports.share_token`
 *    → eywa `lesson_reports.edutrix_share_token`(edutrix-sync가 채움)와 조인. 실측 체인 77/77 → 64/77.
 *  - **eywa 발송분**(향후): 본문 `{공개도메인}/r/{share_token}` → 기존 `lesson_reports.share_token`와 조인.
 * 두 형태를 모두 파싱해 각각의 컬럼으로 갱신한다.
 *
 * ⚠️ 읽음은 **나중에 채워지는 값**(발송 당일 미읽음 → 며칠 뒤 읽음)이라 워터마크(한 번 보고 끝)를 쓰면 안 된다.
 *    최근 창을 매번 다시 훑되, 이미 채워진 행은 SQL에서 `classnote_read_at is null`로 걸러 쓰기를 줄인다.
 * ⚠️ `/api/v1/reports/{id}/read/`(GET 405 = POST 추정)는 **절대 호출 금지** — 학원 계정이 읽음을 남길 위험.
 */

/**
 * 본문에서 매칭 토큰 추출 — edutrix 공유링크 우선, 없으면 eywa /r/ 링크. 없으면 null.
 * ⚠️ 링크 없는 발송 글이 많은 건 정상이다(실측 14일 창 2,308건 중 1,444건) — **수업 보고서가 아니라**
 * 강사가 ClassNote에 직접 쓴 알림장(영어반)·학원 공지(휴무 안내 등)다. eywa에 대응 행이 없으므로 매칭 대상 아님.
 */
export function extractReadToken(content) {
  const text = typeof content === "string" ? content : "";
  const edutrix = /edutrix\.vercel\.app\/share\/([0-9a-fA-F-]{36})/.exec(text);
  if (edutrix) return { kind: "edutrix", token: edutrix[1].toLowerCase() };
  // eywa 공개 보고서 링크(도메인 무관 — 로컬/프리뷰/프로덕션 모두 경로는 /r/{uuid}).
  const eywa = /\/r\/([0-9a-fA-F-]{36})/.exec(text);
  if (eywa) return { kind: "eywa", token: eywa[1].toLowerCase() };
  return null;
}

/**
 * 피드 행 → 읽음 갱신 후보. **학원 발송분(is_sent_from_center) + 읽음 시각 존재 + 토큰 파싱 성공**만 남긴다.
 * 학부모가 올린 글(is_sent_from_center=false)은 우리 보고서가 아니라 제외.
 * 같은 토큰이 여러 번 나오면 **가장 이른 읽음 시각**을 채택(최초 확인 시점이 의미 있는 값).
 */
export function buildReadUpdates(rows) {
  const byToken = new Map();
  for (const row of rows ?? []) {
    if (!row?.is_sent_from_center) continue;
    const readAt = row?.read_by_parent?.date_read;
    if (!readAt) continue;
    const parsed = extractReadToken(row?.content);
    if (!parsed) continue;
    const key = `${parsed.kind}:${parsed.token}`;
    const prev = byToken.get(key);
    if (!prev || String(readAt) < String(prev.readAt)) {
      byToken.set(key, { kind: parsed.kind, token: parsed.token, readAt: String(readAt) });
    }
  }
  return [...byToken.values()];
}

/** 관측용 요약 — 피드에서 몇 건이 읽음/미읽음/토큰 없음이었나(로그 문구 단일화). */
export function summarizeReadScan(rows) {
  let sent = 0;
  let read = 0;
  let unread = 0;
  let noToken = 0;
  for (const row of rows ?? []) {
    if (!row?.is_sent_from_center) continue;
    sent++;
    if (row?.read_by_parent?.date_read) read++;
    else unread++;
    if (!extractReadToken(row?.content)) noToken++;
  }
  return { sent, read, unread, noToken };
}

/**
 * 폴 간격 — 읽음은 며칠에 걸쳐 천천히 채워지므로 자주 볼 이유가 없다. 30분마다 창 전체 재조회
 * (댓글 폴러 10분보다 느슨). 데몬은 15초마다 부르지만 이 가드가 대부분 no-op으로 되돌린다.
 */
const READ_POLL_INTERVAL_MS = 30 * 60_000;
let lastReadRunAt = 0;

/**
 * 창 안 피드를 훑어 읽음을 eywa에 반영. **ClassNote에는 아무것도 쓰지 않는다**(GET만) — 발송 스위치(--post)와
 * 무관하게 돌아도 안전하다. eywa DB 쓰기는 `apply`가 false면 건너뛴다(조사·검증용 dry-run).
 * 반환: `{ran}` + 관측 카운터.
 */
export async function pollReportReadsOnce(
  sql,
  browser,
  { tenant, log = console.log, apply = true, maxAgeDays = 14, force = false } = {},
) {
  if (!force && Date.now() - lastReadRunAt < READ_POLL_INTERVAL_MS) return { ran: false };
  lastReadRunAt = Date.now();
  const dryRun = !apply;
  const { fetchReadWindow } = await import("./classnote-feed-core.mjs");
  const rows = await fetchReadWindow(browser, { maxAgeDays, label: "읽음" }, log);
  const scan = summarizeReadScan(rows);
  const updates = buildReadUpdates(rows);
  log(`[읽음] 피드 ${rows.length}건 · 학원발송 ${scan.sent} (읽음 ${scan.read}/미읽음 ${scan.unread}, 링크없음 ${scan.noToken}) → 갱신 후보 ${updates.length}`);
  if (dryRun || updates.length === 0) return { ran: true, ...scan, matched: 0, dryRun };

  // 토큰 종류별로 배치 갱신. 이미 채워진 행은 건드리지 않는다(멱등 + 쓰기 최소화).
  let matched = 0;
  for (const kind of ["edutrix", "eywa"]) {
    const list = updates.filter((u) => u.kind === kind);
    if (!list.length) continue;
    const tokens = list.map((u) => u.token);
    const times = list.map((u) => u.readAt);
    const rowsUpdated =
      kind === "edutrix"
        ? await sql`
            update lesson_reports lr set classnote_read_at = v.read_at::timestamptz
            from (select unnest(${tokens}::text[]) as token, unnest(${times}::text[]) as read_at) v
            where lr.tenant_id = ${tenant}
              and lr.edutrix_share_token = v.token
              and lr.classnote_read_at is null
            returning lr.id`
        : await sql`
            update lesson_reports lr set classnote_read_at = v.read_at::timestamptz
            from (select unnest(${tokens}::text[]) as token, unnest(${times}::text[]) as read_at) v
            where lr.tenant_id = ${tenant}
              and lr.share_token::text = v.token
              and lr.classnote_read_at is null
            returning lr.id`;
    matched += rowsUpdated.length;
    if (rowsUpdated.length) log(`[읽음] ${kind} 매칭 갱신 ${rowsUpdated.length}건`);
  }
  if (matched === 0 && updates.length > 0) {
    // ⚠️ matched===0만으로는 경고할 수 없다(2026-07-21 실측 오경보): 창 안 후보를 **매 폴 다시 훑는** 구조라,
    // 이미 다 반영된 정상 정상상태에서도 `classnote_read_at is null` 필터에 걸려 갱신 0건이 된다.
    // (실측: 후보 576건 · eywa 토큰 보유 540행 중 297행 이미 읽음 채움 → 새로 채울 게 없어 0건.)
    // 진짜 문제는 **토큰이 eywa에 아예 없을 때**(edutrix-sync 미배선)뿐이므로 그것만 구분해 경고한다.
    const allTokens = updates.map((u) => u.token);
    const [{ n: known }] = await sql`
      select count(*)::int as n from lesson_reports
      where tenant_id = ${tenant}
        and (edutrix_share_token = any(${allTokens}::text[]) or share_token::text = any(${allTokens}::text[]))`;
    // 진짜 문제(토큰 미매칭)만 로깅한다 — "이미 반영됨(정상)"은 매 읽음 폴 반복되는 순수 노이즈라 제거(2026-07-22 원장 제보).
    if (known === 0) {
      log(`[읽음] ⚠️ 후보 ${updates.length}건이 eywa 행과 매칭되지 않음 — edutrix_share_token 임포트 여부 확인 필요`);
    }
  }
  return { ran: true, ...scan, matched, dryRun: false };
}
