/**
 * 읽기 전용 조사(GET만) — ClassNote 피드의 `attached_images` 항목 모양과 사진 주소의 성질(로그인 없이 열리나·만료 파라미터가 있나)을 본다.
 * 출력은 **모양뿐**이다: 키 이름·값 종류·주소의 호스트/경로 모양(경로 조각은 전부 가림 — 경로가 곧 열람 열쇠다)·쿼리 파라미터 *이름*·무로그인 GET의 상태코드. 글 내용·이름·주소 전문은 찍지 않는다.
 * 실행: CLASSNOTE_UPLOAD_ID/PW 환경변수 필요(워커와 같은 계정). 쓰기 요청 없음 — 피드 목록 GET 1번 + 사진 주소 무로그인 GET 최대 3번.
 */
import { fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";

// 사진 주소는 경로 자체가 열쇠다(서명 없는 capability URL) — 마지막 파일 이름 모양만 남기고 경로 조각은 전부 가린다.
const mask = (s) => String(s).replace(/\/[^/]+(?=\/)/g, "/<seg>").replace(/[0-9]{2,}/g, "<n>");
const shape = (v) => (v === null ? "null" : Array.isArray(v) ? `array(${v.length})` : typeof v);

const browser = await launchAdminBrowser();
try {
  const page = await browser.newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  const body = await page.evaluate(async ({ centerId }) => {
    const qs = new URLSearchParams({ page_size: "100", tz: "Asia/Seoul", center_id: String(centerId) });
    const r = await fetch(`/api/v1_2/centers/${centerId}/reports/?${qs}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, { centerId });
  const rows = body.results ?? [];
  const withImg = rows.filter((r) => Array.isArray(r.attached_images) && r.attached_images.length);
  console.log(`피드 ${rows.length}행 · 사진 첨부 ${withImg.length}행 · 학부모 글 사진 ${withImg.filter((r) => r.author?.type === "parent").length}행`);
  const keys = new Map();
  const urlShapes = new Map();
  const samples = [];
  for (const r of withImg) {
    for (const img of r.attached_images) {
      for (const [k, v] of Object.entries(img ?? {})) {
        keys.set(k, shape(v));
        if (typeof v === "string" && /^https?:\/\//.test(v)) {
          try {
            const u = new URL(v);
            const sig = `${k}: ${u.host}${mask(u.pathname)} ? ${[...u.searchParams.keys()].join(",") || "(쿼리 없음)"}`;
            urlShapes.set(sig, (urlShapes.get(sig) ?? 0) + 1);
            if (samples.length < 3 && k === "large") samples.push(v); // 학부모 사진이 피드에 없을 수 있어 작성자 무관하게 같은 CDN 주소 모양을 본다
          } catch { /* skip */ }
        }
      }
    }
  }
  console.log("항목 키:", Object.fromEntries(keys));
  console.log("주소 모양:", Object.fromEntries(urlShapes));
  const rowKeys = new Set();
  for (const r of withImg) for (const k of Object.keys(r)) rowKeys.add(k);
  console.log("행 키(참고):", [...rowKeys].filter((k) => /image|media|attach|photo|thumb/i.test(k)));
  for (const u of samples) {
    try {
      const res = await fetch(u, { method: "GET", redirect: "manual", headers: { range: "bytes=0-0" } });
      console.log("무로그인 GET", mask(new URL(u).host + new URL(u).pathname), "→", res.status, res.headers.get("content-type"), res.headers.get("cache-control") ?? "");
    } catch (e) {
      console.log("무로그인 GET 실패", e.message);
    }
  }
} finally {
  await browser.close();
}
