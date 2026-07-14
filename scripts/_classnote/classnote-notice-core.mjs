/**
 * scripts/_classnote/classnote-notice-core.mjs — 반/학부모 공지 큐(classnote_notices) 처리 코어.
 *
 * eywa 서버 액션(sendClassNotice / sendOnescreenNotice)이 큐에 넣은 공지를 잡아, 각 타깃 학생의 ClassNote
 * 개별 보드에 **내부 API로 직접 게시**한다(`POST /api/v1_2/reports/`). watch-classnote-queue.mjs(연동 PC 데몬)가 매 폴 호출.
 *
 * 게시 후 **리포트 id를 조회해 results[].reports 에 저장**(회수용) — 게시 응답은 빈 201이라 id가 없어
 * `GET /api/v1_2/centers/{center}/reports/?child=…` 목록에서 방금 글(cls+child+content)을 찾는다(2026-07-14 실측 확정).
 * **개인화 본문(target.body)** 지원(태그 치환은 eywa에서 per-target 렌더) — 단 **공유 보드(2가족+)엔 개인화 게시 금지**
 * (fan-out이 다른 가족에게 남 이름을 노출하는 것 차단). **게시취소(회수)**: eywa가 status='revoke_requested'로 표시하면
 * 저장된 리포트 id를 GET로 (cls/child) 대조 후 `DELETE /api/v1_2/reports/{id}/`(204) — 엉뚱한 id로 남 글 삭제 방지.
 *
 * 안전장치: 실게시·회수는 --post + classnoteSendEnabled(킬스위치) 확인. 타깃별 실패는 그 타깃만 기록(results).
 */
import { isClassnoteSendEnabled } from "./classnote-core.mjs";
import {
  CLASSNOTE_BASE,
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

/** 알림장 게시(내부 API). enrollment = 원아↔보드 연결 id. 응답은 빈 201이라 status만. */
async function postReport(page, { clsId, childId, enrollmentId, content, authorName }) {
  return page.evaluate(
    async ([cls, child, enrollment, body, author, date]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch("/api/v1_2/reports/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ cls, child, enrollment, content: body, date_written: date, author_name: author, tz: "Asia/Seoul" }),
      });
      return { status: res.status };
    },
    [clsId, childId, enrollmentId, content, authorName, kstToday()],
  );
}

/** 방금 게시한 리포트 id 조회 — centers/{center}/reports/?child= 목록(최신순)에서 cls+child+content 매칭. 실패 시 null. */
async function findReportId(page, centerId, { cls, child, content }) {
  const list = await page.evaluate(
    async ([center, ch]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch(
        `/api/v1_2/centers/${center}/reports/?page_size=20&child=${ch}&tz=Asia/Seoul&center_id=${center}`,
        { headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) } },
      );
      if (!res.ok) return null;
      const j = await res.json().catch(() => null);
      return Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : [];
    },
    [centerId, child],
  );
  if (!list) return null;
  const match =
    list.find((r) => String(r.cls) === String(cls) && String(r.child) === String(child) && r.content === content) ||
    list.find((r) => String(r.cls) === String(cls) && String(r.child) === String(child)); // content 미저장 폴백=최신
  return match?.id ?? null;
}

/** 리포트 단건 조회(회수 전 대조) — {status, cls, child}. */
async function getReport(page, id) {
  return page.evaluate(async (i) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const res = await fetch(`/api/v1_2/reports/${i}/`, {
      headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, cls: j.cls, child: j.child };
  }, id);
}

/** 리포트 삭제 — DELETE /api/v1_2/reports/{id}/ (204). */
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

/** 리포트 제자리 수정 — PATCH /api/v1_2/reports/{id}/ {content} (200, 2026-07-14 학원이 실측). */
async function patchReport(page, id, content) {
  return page.evaluate(
    async ([i, c]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch(`/api/v1_2/reports/${i}/`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ content: c }),
      });
      return { status: res.status };
    },
    [id, content],
  );
}

