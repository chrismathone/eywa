// 설명서 생성기 1단계 — 촬영. 화면이 설명할 상태인지 검사를 통과해야만 PNG를 남긴다.
// node --env-file=.env.local scripts/_manual/capture.mjs [메뉴 | 메뉴/면]
import fs from "node:fs";
import { BASE, SHOTS, require, selectFaces, readPage, shotBase, demoSession, RESOLVERS, moduleEnabled } from "./lib.mjs";

const { chromium } = require("@playwright/test");
fs.mkdirSync(SHOTS, { recursive: true });

// 개발 서버에서만 뜨는 표시(Next 'N' 버튼·데이터 점검 도구)는 원장 화면에 없으므로 가린다.
const HIDE_DEV = "nextjs-portal, .tsqd-open-btn-container, .tsqd-parent-container { display:none !important; }";
const VIEWPORT = { width: 1600, height: 1000 };

const faces = selectFaces(process.argv[2]);
const sessions = {};
const browser = await chromium.launch({ channel: "chrome" });
const results = [];

async function contextFor(role) {
  if (!sessions[role]) {
    const s = await demoSession(role);
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" });
    await ctx.addCookies(s.cookies);
    // 첫 접속 안내 팝업은 기기 설정이라 촬영 브라우저에서만 '봤음'으로 둔다(계정 데이터는 안 건드린다).
    // 예시 데이터 표식('[데모]'·'demo-history:v1')·데모 계정 주소·데모 지점 이름은 촬영 화면의 **글자에서만** 바꾼다(데이터는 그대로).
    // 화면이 다시 그려져도 되돌아오지 않게 문서가 바뀔 때마다 다시 적용한다(입력 칸 값 포함).
    await ctx.addInitScript(() => {
      const fix = (t) => t.replace(/\[데모\]\s*/g, "").replace(/(메모:\s*)?demo-[a-z-]+:v\d+/g, "").replace(/injaewon@aywa\.co\.kr/g, "owner@example.com")
        .replace(/demo-(eng|math)-(\d+)@aywa\.co\.kr/g, (_, k, n) => `${k === "eng" ? "english" : "math"}${n}@example.com`).replace(/인재원 데모/g, "예시학원").replace(/데모 지점장/g, "원장").replace(/test@test.com/g, "staff@example.com");
      const run = () => {
        if (!document.body) return;
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { const v = fix(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
        for (const el of document.querySelectorAll("input, textarea")) { if (el.value) { const v = fix(el.value); if (v !== el.value) el.value = v; } }
        for (const el of document.querySelectorAll("[title]")) { const v = fix(el.getAttribute("title")); if (v !== el.getAttribute("title")) el.setAttribute("title", v); }
      };
      let q = false;
      new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(() => { q = false; run(); }); } }).observe(document, { subtree: true, childList: true, characterData: true });
      setInterval(run, 300);
    });
    await ctx.addInitScript(() => { try { localStorage.setItem("eywa-prefs", JSON.stringify({ state: { onboarded: true }, version: 0 })); localStorage.setItem("eywa-notify-banner-dismissed", "1"); } catch {} });
    sessions[role] = { ...s, ctx };
  }
  return sessions[role];
}

function locate(root, target) {
  if (target.help) return root.locator(`[data-help="${target.help}"]`).first();
  if (target.text) return root.getByText(target.text, { exact: true }).locator("visible=true").first();
  if (target.css) return root.locator(target.css).first();
  throw new Error("target 은 help · text · css 중 하나");
}

