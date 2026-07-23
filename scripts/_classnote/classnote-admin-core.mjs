/**
 * scripts/_classnote/classnote-admin-core.mjs — ClassNote 기관설정(반 생성·학생 배정) 자동화 공용 헬퍼.
 *
 * 발송 워커(classnote-core.mjs)와 별개 모듈 — 워커는 게시만 하고, 이쪽은 기관설정 화면(반 정보 관리·
 * 학생 관리)을 Playwright로 조작한다. 원본 스펙 = Edutrix repo scripts/{create_classnote_classes,
 * assign_student_to_individual_class}.js (Puppeteer → Playwright 이식, 자격증명 하드코딩 제거).
 * 배경/구조 근거 = docs/classnote-integration.md §3 "왜 학생 1명=반 1개인가".
 */
import { chromium } from "@playwright/test";
// 순수 판정(의존성 0)만 가져온다 — 반대 방향 import 금지(board-safety 테스트가 playwright를 끌면 안 됨).
import { acceptBoardMembers, kstSchoolYear } from "./board-safety.mjs";

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
  // URL 폴링 — waitForURL은 load 이벤트 대기라 사이트가 느리면 로그인 성공 후에도 타임아웃(2026-07-13 실측).
  for (let i = 0; i < 40; i++) {
    if (!page.url().includes("/login")) return;
    await page.waitForTimeout(1000);
  }
  throw new Error("ClassNote 로그인 실패 — 자격증명(CLASSNOTE_UPLOAD_ID/PW) 또는 화면 변경 확인");
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
  // ⚠️ `children`은 **모르면 null**로 남긴다(0으로 뭉개지 말 것). 0 = "학부모 미연결"이라는 **사실**이고
  // null = "인원을 모름"이라 의미가 정반대다. 예전엔 `?? 0`이라, ClassNote가 필드명을 바꾸면 전 보드가
  // "0가족"으로 보여 공유 보드 게이트(board-safety)가 **무경고로 전부 통과**시켰다(fail-open).
  // 소비처: board-safety=null이면 차단(fail-closed) · scan=인원 미확인으로 보고 ·
  // provision/assign의 `children >= 1`은 null이든 0이든 false라 동작 불변.
  return rows.map((r) => ({ id: r.id, name: (r.name || "").trim(), children: r.approved_children ?? null }));
}

/** 가입(승인) 원아 전건 — {id, name, birth}. 영문닉(한글) 형식 존재("Jay(이재희)") — 매칭은 childKeys로. */
export async function fetchChildren(page, centerId) {
  const rows = await fetchAllDrf(page, `/api/v1/centers/${centerId}/children`);
  return rows
    .map((r) => ({ id: r.id, name: (r.name || "").trim(), birth: r.date_birth ?? null }))
    .filter((r) => r.name);
}

/** 원아 상세 — enrollment[](belong_to_class 멤버십, removed_child 플래그 포함). */
export async function fetchChildDetail(page, childId) {
  return page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/children/${id}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`children/${id} ${r.status}`);
    return r.json();
  }, childId);
}

/**
 * 원아→반 배정(쓰기) — `POST /api/v1/enrollments/ {child, belong_to_class}` (2026-07-13 학원이로 실검증,
 * 201 + is_approved:true 즉시). ID 기반이라 동명이인 안전. CSRF 쿠키 헤더 필요.
 * ⚠️ 제거는 DELETE/PATCH 전부 405 — 해제는 ClassNote UI에서만(현재 미자동화).
 */
export async function enrollChild(page, childId, classId) {
  return page.evaluate(
    async ([child, cls]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch("/api/v1/enrollments/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ child, belong_to_class: cls }),
      });
      const body = await res.text();
      return { status: res.status, body: body.slice(0, 300) };
    },
    [childId, classId],
  );
}