/** 타깃 1건 처리 — 보드·원아·enrollment 해석 후 게시 + 리포트 id 캡처. 실패 사유는 한글 note. */
async function processTarget(page, ctx, target) {
  const board = ctx.boardByNorm.get(norm(target.board));
  if (!board) return { board: target.board, ok: false, note: "보드 없음(프로비저닝 필요)" };
  const clean = (target.studentName || "").replace(/[a-zA-Z]/g, "").trim();
  const cands = ctx.children.filter((c) => {
    const keys = childKeys(c.name);
    return keys.has(target.studentName) || keys.has(clean);
  });
  if (cands.length === 0) return { board: target.board, ok: false, note: "학부모 미가입(초대 필요)" };
  const enrolled = [];
  for (const c of cands) {
    const detail = await fetchChildDetail(page, c.id);
    const e = (detail.enrollment ?? []).find((x) => x.belong_to_class === board.id && !x.removed_child);
    if (e) enrolled.push({ child: c, enrollment: e });
  }
  if (enrolled.length === 0) return { board: target.board, ok: false, note: "보드 미배정(배정 필요)" };

  // 개인화 본문(target.body, 태그 치환됨)은 **공유 보드(2가족+)에 fan-out 금지** — 다른 가족에게 남 아이 이름 노출 차단.
  const personalized = target.body != null;
  const content = personalized ? target.body : ctx.body;
  if (personalized && enrolled.length > 1) {
    return { board: target.board, ok: false, note: "공유 보드(2가족+) — 개인화 공지 차단(일반 공지로 보내세요)" };
  }

  // 이중 등록(부모 계정 2개)이면 전원에게 게시. 성공한 글은 reports[]에 남겨 부분성공도 회수 가능하게.
  const reports = [];
  for (const { child, enrollment } of enrolled) {
    const res = await postReport(page, {
      clsId: board.id,
      childId: child.id,
      enrollmentId: enrollment.id,
      content,
      authorName: ctx.authorName,
    });
    if (res.status < 200 || res.status >= 300) {
      return { board: target.board, ok: false, note: `게시 실패(HTTP ${res.status})`, reports };
    }
    // 게시 성공 → 회수용 id 조회(실패해도 게시는 유지 = id null=회수불가 표시). cls/child 저장(회수 대조용).
    const id = await findReportId(page, ctx.centerId, { cls: board.id, child: child.id, content }).catch(() => null);
    reports.push({ id: id ?? null, url: id ? `${CLASSNOTE_BASE}/service/report/${id}` : null, cls: board.id, child: child.id });
  }
  return { board: target.board, ok: true, reports };
}

/** 게시취소(회수) 1건 — 저장된 reports[].id를 GET 대조(cls/child) 후 DELETE. results를 회수 결과로 갱신. */
async function revokeNotice(page, notice) {
  const results = Array.isArray(notice.results) ? notice.results : [];
  let deleted = 0;
  let failed = 0;
  let missing = 0;
  const out = [];
  for (const r of results) {
    const reps = Array.isArray(r.reports) ? r.reports : [];
    const revoked = [];
    for (const rep of reps) {
      if (rep.id == null) {
        missing++;
        revoked.push({ ...rep, revoked: false, note: "id 미보유(회수 불가)" });
        continue;
      }
      const chk = await getReport(page, rep.id).catch(() => ({ status: 0 }));
      if (chk.status === 404) {
        deleted++;
        revoked.push({ ...rep, revoked: true, note: "이미 삭제됨" });
        continue;
      }
      // cls/child 대조 — 엉뚱한 id로 남 글 삭제 방지.
      const mismatch =
        chk.status !== 200 ||
        (rep.cls != null && String(chk.cls) !== String(rep.cls)) ||
        (rep.child != null && String(chk.child) !== String(rep.child));
      if (mismatch) {
        failed++;
        revoked.push({ ...rep, revoked: false, note: `대조 불일치/접근불가(${chk.status}) — 회수 안 함` });
        continue;
      }
      const del = await deleteReport(page, rep.id).catch(() => ({ status: 0 }));
      if (del.status >= 200 && del.status < 300) {
        deleted++;
        revoked.push({ ...rep, revoked: true });
      } else {
        failed++;
        revoked.push({ ...rep, revoked: false, note: `삭제 실패(${del.status})` });
      }
    }
    out.push({ board: r.board, revoked });
  }
  return { out, deleted, failed, missing };
}

/** 게시 공지 제자리 수정 1건 — 저장된 reports[].id를 GET 대조(cls/child) 후 PATCH {content: notice.body(새 내용)}. */
async function editNotice(page, notice) {
  const results = Array.isArray(notice.results) ? notice.results : [];
  const content = notice.body ?? "";
  let edited = 0;
  let failed = 0;
  let missing = 0;
  const out = [];
  for (const r of results) {
    const reps = Array.isArray(r.reports) ? r.reports : [];
    const patched = [];
    for (const rep of reps) {
      if (rep.id == null || rep.revoked) {
        missing++;
        patched.push({ ...rep }); // 회수됨/ id없음 = 수정 대상 아님(그대로 보존)
        continue;
      }
      const chk = await getReport(page, rep.id).catch(() => ({ status: 0 }));
      if (chk.status === 404) {
        missing++;
        patched.push({ ...rep, note: "이미 삭제됨" });
        continue;
      }
      const mismatch =
        chk.status !== 200 ||
        (rep.cls != null && String(chk.cls) !== String(rep.cls)) ||
        (rep.child != null && String(chk.child) !== String(rep.child));
      if (mismatch) {
        failed++;
        patched.push({ ...rep, note: `대조 불일치/접근불가(${chk.status}) — 수정 안 함` });
        continue;
      }
      const pt = await patchReport(page, rep.id, content).catch(() => ({ status: 0 }));
      if (pt.status >= 200 && pt.status < 300) {
        edited++;
        patched.push({ ...rep });
      } else {
        failed++;
        patched.push({ ...rep, note: `수정 실패(${pt.status})` });
      }
    }
    out.push({ board: r.board, reports: patched });
  }
  return { out, edited, failed, missing };
}

