// scripts/_classnote/classnote-class-notice-core.mjs — **반 단체 공지** 큐(0304a) 처리(연동 PC 워커).
//
// 원장 2026-09-29: 반 공지를 "반 단체 공지(반 보드에 공지 1건)"와 "원생 개별 공지(학생마다 1:1)"로 가른다.
// 원생 개별 공지는 classnote-notice-core.mjs(그대로). 여기는 ClassNote **공지사항**으로 반 보드에 1건.
//
// 🔴 안전장치(전부 매번):
//   ① 보드 번호는 큐 값이 아니라 `classnote_class_boards`(0302a)에서 반 id로 다시 찾는다(큐 위조·옛 값 무시).
//   ② 보드의 **지금** 원아 = 그 반 재원생(0302a ok ∩ 오늘 수강 중)이어야 보낸다 — 반을 옮긴 학생이 보드에 남아 있으면
//      반 공지가 그 집에도 간다(원아 해제는 화면에서 손으로만 된다).
//   ③ `classes_to`는 정확히 반 하나(class-notice-guard.mjs) — 빠지면 기관 전체 공지일 수 있다.
//   ④ 같은 제목·내용이 그 반에 이미 있으면 다시 올리지 않는다(크래시 재시도 중복 방지) · 올린 뒤 목록에서 실물 확인.
//   ⑤ 발송 스위치(classnoteSendEnabled) OFF면 손대지 않는다. 테스트 발송은 `[수학] 테스트반`(학원* 원아만)으로만.
import { fetchBoardChildren, fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { isClassnoteSendEnabled, DEFAULT_AUTHOR_NAME } from "./classnote-core.mjs";
import { buildClassNoticePayload, evaluateClassNoticeBoard, isTestOnlyBoard, TEST_NOTICE_BOARD } from "./class-notice-guard.mjs";

const STALE_MIN = 10;

async function listBoardNotices(page, centerId) {
  return page.evaluate(async (c) => {
    const r = await fetch(`/api/v1/centers/${c}/notices?page_size=30`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : null;
  }, centerId);
}

async function postNotice(page, payload) {
  return page.evaluate(async (body) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const r = await fetch("/api/v1_2/notices/", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, detail: r.ok ? "" : (await r.text().catch(() => "")).slice(0, 300) };
  }, payload);
}

/** 그 반 재원생의 매칭 확인 원아(0302a ok ∩ 오늘 수강 중 ∩ 재원). */
async function allowedChildren(sql, tenant, classId) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const rows = await sql`
    select distinct m.child_id from classnote_class_board_members m
    join enrollments e on e.tenant_id = m.tenant_id and e.class_id = m.class_id and e.student_id = m.student_id
      and (e.start_date is null or e.start_date <= ${today}) and (e.end_date is null or e.end_date >= ${today})
    join students s on s.id = m.student_id and s.status = 'enrolled'
    where m.tenant_id = ${tenant} and m.class_id = ${classId} and m.status = 'ok' and m.child_id is not null`;
  return new Set(rows.map((r) => Number(r.child_id)));
}

/** 한 반에 공지 1건 — 안전장치 ②~④. 반환 { ok, noticeId?, note? }. */
async function sendToBoard(page, centerId, { boardId, live, allowed, title, body, authorName, isTest }) {
  const guard = isTest
    ? isTestOnlyBoard(live)
      ? { ok: true }
      : { ok: false, reason: "테스트반에 학원* 테스트 원아가 아닌 원아가 있어 보내지 않았습니다" }
    : evaluateClassNoticeBoard({ live, allowed });
  if (!guard.ok) return { ok: false, note: guard.reason };
  const same = (n) => String(n.cls) === String(boardId) && n.title === title && n.content === body;
  const before = await listBoardNotices(page, centerId);
  if (!before) return { ok: false, note: "ClassNote 공지 목록 조회 실패 — 안전상 보류(다시 보내세요)" };
  const dup = before.find(same);
  if (dup) return { ok: true, noticeId: dup.id, note: "이미 올라가 있음(재게시 생략)" };
  const payload = buildClassNoticePayload({ boardId, title, body, centerId, authorName });
  const res = await postNotice(page, payload);
  if (res.status < 200 || res.status >= 300) return { ok: false, note: `게시 실패(HTTP ${res.status})` };
  await page.waitForTimeout(1200);
  const after = await listBoardNotices(page, centerId);
  const hit = after?.find(same);
  if (!hit) return { ok: true, note: "게시 응답은 정상이나 목록 확인 전(잠시 뒤 확인)" };
  // 🔴 사후 확인 — 반드시 그 반 하나에만, 기관 전체가 아니게.
  if (hit.is_center_notice) return { ok: false, noticeId: hit.id, note: "🔴 기관 전체 공지로 올라갔습니다 — 즉시 ClassNote에서 확인하세요" };
  return { ok: true, noticeId: hit.id };
}