for (const f of faces) {
  const page = readPage(f);
  if (!page) { results.push({ id: f.id, status: "내용 파일 없음" }); continue; }
  if (page.shot === false) { results.push({ id: f.id, status: "글만(화면 예시 없음) — 건너뜀" }); continue; }
  const s = await contextFor(f.face.as ?? "master");
  if (!(await moduleEnabled(s.admin, s.tenantId, f.module))) { results.push({ id: f.id, status: `기능 꺼짐(${f.module}) — 건너뜀` }); continue; }
  let href = page.href;
  if (page.resolve) {
    const id = await RESOLVERS[page.resolve](s);
    if (!id) { results.push({ id: f.id, status: `상세 대상 없음(${page.resolve})` }); continue; }
    href = href.replace(":id", id);
  }
  const tab = await s.ctx.newPage();
  // 화면 폭: 창을 최대화하는 면·창이 아닌 화면은 A4 폭에 넣었을 때 글자가 읽히도록 조금 좁힌다.
  await tab.setViewportSize(page.viewport ?? (page.maximize ? { width: 1320, height: 900 } : (page.open ?? "window") === "page" ? { width: 1366, height: 900 } : VIEWPORT));
  try {
    // 개발 서버가 메모리 때문에 스스로 재시작하는 동안엔 연결이 끊긴다 — 잠시 기다렸다 다시 연다.
    for (let tries = 0; ; tries++) {
      try { await tab.goto(`${BASE}${href}`, { waitUntil: "load", timeout: 180_000 }); break; }
      catch (e) { if (tries >= 5 || !/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/.test(String(e))) throw e; await tab.waitForTimeout(15_000); }
    }
    // 실시간 연결이 열린 화면은 네트워크가 조용해지지 않는다 — 잠깐만 기다리고 넘어간다.
    await tab.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (tab.url().includes("/login")) throw new Error("로그인 화면으로 튕김");
    await tab.addStyleTag({ content: HIDE_DEV });
    // 창 화면은 바탕화면 위 창(iframe) 안쪽만 찍는다. 창이 아닌 화면(운영실)은 문서 그대로.
    let root = tab, frameEl = null;
    if ((page.open ?? "window") === "window") {
      // 표가 넓은 화면은 창을 최대화한 뒤 찍는다(기본 창 폭에선 오른쪽 열이 잘린다).
      if (page.maximize) {
        await tab.locator('[aria-label="최대화"]').last().click();
        await tab.waitForTimeout(800);
      }
      frameEl = tab.locator("iframe").last();
      await frameEl.waitFor({ timeout: 60_000 });
      root = await (await frameEl.elementHandle()).contentFrame();
      await root.waitForLoadState("load", { timeout: 120_000 });
      await root.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      // 창 안 화면이 실제로 그려질 때까지(스켈레톤·빈 문서가 아니라 글자가 선 상태).
      await root.waitForFunction(() => document.body && document.body.innerText.trim().length > 40 && !document.querySelector('[aria-busy="true"]'), null, { timeout: 90_000 });
      await root.addStyleTag({ content: HIDE_DEV });
    }
    for (const step of page.prepare ?? []) {
      if (step.click) await locate(root, step.click).click();
      // 입력만 채운다(저장 버튼은 누르지 않는다 — 촬영이 데이터를 바꾸지 않게).
      if (step.fill) await locate(root, step.fill).fill(step.value ?? "");
      if (step.wait) await tab.waitForTimeout(step.wait);
    }
    await tab.waitForTimeout(1500);

    // ── 촬영 전 검사 — 하나라도 걸리면 PNG를 남기지 않는다 ──
    const handles = [];
    const problems = [];
    for (const c of page.callouts) {
      const loc = locate(root, c.target);
      if (!(await loc.count())) { problems.push(`${c.n}번 '${c.label}' 칸이 화면에 없음`); handles.push(null); continue; }
      handles.push(await loc.elementHandle());
    }
    const report = await root.evaluate(({ els, labels, minRows }) => {
      const problems = [];
      const vis = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none"; };
      const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[role="alertdialog"]')].filter(vis);
      if (dialogs.length) problems.push(`팝업이 떠 있음: ${dialogs.map((d) => d.getAttribute("aria-label") ?? d.textContent.slice(0, 20)).join(", ")}`);
      const text = document.body.innerText;
      for (const bad of ["문제가 발생", "오류가 발생", "Application error", "권한이 없습니다", "페이지를 찾을 수 없"]) if (text.includes(bad)) problems.push(`화면에 '${bad}' 문구`);
      // '기록이 없습니다' 같은 빈 안내 한 줄은 행으로 세지 않는다.
      const rows = [...document.querySelectorAll("tbody tr")].filter((tr) => tr.querySelectorAll("td").length >= 2).length;
      if (rows < minRows) problems.push(`표 행이 ${rows}개뿐(최소 ${minRows}) — 예시 데이터 부족`);
      const boxes = [];
      els.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (!vis(el)) { problems.push(`${labels[i]} 칸이 숨어 있음`); return; }
        if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) problems.push(`${labels[i]} 칸이 화면 밖으로 잘림`);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && !el.contains(hit) && !hit.contains(el)) problems.push(`${labels[i]} 칸 위를 다른 것이 덮음`);
        boxes.push({ i, x: r.x, y: r.y, w: r.width, h: r.height });
      });
      // 아래쪽 자르기: 설명할 칸을 다 담되, 반쯤 잘린 표 행은 남기지 않는다.
      const needBottom = Math.max(0, ...boxes.map((b) => b.y + b.h));
      let bottom = innerHeight;
      const full = [...document.querySelectorAll("tbody tr")].map((tr) => tr.getBoundingClientRect()).filter((r) => r.bottom <= innerHeight && r.top >= 0);
      if (full.length) bottom = Math.max(needBottom + 8, Math.ceil(full[full.length - 1].bottom) + 1);
      // 내용이 끝난 아래의 빈 바탕은 자른다(글자·그림이 있는 가장 아래 요소 + 여백).
      let leaf = 0; const texts = []; // 배지가 피해야 할 글자 자리
      for (const el of document.body.querySelectorAll("*")) {
        if (el.children.length) continue;
        const media = /^(IMG|svg|INPUT|TEXTAREA|SELECT|BUTTON|CANVAS)$/.test(el.tagName);
        if (!media && !el.textContent.trim()) continue; // 글자 없는 빈 틀(바탕·여백 상자)은 내용이 아니다
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.width <= 0 || r.bottom > innerHeight || r.height > innerHeight * 0.8 || !vis(el)) continue;
        leaf = Math.max(leaf, r.bottom);
        if (texts.length < 800) texts.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      }
      if (leaf) bottom = Math.min(bottom, Math.max(needBottom + 8, Math.ceil(leaf) + 24));
      return { problems, boxes, rows, texts, w: innerWidth, h: Math.min(bottom, innerHeight) };
    }, { els: handles, labels: page.callouts.map((c) => `${c.n}번 '${c.label}'`), minRows: page.minRows ?? 0 });
    problems.push(...report.problems);
    if (problems.length) { results.push({ id: f.id, status: "촬영 중단", problems }); continue; }

    const box = frameEl ? await frameEl.boundingBox() : { x: 0, y: 0 };
    const base = shotBase(f);
    await tab.screenshot({ path: `${base}.png`, clip: { x: box.x, y: box.y, width: report.w, height: report.h } });
    const boxes = report.boxes.map((b) => ({ n: page.callouts[b.i].n, x: b.x, y: b.y, w: b.w, h: b.h }));
    fs.writeFileSync(`${base}.json`, JSON.stringify({ w: report.w, h: report.h, boxes, texts: report.texts.filter((t) => t.y < report.h), rows: report.rows, href, at: new Date().toISOString() }, null, 2));
    results.push({ id: f.id, status: "통과", note: `번호 ${boxes.length} · ${report.w}×${report.h}` });
  } catch (e) {
    results.push({ id: f.id, status: "촬영 오류", problems: [String(e.message ?? e).split("\n")[0]] });
  } finally {
    await tab.close();
  }
}
await browser.close();

for (const r of results) {
  console.log(`${r.status === "통과" ? "✓" : "✗"} ${r.id} — ${r.status}${r.note ? " · " + r.note : ""}`);
  for (const p of r.problems ?? []) console.log(`    - ${p}`);
}
process.exitCode = results.some((r) => r.status !== "통과" && !r.status.endsWith("건너뜀")) ? 1 : 0;
