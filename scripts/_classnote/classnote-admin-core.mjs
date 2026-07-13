/**
 * scripts/_classnote/classnote-admin-core.mjs — ClassNote 기관설정(반 생성·학생 배정) 자동화 공용 헬퍼.
 *
 * 발송 워커(classnote-core.mjs)와 별개 모듈 — 워커는 게시만 하고, 이쪽은 기관설정 화면(반 정보 관리·
 * 학생 관리)을 Playwright로 조작한다. 원본 스펙 = Edutrix repo scripts/{create_classnote_classes,
 * assign_student_to_individual_class}.js (Puppeteer → Playwright 이식, 자격증명 하드코딩 제거).
 * 배경/구조 근거 = docs/classnote-integration.md §3 "왜 학생 1명=반 1개인가".
 */
import { chromium } from "@playwright/test";

export const CLASSNOTE_BASE = "https://www.classnote.com";

/** 공백 전부 제거 정규화 — Cloud Run 게시 함수의 반 매칭 규칙과 동일(공백제거 완전일치). */
export function norm(s) {
  return (s || "").replace(/\s/g, "");
}

/** eywa 과목 키 그룹 → ClassNote 보드 prefix. 발송 화이트리스트(classnote-guard)와 동일 매핑. */
export const BOARD_GROUPS = {
  math: { label: "수학", prefix: "(수학)", subjectKeys: ["math", "subject_1"] },
  english: { label: "영어", prefix: "(영어)", subjectKeys: ["english"] },
};

export function launchAdminBrowser({ headed = false } = {}) {
  return chromium.launch({ headless: !headed });
}