/**
 * 학생(유효이름) ↔ 가입 원아 매칭 계획(순수) — **양방향 유일성** 강제(2026-07-13 적대 검증 픽스 2차).
 * - 정방향: 한 학생에 동명 원아 2+ 매칭 → 보류(주준호 사례).
 * - 역방향: 한 원아가 서로 다른 유효이름 **DB 전체 학생**(universeNames — 퇴원·타과목·동명 보류분 포함)
 *   2+에 매칭 → 보류. ⚠️ 타깃 목록만으로 검사하면 "퇴원한 동명이인 김민수B의 잔존 원아가 재원생
 *   김민수A에 유일 후보로 위장"(적대 감사 F1)·과목 필터로 가려진 동명(F2)·동명 보류 제외분(F3)이 뚫린다 —
 *   그래서 universeNames는 **status·과목 무필터 전 학생 유효이름**이어야 한다. 미제공 시 타깃 이름으로
 *   폴백(순수 테스트용 — 실호출은 반드시 제공).
 * 같은 학생의 다과목 보드(수학+영어)는 유효이름이 같아(norm 동일) 통과(정상).
 * 반환: { matches: Map<board, child>, held: [{board, reason}] }. 미가입(매칭 0)은 어디에도 없음.
 */
export function planChildMatches(targets, children, universeNames = null) {
  const names = [...new Set((universeNames ?? targets.map((t) => t.student)).filter(Boolean))];
  // 원아별: DB 전체 이름 중 이 원아 키에 걸리는 유효이름(norm) 집합 — 2개 이상이면 신원 불명.
  const childMatchedNames = new Map();
  for (const c of children) {
    const keys = childKeys(c.name);
    const matched = new Set();
    for (const n of names) {
      const clean = n.replace(/[a-zA-Z]/g, "").trim();
      if (keys.has(n) || (clean && keys.has(clean))) matched.add(norm(n));
    }
    childMatchedNames.set(c.id, matched);
  }
  const matches = new Map();
  const held = [];
  for (const t of targets) {
    const clean = (t.student || "").replace(/[a-zA-Z]/g, "").trim();
    const cands = children.filter((c) => {
      const keys = childKeys(c.name);
      return keys.has(t.student) || (clean && keys.has(clean));
    });
    if (cands.length === 0) continue; // 미가입(초대 대기) — 정상
    if (cands.length > 1) {
      held.push({ board: t.board, reason: `동명 원아 ${cands.length}명(생일 대조 필요)` });
      continue;
    }
    const matched = childMatchedNames.get(cands[0].id);
    if (matched.size > 1) {
      held.push({ board: t.board, reason: `원아 신원 불명 — 동명 학생(퇴원·타과목 포함) ${matched.size}명에 매칭` });
      continue;
    }
    matches.set(t.board, cands[0]);
  }
  return { matches, held };
}

/**
 * 원아의 기존 학생모드 보드 소속이 이 학생과 다른 이름인가 — 잔존 가족(F1) 직격 차단 보조 가드.
 * 원아가 이미 `(수학)김민수B` 등 **다른 학생의 개인 보드**에 붙어 있으면 그 가족은 그 학생 소속 —
 * 지금 타깃(김민수A)에 배정하면 안 된다. 같은 학생의 다과목 보드는 이름이 같아 통과.
 */
export function hasForeignStudentBoard(enrollments, studentName) {
  const mine = norm(studentName);
  return (enrollments ?? []).some((e) => {
    if (e.removed_child) return false;
    const m = norm(e.class_name || "").match(/^\((수학|영어)\)(.+)$/);
    return m && m[2] !== mine;
  });
}

/** 보드의 현재 원아 목록(실시간) — POST 직전 빈 보드 재확인용(TOCTOU 방지, 적대 감사 F5). */
export async function fetchBoardChildren(page, centerId, classId) {
  return page.evaluate(
    async ([c, id]) => {
      const r = await fetch(`/api/v1/centers/${c}/classes/${id}/children`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`classes/${id}/children ${r.status}`);
      const j = await r.json();
      return Array.isArray(j) ? j : (j.results ?? []);
    },
    [centerId, classId],
  );
}

/** ClassNote 원아 표시명 → 매칭 키 집합(원문·알파벳 제거·영문닉(한글)의 괄호 한글).
 *  ⚠️ 괄호 추출은 **영문닉(한글) 형식 한정**(적대 감사 F6) — "박지민(지민)"·"김하늘(동생)" 같은
 *  한글(별명) 표기에서 별명을 이름 키로 승격시키면 다른 학생과 오매칭 연료가 된다. */
