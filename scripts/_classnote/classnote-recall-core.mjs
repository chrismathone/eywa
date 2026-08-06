/**
 * 수업보고서 **회수** 워커 — eywa가 `recall_requested`로 표시한 보고서의 ClassNote 학부모 게시글을 삭제한다.
 *
 * 왜 워커인가: ClassNote 삭제는 로그인 세션이 필요해 Vercel에선 불가(발송·반 공지 회수와 같은 구조).
 * 앱은 `classnote_status='recall_requested'` + `revoked_at`(링크 즉시 차단)까지만 하고, 실제 글 삭제는 여기서.
 *
 * ## 🔴 특정 못 하면 지우지 않는다
 * 대상 글은 **본문 완전 일치**(`content === "{shareBase}/r/{share_token}"`)로만 찾는다. 공유 토큰이 전역
 * 유니크라 이 일치가 곧 "그 학생의 그 보고서 글"의 증명이다. 이름·날짜로 근사해서 지우면 **남의 글을 지운다**
 * (되돌릴 수 없다). 조회 자체가 실패하면(ok=false) 지우지 않고 실패로 남긴다 — '없음'과 '확인 불가'는 다르다.
 *
 * ## 🔴 발송 킬스위치에 걸지 않는다 (의도적)
 * `classnoteSendEnabled` OFF는 **내보내는 것**을 막는 스위치다. 회수는 그 반대(이미 나간 것을 거둬들임)이고,
 * 사고가 나서 스위치를 내린 상황이야말로 회수가 가장 급하다. 스위치에 걸면 "끄면 수습도 못 하는" 구조가 된다.
 * 대신 `--post`(워커 실동작 플래그)에는 걸린다 — dry-run에서 실삭제가 나가면 안 되므로.
 *
 * ## 🔴 minDate(최근 7일) 창을 적용하지 않는다 (의도적)
 * 발송 워커의 창은 "옛 보고서 대량 오발송" 방지책이다. 회수는 방향이 반대라 옛 글도 지울 수 있어야 한다
 * (오발송은 며칠 뒤 발견되는 게 보통). 대량 삭제 방어는 앱 쪽 상한(회수 요청 1회 100건)과 명시적 선택이 맡는다.
 */

import {
  fetchBoards,
  fetchChildren,
  fetchCenterId,
  findChildReportId,
  loginClassnote,
  resolveBoardChildEnrollments,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";
import { boardClassName, subjectLabel } from "./classnote-core.mjs";

/** 클레임 배치 — 회수는 드문 동작이라 작게(한 폴에 5건). */
const BATCH = 5;
/** `recalling`에 10분 이상 머문 행은 죽은 폴로 보고 되돌린다(발송 워커 STALE_MIN과 같은 규약). */
const STALE_MIN = 10;

/** 리포트 단건 조회 — 삭제 전 대조(cls/child)용. notice-core getReport와 같은 계약. */
async function getReport(page, id) {
  return page.evaluate(async (i) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const res = await fetch(`/api/v1_2/reports/${i}/`, {
      headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
    });
    if (!res.ok) return { status: res.status };
    const j = await res.json().catch(() => null);
    return { status: res.status, cls: j?.cls ?? null, child: j?.child ?? null, content: j?.content ?? null };
  }, id);
}

/** 리포트 삭제 — DELETE /api/v1_2/reports/{id}/ → 204(2026-07-13 학원이로 실검증). */
async function deleteReport(page, id) {
  return page.evaluate(async (i) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const res = await fetch(`/api/v1_2/reports/${i}/`, {
      method: "DELETE",
      headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
    });
    return { status: res.status };
  }, id);
}

/**
 * 회수 1건 — 보드·원아 해석 → 본문 완전 일치로 글 찾기 → 대조 → 삭제.
 * 반환 `{ ok, note, deletedIds }`. ok=false면 호출부가 `recall_failed` + note를 기록한다(한글 사유).
 */
