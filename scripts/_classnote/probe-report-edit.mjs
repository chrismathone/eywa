/**
 * scripts/_classnote/probe-report-edit.mjs — 게시된 리포트 **제자리 수정(PATCH/PUT)** 실측 probe (학원이).
 *
 * 배경: 삭제(DELETE)는 확정(204). 게시된 공지의 "수정 반영"도 되는지 확인 — CORS allow-methods 에 PATCH·PUT 있음.
 * 흐름: marker 게시 → id 조회 → 원본 content 확인 → PATCH {content:새내용} → GET로 반영 확인 →
 *       (PATCH 405면 PUT 재시도) → 마지막에 DELETE로 정리.
 *
 * ⚠️ 워커 PC(C:\eywa-sync-pc)에서 사람이 실행. 학원이(테스트 학생, 실 학부모 없음). DB 불필요.
 *   cd /d C:\eywa-sync-pc  후  node --env-file=.env.local scripts\_classnote\probe-report-edit.mjs
 */
import { launchBrowser } from "./classnote-core.mjs";
import {
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
  console.log("=== 게시 리포트 제자리 수정(PATCH) probe (학원이) ===\n");
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
    const original = `[probe] ${marker} 원본`;
    const post = await api(page, "/api/v1_2/reports/", "POST", {
      cls: board.id, child: cand.id, enrollment: enr.id, content: original, date_written: kstToday(), author_name: "인재원 학원", tz: "Asia/Seoul",
    });
    console.log(`[POST] ${post.status}`);

    // 2) id 조회
    const list = await api(page, `/api/v1_2/centers/${centerId}/reports/?page_size=20&child=${cand.id}&tz=Asia/Seoul&center_id=${centerId}`, "GET");
    const mine = listOf(list.json).find((r) => String(r.cls) === String(board.id) && r.content === original);
    if (!mine) {
      console.log("❌ 게시글 못 찾음(회신: 위 상태들).");
      return;
    }
    const id = mine.id;
    console.log(`→ id=${id}, 원본 content="${mine.content}"\n`);

    // 3) PATCH 로 content 수정 시도
    const edited = `[probe] ${marker} 수정됨 ✅`;
    let patch = await api(page, `/api/v1_2/reports/${id}/`, "PATCH", { content: edited });
    console.log(`[PATCH content] ${patch.status} ${patch.status >= 400 ? patch.text : ""}`);
    if (patch.status === 405) {
      // PATCH 불가면 PUT 전체 교체 시도(원 객체 필드 유지 + content 교체)
      const put = await api(page, `/api/v1_2/reports/${id}/`, "PUT", {
        cls: board.id, child: cand.id, enrollment: enr.id, content: edited, date_written: mine.date_written, author_name: mine.author_name, tz: "Asia/Seoul",
      });
      console.log(`[PUT content] ${put.status} ${put.status >= 400 ? put.text : ""}`);
      patch = put;
    }

    // 4) GET 로 반영 확인
    const after = await api(page, `/api/v1_2/reports/${id}/`, "GET");
    const nowContent = after.json?.content;
    console.log(`[GET after] ${after.status} · content="${nowContent}"`);
    const applied = nowContent === edited;
    console.log(applied ? "\n✅ 제자리 수정 성공 — 게시된 공지도 '수정→반영' 구현 가능" : "\n❌ 수정 반영 안 됨(회수 후 재발송 방식 유지)");

    // 5) 정리(삭제)
    const del = await api(page, `/api/v1_2/reports/${id}/`, "DELETE");
    console.log(`[cleanup DELETE] ${del.status}`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("probe 오류:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