export function childKeys(name) {
  const keys = new Set();
  const t = (name || "").trim();
  if (!t) return keys;
  keys.add(t);
  const stripped = t.replace(/[a-zA-Z]/g, "").replace(/[()]/g, "").trim();
  if (stripped) keys.add(stripped);
  const paren = t.match(/^[A-Za-z .]+\(([가-힣]{2,6})\)$/);
  if (paren) keys.add(paren[1]);
  return keys;
}

// ── 반(보드) 생성 — DOM(반 정보 관리 > 반 추가하기). 생성만은 API 미확인이라 DOM 유지 ─────────

/** 반 추가 form이 열려있으면 취소로 닫기(중복 거부 등 후처리). */
export async function cancelBoardForm(page) {
  const cancelled = await page.evaluate(() => {
    const form = document.querySelector("form");
    const input = form?.querySelector("input");
    if (!input || input.offsetParent === null) return false;
    const btn = Array.from(form.querySelectorAll("button")).find(
      (b) => (b.querySelector("span")?.textContent || "").trim() === "취소",
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!cancelled) await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(600);
}

/**
 * 반 정보 관리 페이지에서 보드 1개 생성 — 반 추가하기 → 이름 입력 → 추가 → form 닫힘=성공.
 * ClassNote가 중복 반명을 거부(form 잔류)하므로 잘못된 diff에도 중복 생성은 안 됨(백스톱 실측).
 * 호출 전 /service/setting/class 진입 + 호칭 다이얼로그 처리가 선행돼야 한다.
 */
export async function createBoard(page, name) {
  // SPA 렌더 지연 대응 — 버튼이 나타날 때까지 최대 ~12초 폴링(단발 탐색은 첫 진입에서 실패했음).
  let addClicked = false;
  for (let i = 0; i < 15 && !addClicked; i++) {
    addClicked = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("span, button")).find(
        (e) => (e.textContent || "").trim() === "반 추가하기" && e.offsetParent !== null,
      );
      if (!el) return false;
      (el.closest("button") || el).click();
      return true;
    });
    if (!addClicked) await page.waitForTimeout(800);
  }
  if (!addClicked) return { ok: false, reason: "'반 추가하기' 버튼 없음" };
  await page.waitForTimeout(800);

  try {
    await page.locator('input[placeholder*="초등반"], form input').first().fill(name, { timeout: 5000 });
  } catch {
    await cancelBoardForm(page);
    return { ok: false, reason: "이름 입력창 없음" };
  }
  await page.waitForTimeout(300);

  const submitted = await page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return false;
    const btn = Array.from(form.querySelectorAll("button")).find(
      (b) => b.type === "submit" || (b.querySelector("span")?.textContent || "").trim() === "추가",
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!submitted) {
    await cancelBoardForm(page);
    return { ok: false, reason: "'추가' 버튼 클릭 실패" };
  }

  await page.waitForTimeout(1200);
  const stillOpen = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="초등반"]');
    return !!(input && input.offsetParent !== null);
  });
  if (stillOpen) {
    await cancelBoardForm(page);
    return { ok: false, reason: "거부됨(중복 추정)" };
  }
  return { ok: true };
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

// ── Phase 2: 네이티브 파일첨부(attached_files) 게시 헬퍼 ───────────────────────────

/**
 * kage 업로드(ClassNote 내부 스토리지) — **알림장 작성폼의 네이티브 file input**에 버퍼를 세팅해 프론트가
 * 정확한 형식(멀티파트·file_type)으로 kage에 올리게 하고 그 응답을 캡처한다(수동 FormData는 415로 거부됨 — 형식 상이).
 * ⚠️ `page`는 반드시 `/service/report/add`에 있어야 함. inputTestId: 이미지=`media-attachment-add-input`(file_type=img) /
 * 문서=`doc-attachment-add-input`(etc). 반환 `{ access_key, info }`(문서 info={orgname,size,ext} / 이미지 info={img:{length,width,height},…}).
 */