/**
 * 큐 1회 처리 — 게시(queued) + 게시취소(revoke_requested) + 게시본 수정(edit_requested). stale 복구 후 하나씩 클레임(SKIP LOCKED).
 * post=false(dry-run)면 클레임하지 않고 개수만 보고. 게시는 classnoteSendEnabled 킬스위치도 확인(회수·수정은 정리/정정이라 미적용).
 */
export async function processNoticesOnce(sql, browser, { tenant, post, log = console.log, authorName = "인재원 학원" }) {
  // stale 복구 — 크래시로 갇힌 처리중 상태
  await sql`update classnote_notices set status='queued', processing_at=null
    where tenant_id=${tenant} and status='processing' and processing_at < now() - interval '${sql.unsafe(String(STUCK_MIN))} minutes'`;
  await sql`update classnote_notices set status='revoke_requested', processing_at=null
    where tenant_id=${tenant} and status='revoking' and processing_at < now() - interval '${sql.unsafe(String(STUCK_MIN))} minutes'`;
  await sql`update classnote_notices set status='edit_requested', processing_at=null
    where tenant_id=${tenant} and status='editing' and processing_at < now() - interval '${sql.unsafe(String(STUCK_MIN))} minutes'`;

  const [{ n }] = await sql`select count(*)::int as n from classnote_notices where tenant_id=${tenant} and status='queued'`;
  const [{ r }] = await sql`select count(*)::int as r from classnote_notices where tenant_id=${tenant} and status='revoke_requested'`;
  const [{ e }] = await sql`select count(*)::int as e from classnote_notices where tenant_id=${tenant} and status='edit_requested'`;
  if (!n && !r && !e) return { processed: 0 };
  if (!post) {
    log(`[notice] 대기 게시 ${n}건 · 회수 ${r}건 · 수정 ${e}건 — dry-run(--post 없음)`);
    return { processed: 0, pending: n + r + e };
  }
  const sendOk = await isClassnoteSendEnabled(sql, tenant);
  if (n && !sendOk) log("[notice] classnoteSendEnabled OFF — 게시 중단(큐 보존). 회수는 진행.");

  const page = await browser.newPage();
  let processed = 0;
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);

    // ── 게시(queued) — 킬스위치 ON일 때만 ──
    if (n && sendOk) {
      const boards = await fetchBoards(page, centerId);
      const ctxBase = {
        centerId,
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
        log(`[notice] ${notice.id} 게시 시작 — 타깃 ${(notice.targets ?? []).length}건`);
        const results = [];
        for (const t of notice.targets ?? []) {
          try {
            results.push(await processTarget(page, { ...ctxBase, body: notice.body }, t));
          } catch (e) {
            results.push({ board: t.board, ok: false, note: `오류: ${String(e.message).slice(0, 80)}` });
          }
        }
        const okCount = results.filter((x) => x.ok).length;
        const status = okCount === results.length ? "success" : okCount > 0 ? "partial" : "failed";
        await sql`update classnote_notices set status=${status}, results=${sql.json(results)},
          processed_at=now(), error=${status === "failed" ? "전 타깃 실패 — results 참조" : null}
          where id=${notice.id}`;
        log(`[notice] ${notice.id} → ${status} (성공 ${okCount}/${results.length})`);
        processed++;
      }
    }

    // ── 게시취소(revoke_requested) — 저장된 리포트 id 삭제 ──
    for (let i = 0; i < 5; i++) {
      const [rev] = await sql`update classnote_notices set status='revoking', processing_at=now()
        where id = (select id from classnote_notices where tenant_id=${tenant} and status='revoke_requested'
                    order by created_at limit 1 for update skip locked)
        returning id, results`;
      if (!rev) break;
      const { out, deleted, failed, missing } = await revokeNotice(page, rev);
      const status = failed === 0 ? "revoked" : "revoke_partial";
      await sql`update classnote_notices set status=${status}, results=${sql.json(out)}, processed_at=now(),
        error=${failed ? `회수 실패 ${failed}건` : null} where id=${rev.id}`;
      log(`[notice] ${rev.id} 회수 → ${status} (삭제 ${deleted}·실패 ${failed}·id없음 ${missing})`);
      processed++;
    }

    // ── 게시본 수정(edit_requested) — 저장된 리포트 id에 새 내용 PATCH ──
    for (let i = 0; i < 5; i++) {
      const [ed] = await sql`update classnote_notices set status='editing', processing_at=now()
        where id = (select id from classnote_notices where tenant_id=${tenant} and status='edit_requested'
                    order by created_at limit 1 for update skip locked)
        returning id, body, results`;
      if (!ed) break;
      const { out, edited, failed, missing } = await editNotice(page, ed);
      // 수정 후에도 게시 상태 유지(reports 보존 → 재수정·회수 가능). 전건 성공=success, 일부 실패=partial.
      const status = failed === 0 ? "success" : "partial";
      await sql`update classnote_notices set status=${status}, results=${sql.json(out)}, processed_at=now(),
        error=${failed ? `수정 실패 ${failed}건` : null} where id=${ed.id}`;
      log(`[notice] ${ed.id} 수정 → ${status} (반영 ${edited}·실패 ${failed}·대상아님 ${missing})`);
      processed++;
    }
  } finally {
    await page.close().catch(() => {});
  }
  return { processed };
}
