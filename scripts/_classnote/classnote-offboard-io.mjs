// scripts/_classnote/classnote-offboard-io.mjs — 명부 퇴원처리(퇴소)의 **ClassNote 읽기·쓰기와 백업 올리기**. 흐름 = classnote-offboard.mjs · 판정 = classnote-offboard-plan.mjs.
//
// 🔴 판정에 쓰는 GET은 전부 `cache: "no-store"`(리뷰 B9 — 퇴소 직후 다시 읽은 명부가 캐시면 '처리 안 됨'·'다른 원아가 사라짐'을 잘못 본다).
// 글 목록(2026-11-03 실측): `reports/?child=&page_size=…` — `count`는 늘 1(쓸모없음) · 커서(`next`의 page 값)로 이어받을 때 **child 필터를 다시
//   붙이면** 새는 글이 없다(361건·148건 원아로 단일 요청과 id 집합 일치 · 새는 글 0). 그래도 받을 때마다 child가 그 원아인지 본다.
// 댓글(2026-11-03 실측): `GET /api/v1/reports/{글}/comments/?page_size=100` — DRF 봉투(count·next·results) · 칸 = id·created·author{type·name·username}·
//   author_name·content·emoticon_content·attached_images/files/video. 백업에는 이름·종류·본문·첨부 메타만 싣는다.
// 퇴소 API(2026-11-03 테스트 원아 '학원일'로 실측): `POST https://kapi.classnote.com/v1/centers/{c}/enrollments/out` `{"children":[원아]}` → 200 빈 본문.
//   🔴 이미 퇴소된 원아로 보내도 200 — 성공은 응답이 아니라 **명부를 다시 읽어** 가른다. 되돌리는 API는 없다. 한 번에 한 원아씩만 보낸다.

const KAPI = "https://kapi.classnote.com";

/** 그 원아의 센터 글 전부 — 커서로 이어받되 child 필터를 매번 붙이고, 받은 글이 전부 그 원아인지 본다. 끝까지 못 받으면 complete:false. */
export async function fetchChildPosts(page, centerId, childId) {
  return page.evaluate(
    async ([c, ch]) => {
      const posts = [];
      const seen = new Set();
      let cur = null;
      let pages = 0;
      for (let i = 0; i < 60; i++) {
        const qs = new URLSearchParams({ child: String(ch), page_size: "100", tz: "Asia/Seoul", center_id: String(c) });
        if (cur) qs.set("page", cur);
        let j;
        try {
          pages++;
          const r = await fetch(`/api/v1_2/centers/${c}/reports/?${qs}`, { headers: { accept: "application/json" }, cache: "no-store" });
          if (!r.ok) return { complete: false, posts, pages };
          j = await r.json();
        } catch {
          return { complete: false, posts, pages };
        }
        for (const p of j?.results ?? []) {
          if (Number(p.child) !== Number(ch)) return { complete: false, posts, pages }; // 필터가 풀렸다 — 남의 글이 섞인다
          if (!seen.has(p.id)) { seen.add(p.id); posts.push(p); }
        }
        if (!j?.next) return { complete: true, posts, pages };
        const n = String(j.next);
        cur = n.includes("page=") ? new URL(n, location.origin).searchParams.get("page") : n;
        if (!cur) return { complete: false, posts, pages };
      }
      return { complete: false, posts, pages }; // 6,000건 넘게 이어진다 — 끝을 확인하지 못했다
    },
    [centerId, childId],
  );
}

/**
 * 글마다 댓글 전부(댓글이 있다고 적힌 글만 부른다 · `next`로 이어받는다). 못 받은 글은 `complete`에 안 든다 — 그 원아는 내리지 않는다(B8).
 * @returns {Promise<{ complete: Set<number>, byPost: Map<number, any[]> }>}
 */
export async function fetchPostComments(page, postIds) {
  const got = await page.evaluate(async (ids) => {
    const out = [];
    let requests = 0;
    for (const id of ids) {
      const list = [];
      let url = `/api/v1/reports/${id}/comments/?page_size=100`;
      let ok = false;
      for (let i = 0; i < 20 && url; i++) {
        try {
          requests++;
          const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
          if (!r.ok) break;
          const j = await r.json();
          list.push(...(Array.isArray(j) ? j : j?.results ?? []));
          const next = Array.isArray(j) ? null : j?.next;
          if (!next) { ok = true; url = null; break; }
          const u = new URL(String(next), location.origin);
          url = `${u.pathname}${u.search}`;
        } catch {
          break;
        }
      }
      out.push({ id, ok, list });
    }
    return { out, requests };
  }, [...postIds]);
  const complete = new Set();
  const byPost = new Map();
  for (const g of got?.out ?? []) {
    if (g.ok) complete.add(Number(g.id));
    byPost.set(Number(g.id), g.list ?? []);
  }
  return { complete, byPost, requests: got?.requests ?? 0 };
}