/** ClassNote 로그인 — env CLASSNOTE_UPLOAD_ID/PW(발송 워커와 동일 계정). 실패 시 throw. */
export async function loginClassnote(page) {
  const id = process.env.CLASSNOTE_UPLOAD_ID;
  const pw = process.env.CLASSNOTE_UPLOAD_PW;
  if (!id || !pw) throw new Error("CLASSNOTE_UPLOAD_ID / CLASSNOTE_UPLOAD_PW env가 필요합니다");
  await page.goto(`${CLASSNOTE_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[type="text"], input[type="email"]', { timeout: 15000 });
  await page.locator('input[type="text"], input[type="email"]').first().fill(id);
  await page.locator('input[type="password"]').first().fill(pw);
  const btn = page.locator("button, input[type=submit]").filter({ hasText: /로그인/ }).first();
  if (await btn.count()) await btn.click();
  else await page.keyboard.press("Enter");
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 30000 });
}

/** 서비스 페이지 진입 시 뜨는 호칭 다이얼로그 — '관리자' 선택 후 확인(Cloud Run 함수와 동일 처리). */
export async function dismissHonorificDialog(page) {
  try {
    const present = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!(dlg && /호칭/.test(dlg.textContent || ""));
    });
    if (!present) return false;
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('div[data-testid^="lastNick"]'));
      for (const c of containers) {
        for (const p of c.querySelectorAll("p")) {
          const t = (p.textContent || "").trim();
          if (t === "관리자" || t.toLowerCase() === "manager") {
            const radio = c.querySelector("button");
            if (radio) {
              radio.scrollIntoView({ block: "center" });
              radio.click();
              return;
            }
          }
        }
      }
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return;
      const ok = Array.from(dlg.querySelectorAll("button")).find((b) =>
        /^(확인|선택\s*완료|완료)$/.test((b.innerText || "").trim()),
      );
      if (ok) ok.click();
    });
    await page.waitForTimeout(800);
    return true;
  } catch {
    return false;
  }
}

/**
 * 무한스크롤/지연로드 목록 수집 — extract(페이지 내 실행 함수)가 주는 문자열들을 스크롤하며 합치고,
 * settleRounds 회 연속 증가가 없으면 완료로 판단. 반 정보 관리(보드 ~600개)·학생 관리 목록 공용.
 */
export async function collectStable(page, extract, { rounds = 60, settleRounds = 4, delay = 700 } = {}) {
  const names = new Set();
  let stable = 0;
  for (let i = 0; i < rounds && stable < settleRounds; i++) {
    const batch = await page.evaluate(extract);
    const before = names.size;
    for (const n of batch) names.add(n);
    await page.evaluate(() => {
      window.scrollBy(0, 1600);
      let best = null;
      for (const el of document.querySelectorAll("div, main, section, ul")) {
        if (el.scrollHeight > el.clientHeight + 100 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
      }
      if (best) best.scrollTop += 1600;
    });
    await page.waitForTimeout(delay);
    stable = names.size === before ? stable + 1 : 0;
  }
  return [...names];
}

// ── 내부 REST(api/v1) 판독 — 로그인 세션 쿠키로 same-origin GET(읽기 전용) ──────────────────
// 반 정보 관리 화면의 무한스크롤 스크래핑은 비결정적(가상 목록이 라운드마다 다르게 수집돼 기존 보드를
// "누락"으로 오판 → 중복 생성 시도)이라, 실사에서 확인한 DRF 엔드포인트로 교체(2026-07-10).
// count 613 실측 = 화면 전수와 일치. 쓰기는 여전히 DOM(반 추가하기) — API 쓰기는 미검증이라 안 씀.

export async function fetchCenterId(page) {
  const j = await page.evaluate(async () => {
    const r = await fetch("/api/v1/me/info/", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("me/info " + r.status);
    return r.json();
  });
  const id = j?.center?.id;
  if (!id) throw new Error("center id를 확인하지 못함(me/info)");
  return id;
}

/** DRF 페이지네이션 전건 수집 — next가 페이지 번호로 오는 형식(실측). */
export async function fetchAllDrf(page, path) {
  const out = [];
  let pageNo = 1;
  for (let i = 0; i < 50; i++) {
    const j = await page.evaluate(
      async ([p, n]) => {
        const sep = p.includes("?") ? "&" : "?";
        const r = await fetch(`${p}${sep}page=${n}&page_size=100`, { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(`${p} ${r.status}`);
        return r.json();
      },
      [path, pageNo],
    );
    out.push(...(j.results ?? []));
    if (!j.next) break;
    pageNo = typeof j.next === "number" ? j.next : pageNo + 1;
  }
  return out;
}

/** 반(보드) 전건 — {id, name, children(배정 승인 원아 수)}. */
export async function fetchBoards(page, centerId) {
  const rows = await fetchAllDrf(page, `/api/v1/centers/${centerId}/classes`);
  return rows.map((r) => ({ id: r.id, name: (r.name || "").trim(), children: r.approved_children ?? 0 }));
}

/** 가입(승인) 원아 전건 — 표시명 목록. 영문닉(한글) 형식 존재("Jay(이재희)") — 매칭은 호출측 childKeys로. */
export async function fetchChildren(page, centerId) {
  const rows = await fetchAllDrf(page, `/api/v1/centers/${centerId}/children`);
  return rows.map((r) => (r.name || "").trim()).filter(Boolean);
}

/** ClassNote 원아 표시명 → 매칭 키 집합(원문·알파벳 제거·괄호 안 한글). */
export function childKeys(name) {
  const keys = new Set();
  const t = (name || "").trim();
  if (!t) return keys;
  keys.add(t);
  const stripped = t.replace(/[a-zA-Z]/g, "").replace(/[()]/g, "").trim();
  if (stripped) keys.add(stripped);
  const paren = t.match(/\(([가-힣]{2,6})\)/);
  if (paren) keys.add(paren[1]);
  return keys;
}

/**
 * 모달([role=dialog]) 안 무한스크롤 수집 — collectStable의 모달 스코프 판. extract는 dialog 루트를 받는
 * 페이지 내 함수 문자열이 아니라, dialog 내부 button들의 innerText 배열을 그대로 돌려준다(분류는 호출측).
 * onRound(texts)로 라운드마다 개입 가능(예: [ALL] 아코디언 발견 시 클릭).
 */
export async function collectModalButtons(page, { rounds = 80, settleRounds = 5, delay = 600, onRound } = {}) {
  const texts = new Set();
  let stable = 0;
  for (let i = 0; i < rounds && stable < settleRounds; i++) {
    const batch = await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]');
      if (!dlg) return [];
      return Array.from(dlg.querySelectorAll("button"))
        .map((b) => (b.innerText || "").trim().replace(/\n+/g, "|"))
        .filter(Boolean);
    });
    const before = texts.size;
    for (const t of batch) texts.add(t);
    if (onRound) await onRound(batch);
    await page.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"]');
      if (!dlg) return;
      let best = null;
      for (const el of dlg.querySelectorAll("div, ul, section")) {
        if (el.scrollHeight > el.clientHeight + 50 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
      }
      if (best) best.scrollTop += 1400;
    });
    await page.waitForTimeout(delay);
    stable = texts.size === before ? stable + 1 : 0;
  }
  return [...texts];
}

/** 반 정보 관리 페이지에서 학생모드 보드명((수학)…/(영어)…) 전수 수집. */
export async function scrapeStudentBoards(page) {
  await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  await dismissHonorificDialog(page);
  return collectStable(page, () => {
    const out = [];
    for (const el of document.querySelectorAll("p, span, div, button, a, li")) {
      if (el.children.length > 3) continue; // 리프 위주(중첩 중복은 Set이 흡수)
      const t = (el.innerText || "").trim();
      if (/^\((수학|영어)\)/.test(t) && t.length <= 30 && !t.includes("\n")) out.push(t);
    }
    return out;
  });
}