async function recallOne(page, centerId, boards, children, { studentName, subject, shareUrl, log }) {
  if (!subjectLabel(subject))
    return { ok: false, note: `보드 매핑이 없는 과목이라 회수 대상을 찾을 수 없습니다`, deletedIds: [] };
  const className = boardClassName(subject, studentName);
  const board = boards.find((b) => (b.name || "").trim() === className);
  if (!board) return { ok: false, note: `학부모 게시판(${className})을 찾지 못했습니다`, deletedIds: [] };

  // 이중 계정(부모·본인 각자 가입)이면 같은 글이 여러 원아에 붙어 있을 수 있어 전부 훑는다.
  const enrolled = await resolveBoardChildEnrollments(page, board.id, studentName, children).catch(() => []);
  if (!enrolled.length) return { ok: false, note: `게시판에 배정된 원아를 찾지 못했습니다`, deletedIds: [] };

  const deletedIds = [];
  let found = 0;
  let verifyFailed = 0;
  for (const { child } of enrolled) {
    // strict 일치 — content가 곧 공유 링크다(수업보고서 게시 본문 = shareUrl).
    const hit = await findChildReportId(page, centerId, { cls: board.id, child: child.id, content: shareUrl });
    if (!hit.ok) {
      // 조회 실패 = **확인 불가**. '없음'으로 뭉개면 "지웠다"고 거짓 보고하게 된다 → 실패로 남겨 재시도.
      verifyFailed++;
      continue;
    }
    if (hit.id == null) continue; // 이 원아에겐 그 글이 없음(정상 — 다른 계정에만 붙어 있을 수 있다)
    found++;

    // 삭제 직전 대조 — 엉뚱한 id로 남 글을 지우지 않는다(notice-core revokeNotice와 같은 방어).
    const chk = await getReport(page, hit.id).catch(() => ({ status: 0 }));
    if (chk.status === 404) {
      deletedIds.push(hit.id); // 이미 없음 = 목표 달성
      continue;
    }
    if (chk.status !== 200 || String(chk.cls) !== String(board.id) || String(chk.child) !== String(child.id)) {
      verifyFailed++;
      log?.(`  · 대조 불일치(${chk.status}) — 삭제하지 않음 (report ${hit.id})`);
      continue;
    }
    const del = await deleteReport(page, hit.id).catch(() => ({ status: 0 }));
    if (del.status >= 200 && del.status < 300) {
      deletedIds.push(hit.id);
      log?.(`  · 게시글 삭제 완료 (report ${hit.id})`);
    } else {
      verifyFailed++;
      log?.(`  · 삭제 실패(HTTP ${del.status}) (report ${hit.id})`);
    }
  }

  if (verifyFailed) return { ok: false, note: `게시글 ${verifyFailed}건을 확인·삭제하지 못했습니다`, deletedIds };
  if (!found && !deletedIds.length)
    // 글을 못 찾음 = 이미 지워졌거나 애초에 안 올라간 것. 회수 목적(게시판에 없음)은 달성이라 성공 처리하되
    // 사유를 남겨 "무엇이 일어났는지"가 기록에 보이게 한다.
    return { ok: true, note: "게시글이 이미 없습니다(회수 완료로 처리)", deletedIds: [] };
  return { ok: true, note: null, deletedIds };
}

/**
 * 회수 큐 1회 처리 — stale 복구 → 원자 클레임 → 건별 삭제 → 상태 기록.
 * `post=false`(dry-run)면 대상 건수만 로그하고 **아무것도 지우지 않는다**.
 */