/**
 * 그 해 퇴소 명부 원아 번호(실행 뒤 확인용 — tz 필수). **끝까지** 읽는다 — 봉투(next)면 다음 쪽을 따라가고, 배열 응답이 1,000건으로 꽉 차면
 * 뒤가 잘렸을 수 있어 throw(모르면 '확인 실패' → 멈춤 · 리뷰 R5).
 */
export async function leftIds(page, centerId, year) {
  const ids = await page.evaluate(async ([c, y]) => {
    const out = [];
    // 첫 쪽만 주소를 만들고, 그 뒤로는 봉투의 `next` 주소를 그대로 따라간다(쪽 번호를 직접 만들지 않는다 · 2차 리뷰 F9).
    let url = `/api/v1_2/centers/${c}/admissioninfos?name=&page=1&page_size=1000&year_left=${y}&tz=Asia/Seoul`;
    for (let p = 1; p <= 20; p++) {
      const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      if (!r.ok) throw new Error(`퇴소 명부 조회 실패 HTTP ${r.status}`);
      const j = await r.json();
      const rows = Array.isArray(j) ? j : j?.results ?? [];
      for (const x of rows) if (x.out_date) out.push(x.child_id);
      if (Array.isArray(j)) {
        if (rows.length >= 1000) throw new Error("퇴소 명부가 1,000건으로 꽉 차 끝까지 읽었는지 알 수 없습니다");
        return out;
      }
      if (!j?.next) return out;
      const u = new URL(String(j.next), location.origin);
      url = `${u.pathname}${u.search}`;
    }
    throw new Error("퇴소 명부를 끝까지 읽지 못했습니다(20쪽 넘음)");
  }, [centerId, year]);
  return new Set(ids.map(Number));
}

/** 퇴소 요청(한 원아) — 응답은 판정에 쓰지 않는다(이미 퇴소된 원아도 200). 통신 오류는 상태 0. */
export async function postOffboard(page, centerId, childId) {
  return page.evaluate(async ([url, ch]) => {
    try {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const r = await fetch(url, { method: "POST", credentials: "include", headers: { accept: "application/json", "content-type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) }, body: JSON.stringify({ children: [ch] }) });
      return r.status;
    } catch {
      return 0;
    }
  }, [`${KAPI}/v1/centers/${centerId}/enrollments/out`, childId]);
}

/**
 * 백업 올리기 — 내부 라우트에서 서명된 주소를 받아 PUT, 다시 물어 올라갔는지 본다. 실패는 throw(그 원아는 내리지 않는다).
 * 🔴 던지는 오류의 `message`는 **한국어 요약만**(보고서·감사로그에 그대로 실린다 · 리뷰 R10) — 통신 오류 등 원문은 `raw`에.
 */
export async function uploadOffboardBackup(args) {
  try {
    return await uploadOnce(args);
  } catch (e) {
    if (e?.korean) throw e;
    throw Object.assign(new Error("백업 서버와 통신하지 못했습니다"), { korean: true, raw: String(e?.message ?? e).slice(0, 300) });
  }
}
const fail = (message) => Object.assign(new Error(message), { korean: true });
async function uploadOnce({ tenant, childId, date, body, env = process.env, fetchImpl = fetch }) {
  const base = String(env.CLASSNOTE_SHARE_BASE || "").trim().replace(/\/$/, "");
  const secret = String(env.CLASSNOTE_INTERNAL_SECRET ?? "").trim();
  if (!base || !secret) throw fail("백업 올리기 설정(연동 PC의 웹 주소·내부 키)이 없습니다");
  const call = (extra) => fetchImpl(`${base}/api/internal/classnote-offboard-backup`, {
    method: "POST", cache: "no-store", redirect: "error", headers: { "content-type": "application/json", "x-eywa-internal": secret },
    body: JSON.stringify({ tenantId: tenant, childId, date, ...extra }),
  });
  const res = await call({});
  if (!res.ok) throw fail(`백업 올리기 주소를 받지 못했습니다(HTTP ${res.status})`);
  const { signedUrl, path } = await res.json();
  if (!signedUrl) throw fail("백업 올리기 주소가 비었습니다");
  const text = JSON.stringify(body);
  const put = await fetchImpl(signedUrl, { method: "PUT", headers: { "content-type": "application/json", "x-upsert": "true" }, body: text });
  if (!put.ok) throw fail(`백업을 올리지 못했습니다(HTTP ${put.status})`);
  const check = await call({ verify: true });
  const got = check.ok ? await check.json().catch(() => null) : null;
  if (!got?.exists || Number(got.size) < Buffer.byteLength(text)) throw fail("올린 백업을 확인하지 못했습니다");
  return { path, bytes: Buffer.byteLength(text) };
}
