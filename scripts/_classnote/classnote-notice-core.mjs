/**
 * scripts/_classnote/classnote-notice-core.mjs — 반 공지 큐(classnote_notices) 처리 코어.
 *
 * eywa 서버 액션(sendClassNotice)이 큐에 넣은 공지를 잡아, 각 타깃 학생의 ClassNote 개별 보드에
 * **내부 API로 직접 게시**한다(`POST /api/v1_2/reports/ {cls, child, enrollment, content…}` —
 * 2026-07-13 학원이로 실검증 201·삭제 204). Cloud Run·Puppeteer 마법사 불필요 — 로그인된 페이지
 * 컨텍스트의 fetch만 쓴다. watch-classnote-queue.mjs(연동 PC 데몬)가 매 폴 호출.
 *
 * 안전장치: 실게시는 --post + classnoteSendEnabled(킬스위치, 워커가 폴마다 DB 직독) 둘 다 필요.
 * 타깃별 실패(미가입·미배정·동명이인 원아)는 그 타깃만 실패 기록(results) — 전체 공지는 partial.
 */
import { isClassnoteSendEnabled } from "./classnote-core.mjs";
import {
  loginClassnote,
  fetchCenterId,
  fetchBoards,
  fetchChildren,
  fetchChildDetail,
  childKeys,
  norm,
} from "./classnote-admin-core.mjs";

const STUCK_MIN = 10;

/** KST 오늘(YYYY-MM-DD) — 게시 date_written. */
function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/** 알림장 게시(내부 API). enrollment = 원아↔보드 연결 id(배정된 학생만 존재). */
async function postReport(page, { clsId, childId, enrollmentId, content, authorName }) {
  return page.evaluate(
    async ([cls, child, enrollment, body, author, date]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch("/api/v1_2/reports/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ cls, child, enrollment, content: body, date_written: date, author_name: author, tz: "Asia/Seoul" }),
      });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    },
    [clsId, childId, enrollmentId, content, authorName, kstToday()],
  );
}

/** 타깃 1건 처리 — 보드·원아·enrollment 해석 후 게시. 실패 사유는 한글 note. */
async function processTarget(page, ctx, target) {
  const board = ctx.boardByNorm.get(norm(target.board));
  if (!board) return { board: target.board, ok: false, note: "보드 없음(프로비저닝 필요)" };
  const clean = (target.studentName || "").replace(/[a-zA-Z]/g, "").trim();
  const cands = ctx.children.filter((c) => {
    const keys = childKeys(c.name);
    return keys.has(target.studentName) || keys.has(clean);
  });
  if (cands.length === 0) return { board: target.board, ok: false, note: "학부모 미가입(초대 필요)" };
  // 같은 이름 원아가 여럿이어도 이 보드에 배정된 원아로 좁힌다(보고서 발송과 달리 배정이 선행 조건).
  const enrolled = [];
  for (const c of cands) {
    const detail = await fetchChildDetail(page, c.id);
    const e = (detail.enrollment ?? []).find((x) => x.belong_to_class === board.id && !x.removed_child);
    if (e) enrolled.push({ child: c, enrollment: e });
  }
  if (enrolled.length === 0) return { board: target.board, ok: false, note: "보드 미배정(배정 필요)" };
  // 이중 등록(부모 계정 2개, 주준호 사례)이면 전원에게 게시 — 같은 가족의 계정별 수신.
  for (const { child, enrollment } of enrolled) {
    const res = await postReport(page, {
      clsId: board.id,
      childId: child.id,
      enrollmentId: enrollment.id,
      content: ctx.body,
      authorName: ctx.authorName,
    });
    if (res.status < 200 || res.status >= 300) {
      return { board: target.board, ok: false, note: `게시 실패(HTTP ${res.status})` };
    }
  }
  return { board: target.board, ok: true };
}

/**
 * 큐 1회 처리 — stale 복구 후 queued를 하나씩 클레임(SKIP LOCKED). 처리 건수 반환.
 * post=false(dry-run)면 클레임하지 않고 개수만 보고(게시·상태 변경 없음).
 */
export async function processNoticesOnce(sql, browser, { tenant, post, log = console.log, authorName = "인재원 학원" }) {
  // stale 복구 — 워커 크래시로 processing에 갇힌 공지
  await sql`update classnote_notices set status='queued', processing_at=null
    where tenant_id=${tenant} and status='processing' and processing_at < now() - interval '${sql.unsafe(String(STUCK_MIN))} minutes'`;

  const [{ n }] = await sql`select count(*)::int as n from classnote_notices where tenant_id=${tenant} and status='queued'`;
  if (!n) return { processed: 0 };
  if (!post) {
    log(`[notice] 대기 ${n}건 — dry-run(--post 없음)이라 게시 안 함`);
    return { processed: 0, pending: n };
  }
  if (!(await isClassnoteSendEnabled(sql, tenant))) {
    log("[notice] classnoteSendEnabled OFF — 공지 게시 중단(큐 보존)");
    return { processed: 0, pending: n };
  }

  // 로그인·조회 컨텍스트는 배치당 1회
  const page = await browser.newPage();
  let processed = 0;
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    const boards = await fetchBoards(page, centerId);
    const ctxBase = {
      boardByNorm: new Map(boards.map((b) => [norm(b.name), b])),
      children: await fetchChildren(page, centerId),
      authorName,
    };

    for (let i = 0; i < 5; i++) {
      const [notice] = await sql`update classnote_notices set status='processing', processing_at=now()
        where id = (select id from classnote_notices where tenant_id=${tenant} and status='queued'
                    order by created_at limit 1 for update skip locked)
        returning id, body, targets`;
      if (!notice) break;
      log(`[notice] ${notice.id} 처리 시작 — 타깃 ${(notice.targets ?? []).length}건`);
      const results = [];
      for (const t of notice.targets ?? []) {
        try {
          results.push(await processTarget(page, { ...ctxBase, body: notice.body }, t));
        } catch (e) {
          results.push({ board: t.board, ok: false, note: `오류: ${String(e.message).slice(0, 80)}` });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      const status = okCount === results.length ? "success" : okCount > 0 ? "partial" : "failed";
      await sql`update classnote_notices set status=${status}, results=${sql.json(results)},
        processed_at=now(), error=${status === "failed" ? "전 타깃 실패 — results 참조" : null}
        where id=${notice.id}`;
      log(`[notice] ${notice.id} → ${status} (성공 ${okCount}/${results.length})`);
      processed++;
    }
  } finally {
    await page.close().catch(() => {});
  }
  return { processed };
}