/**
 * 큐 1회 처리. `post=false`(dry-run)면 대기 건수만 알린다.
 * @returns {Promise<{processed:number}>}
 */
export async function processClassNoticesOnce(sql, browser, { tenant, post = false, log = console.log }) {
  // 표가 없으면(0304a 전) 조용히 넘어간다.
  const stale = await sql`update classnote_class_notices set status='queued'
    where tenant_id=${tenant} and status='processing' and processing_at < now() - (${STALE_MIN} || ' minutes')::interval
    returning id`.catch(() => null);
  if (stale === null) return { processed: 0 };
  const [{ n }] = await sql`select count(*)::int as n from classnote_class_notices where tenant_id=${tenant} and status='queued'`;
  if (!n) return { processed: 0 };
  if (!post) {
    log(`[class-notice] 반 단체 공지 대기 ${n}건 — dry-run이라 보내지 않음`);
    return { processed: 0 };
  }
  if (!(await isClassnoteSendEnabled(sql, tenant))) {
    log("[class-notice] 발송 스위치 OFF — 반 단체 공지 보류(큐 보존)");
    return { processed: 0 };
  }
  const [row] = await sql`
    with cte as (select id from classnote_class_notices where tenant_id=${tenant} and status='queued'
      order by created_at limit 1 for update skip locked)
    update classnote_class_notices c set status='processing', processing_at=now() from cte where c.id=cte.id
    returning c.id, c.title, c.body, c.targets, c.is_test`;
  if (!row) return { processed: 0 };

  const page = await browser.newPage();
  const results = [];
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    const authorName = DEFAULT_AUTHOR_NAME;
    if (row.is_test) {
      const live = await fetchBoardChildren(page, centerId, TEST_NOTICE_BOARD.id);
      const r = await sendToBoard(page, centerId, { boardId: TEST_NOTICE_BOARD.id, live, allowed: new Set(), title: row.title, body: row.body, authorName, isTest: true });
      results.push({ classId: null, className: TEST_NOTICE_BOARD.name, ...r });
    } else {
      for (const t of row.targets ?? []) {
        // ① 보드 번호는 연결표에서 다시.
        const [b] = await sql`select board_id, board_name from classnote_class_boards where tenant_id=${tenant} and class_id=${t.classId}`;
        if (!b) {
          results.push({ classId: t.classId, className: t.className, ok: false, note: "ClassNote 반 연결 없음" });
          continue;
        }
        // 매 반 직전 스위치 재확인 — 배치 중에 꺼졌으면 여기서 멈춘다.
        if (!(await isClassnoteSendEnabled(sql, tenant))) {
          results.push({ classId: t.classId, className: t.className, ok: false, note: "발송 스위치가 꺼져 보내지 않음" });
          continue;
        }
        const boardId = Number(b.board_id);
        const [live, allowed] = await Promise.all([fetchBoardChildren(page, centerId, boardId).catch(() => null), allowedChildren(sql, tenant, t.classId)]);
        const r = await sendToBoard(page, centerId, { boardId, live, allowed, title: row.title, body: row.body, authorName, isTest: false });
        results.push({ classId: t.classId, className: t.className, ...r });
        log(`[class-notice] ${t.className}: ${r.ok ? "게시" : "보류"}${r.note ? ` — ${r.note}` : ""}`);
      }
    }
    const okN = results.filter((x) => x.ok).length;
    const status = okN === results.length ? "success" : okN > 0 ? "partial" : "failed";
    await sql`update classnote_class_notices set status=${status}, results=${sql.json(results)}, processed_at=now(), error=null where id=${row.id}`;
    return { processed: 1 };
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 200);
    // 🔴 재큐하지 않는다 — 로그인 실패 같은 오류는 매 폴 되풀이돼 로그인 폭풍이 된다. 사람이 목록에서 보고 다시 보낸다.
    await sql`update classnote_class_notices set status=${results.some((x) => x.ok) ? "partial" : "failed"},
      results=${sql.json(results)}, error=${`처리 중 오류: ${msg}`} where id=${row.id}`;
    log(`[class-notice] 처리 오류: ${msg}`);
    return { processed: 0 };
  } finally {
    await page.close().catch(() => {});
  }
}
