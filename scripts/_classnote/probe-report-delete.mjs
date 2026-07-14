/**
 * scripts/_classnote/probe-report-delete.mjs — 리포트 id 조회 + 삭제 end-to-end (v4·최종).
 *
 * v3 발견: 리포트 목록 = GET /api/v1_2/centers/{centerId}/reports/?page_size=N&tz=Asia/Seoul&center_id={centerId}
 *   → 배열(최신순), 항목에 id·cls·child·child_name·date_written 등. (POST 응답은 빈 201, id 없음.)
 * v4: marker 게시 → 그 목록에서 (cls==board && child==child, marker/최신) 글의 id 확보 → GET → DELETE(/reports/{id}/) → GET(404 확인).
 *
 * ⚠️ 워커 PC(C:\eywa-sync-pc)에서 사람이 실행. DB 불필요.
 *   cd /d C:\eywa-sync-pc  후  node --env-file=.env.local scripts\_classnote\probe-report-delete.mjs
 */
import { launchBrowser } from "./classnote-core.mjs";
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

const TEST_BOARD = "(수학)학원이";
const TEST_NAME = "학원이";

function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

async function api(page, path, method, body) {
  return page.evaluate(
    async ([p, m, b]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch(p, {
        method: m,
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        ...(b ? { body: JSON.stringify(b) } : {}),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* */
      }
      return { status: res.status, json, text: text.slice(0, 300) };
    },
    [path, method, body ?? null],
  );
}

const listOf = (j) => (Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : []);

async function main() {
  console.log("=== 리포트 삭제 end-to-end probe v4 (학원이) ===\n");
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    const boards = await fetchBoards(page, centerId);
    const board = boards.find((b) => norm(b.name) === norm(TEST_BOARD));
    const children = await fetchChildren(page, centerId);
    const cand = children.find((c) => childKeys(c.name).has(TEST_NAME));
    const detail = await fetchChildDetail(page, cand.id);
    const enr = (detail.enrollment ?? []).find((x) => x.belong_to_class === board.id && !x.removed_child);
    console.log(`✓ center=${centerId} board=${board.id} child=${cand.id} enrollment=${enr.id}\n`);

    // 1) marker 게시
    const marker = `PROBE-${Date.now()}`;
    const post = await api(page, "/api/v1_2/reports/", "POST", {
      cls: board.id,
      child: cand.id,
      enrollment: enr.id,
      content: `[probe] ${marker} — 자동 삭제`,
      date_written: kstToday(),
      author_name: "인재원 학원",
      tz: "Asia/Seoul",
    });
    console.log(`[POST] status=${post.status}`);

    // 2) 목록 조회 — child 필터 지원 여부도 함께 확인
    const base = `/api/v1_2/centers/${centerId}/reports/`;
    const withChild = await api(page, `${base}?page_size=20&child=${cand.id}&tz=Asia/Seoul&center_id=${centerId}`, "GET");
    const plain = await api(page, `${base}?page_size=20&tz=Asia/Seoul&center_id=${centerId}`, "GET");
    console.log(`[LIST ?child=] status=${withChild.status} · ${listOf(withChild.json).length}건`);
    console.log(`[LIST plain ] status=${plain.status} · ${listOf(plain.json).length}건`);

    // 첫 리포트 객체 전체(필드 확인 — content 존재 여부)
    const pool = listOf(withChild.json).length ? listOf(withChild.json) : listOf(plain.json);
    if (pool[0]) console.log(`\n[리포트 객체 예시]\n${JSON.stringify(pool[0], null, 2).slice(0, 900)}\n`);

    // 3) 우리 글 찾기 — cls+child 일치 + (content marker 있으면 그걸로, 없으면 최신 1건)
    const mine =
      pool.find((r) => String(r.child) === String(cand.id) && String(r.cls) === String(board.id) && typeof r.content === "string" && r.content.includes(marker)) ||
      pool.find((r) => String(r.child) === String(cand.id) && String(r.cls) === String(board.id));
    if (!mine) {
      console.log("❌ 목록에서 방금 글을 못 찾음 — 위 예시 객체/필드를 회신해 주세요.");
      return;
    }
    const id = mine.id;
    console.log(`→ 찾은 리포트 id=${id} (content 매칭=${typeof mine.content === "string" && mine.content.includes(marker)}) · URL ${CLASSNOTE_BASE}/service/report/${id}`);

    // 4) GET → DELETE → GET
    const g1 = await api(page, `/api/v1_2/reports/${id}/`, "GET");
    console.log(`[GET before] ${g1.status}`);
    let del = await api(page, `/api/v1_2/reports/${id}/`, "DELETE");
    console.log(`[DELETE /reports/${id}/] ${del.status} ${del.status >= 400 ? del.text : ""}`);
    if (del.status === 404 || del.status === 405) {
      del = await api(page, `/api/v1_2/reports/${id}`, "DELETE");
      console.log(`[DELETE /reports/${id}] ${del.status} (무슬래시)`);
    }
    const g2 = await api(page, `/api/v1_2/reports/${id}/`, "GET");
    console.log(`[GET after] ${g2.status} (404=삭제됨)\n`);

    const ok = del.status >= 200 && del.status < 300;
    console.log(ok ? "✅ 삭제 성공 — 회수(게시취소) 구현 가능. child 필터 지원=" + (withChild.status === 200 && listOf(withChild.json).length > 0) : `❌ 삭제 실패(${del.status})`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("probe 오류:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