export async function uploadToKage(page, inputTestId, { name, mimeType, buffer }) {
  let result = null;
  const onResp = async (res) => {
    if (/kids-kage\.kakao\.com/.test(res.url()) && res.request().method() === "POST") {
      try { const j = await res.json(); if (j?.access_key) result = j; } catch { /* 무시 */ }
    }
  };
  page.on("response", onResp);
  try {
    await page.locator(`input[data-testid='${inputTestId}']`).setInputFiles({ name, mimeType, buffer });
    for (let i = 0; i < 40 && !result; i++) await page.waitForTimeout(300); // kage 업로드 완료 대기(최대 12s)
  } finally {
    page.off("response", onResp);
  }
  return result;
}

/**
 * 보드 → 원아 → enrollment 해석 — 이름 매칭 원아들 중 이 보드에 활성 배정된 `{child, enrollment}` 목록.
 * 이중 계정(부모·본인 각자 가입)이면 여럿. notice-core processTarget 해석부와 동일 로직(단일화).
 */
export async function resolveBoardChildEnrollments(page, boardId, studentName, children, fallback = null) {
  const clean = (studentName || "").replace(/[a-zA-Z]/g, "").trim();
  const cands = children.filter((c) => {
    const keys = childKeys(c.name);
    return keys.has(studentName) || keys.has(clean);
  });
  const enrolled = [];
  for (const c of cands) {
    const detail = await fetchChildDetail(page, c.id);
    const e = (detail.enrollment ?? []).find((x) => x.belong_to_class === boardId && !x.removed_child);
    if (e) enrolled.push({ child: c, enrollment: e });
  }
  // 이름으로 찾았으면 기존 그대로(동작 불변). 못 찾았을 때만 아래 폴백이 돈다.
  if (enrolled.length || !fallback?.centerId) return enrolled;

  // ── 폴백: **보드가 곧 매핑이다**(원장 2026-07-23) ─────────────────────────────────────────
  // 1인 보드는 학생 1명 = 보드 1개다. 보드를 이름으로 특정한 순간 매핑은 끝났고, 거기 배정된 원아가
  // 곧 그 학생이다. 학부모가 원아 이름을 바꿔도(`박서연E`→`서연`) 배정은 그대로이므로 이름으로 다시
  // 거르면 멀쩡한 발송이 "미배정"으로 막힌다. 대신 **생년 대조(acceptBoardMembers)를 반드시 통과**시켜
  // 엉뚱한 집이 붙은 보드는 여전히 차단한다(모르면 거부).
  const members = await fetchBoardChildren(page, fallback.centerId, boardId).catch(() => null);
  if (!Array.isArray(members)) {
    fallback.onReject?.({ code: "lookup_failed", reason: "ClassNote 원아 조회에 실패해 보류합니다" });
    return [];
  }
  const verdict = acceptBoardMembers({
    members,
    grade: fallback.grade ?? null,
    schoolYear: fallback.schoolYear ?? kstSchoolYear(),
  });
  if (!verdict.ok) {
    fallback.onReject?.(verdict);
    return [];
  }
  const viaBoard = [];
  for (const m of verdict.members) {
    const detail = await fetchChildDetail(page, m.id).catch(() => null);
    const e = (detail?.enrollment ?? []).find((x) => x.belong_to_class === boardId && !x.removed_child);
    if (e) viaBoard.push({ child: m, enrollment: e, viaBoard: true });
  }
  if (!viaBoard.length) fallback.onReject?.({ code: "no_member", reason: "보드 미배정(배정 필요)" });
  return viaBoard;
}

/** 알림장 게시(내부 API) — attached_images/attached_files 선택 포함. 응답은 빈 201이라 status만. */
export async function postClassnoteReport(page, { cls, child, enrollment, content, dateWritten, authorName, attachedImages = [], attachedFiles = [] }) {
  return page.evaluate(
    async ([cls, child, enrollment, body, author, date, ai, af]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch("/api/v1_2/reports/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({
          cls, child, enrollment, content: body, date_written: date, author_name: author, tz: "Asia/Seoul",
          ...(ai.length ? { attached_images: ai } : {}),
          ...(af.length ? { attached_files: af } : {}),
        }),
      });
      return { status: res.status };
    },
    [cls, child, enrollment, content, authorName, dateWritten, attachedImages, attachedFiles],
  );
}