export async function processRecallsOnce(sql, browser, opts) {
  const { tenant, post = false, shareBase = "https://eywa-alpha.vercel.app", log = console.log } = opts;

  // stale 복구 — 죽은 폴이 잡아둔 행을 되돌린다(tenant 격리).
  const stale = await sql`update lesson_reports set classnote_status='recall_requested'
    where tenant_id = ${tenant} and classnote_status='recalling'
      and classnote_processing_at < now() - (${STALE_MIN} || ' minutes')::interval
    returning id`;
  if (stale.length) log(`[recall] stale 복구 ${stale.length}건`);

  const [{ n }] = await sql`select count(*)::int as n from lesson_reports
    where tenant_id=${tenant} and classnote_status='recall_requested'`;
  if (!n) return { claimed: 0, recalled: 0, failed: 0 };
  if (!post) {
    log(`[recall] 회수 대기 ${n}건 — dry-run이라 삭제하지 않음(--post 필요)`);
    return { claimed: 0, recalled: 0, failed: 0, pending: n };
  }

  const claimed = await sql`
    with cte as (
      select id from lesson_reports
      where tenant_id = ${tenant} and classnote_status='recall_requested'
      order by revoked_at nulls first limit ${BATCH}
      for update skip locked
    )
    update lesson_reports lr set classnote_status='recalling', classnote_processing_at=now()
    from cte where lr.id=cte.id
    returning lr.id, lr.share_token, lr.subject, lr.student_id, lr.report_date::text as report_date`;
  const summary = { claimed: claimed.length, recalled: 0, failed: 0 };
  if (!claimed.length) return summary;
  log(`[recall] 클레임 ${claimed.length}건`);

  const page = await browser.newPage();
  try {
    // 🔴 로그인 먼저 — 새 페이지는 `about:blank`라 **상대경로 fetch가 갈 곳이 없다**(2026-08-06 실패 원인).
    //    아래 조회들은 전부 `/api/...` 상대경로라 ClassNote 도메인 위에서만 동작한다(notice-core와 같은 순서).
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    const boards = await fetchBoards(page, centerId);
    const children = await fetchChildren(page, centerId);

    for (const r of claimed) {
      const [stu] = await sql`select name, classnote_name from students where id=${r.student_id} and tenant_id=${tenant}`;
      // 보드명·원아 = 유효이름(classnote_name 오버라이드 || name) — 발송 워커와 같은 규약(0088a).
      const studentName = (stu?.classnote_name?.trim() || stu?.name || "").trim();
      if (!studentName) {
        await sql`update lesson_reports set classnote_status='recall_failed',
          classnote_error='학생 이름을 찾지 못해 게시글을 특정할 수 없습니다' where id=${r.id}`;
        summary.failed++;
        continue;
      }
      if (!r.share_token) {
        await sql`update lesson_reports set classnote_status='recall_failed',
          classnote_error='공유 링크가 없어 게시글을 특정할 수 없습니다 — ClassNote에서 직접 삭제하세요' where id=${r.id}`;
        summary.failed++;
        continue;
      }
      const shareUrl = `${shareBase}/r/${r.share_token}`;
      log(`[recall] ${studentName} ${r.report_date} — ${shareUrl}`);

      const res = await recallOne(page, centerId, boards, children, {
        studentName,
        subject: r.subject,
        shareUrl,
        log,
      }).catch((e) => ({ ok: false, note: `회수 중 오류: ${String(e?.message ?? e).slice(0, 120)}`, deletedIds: [] }));

      if (res.ok) {
        await sql`update lesson_reports set classnote_status='recalled', classnote_error=${res.note ?? null},
          classnote_processing_at=null where id=${r.id}`;
        summary.recalled++;
        log(`  → 회수 완료${res.note ? ` (${res.note})` : ""}`);
      } else {
        await sql`update lesson_reports set classnote_status='recall_failed', classnote_error=${res.note},
          classnote_processing_at=null where id=${r.id}`;
        summary.failed++;
        log(`  → 회수 실패: ${res.note}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  log(`[recall] 완료 — 회수 ${summary.recalled} · 실패 ${summary.failed} (${CLASSNOTE_BASE})`);
  return summary;
}
