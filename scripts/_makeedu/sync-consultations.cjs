/**
 * scripts/_makeedu/sync-consultations.cjs — 재원생 상담을 **내용까지** 동기화 (Playwright).
 *
 * makeedu 상담은 목록에 제목만 있고 **상세 페이지(counselList_detail.do?counselSeq=N)에 본문**(상담내용·조치사항·
 * 건의사항·비고)이 있다. 또 목록 'No'는 표시용이고 **stable PK는 행 히든 input `counselSeqTmp`**(=counselSeq).
 * 따라서: 목록 스크랩(counselSeq+학생식별) → 학생 매칭 → 매칭분만 상세 fetch(내용) → student_consultations upsert
 * (makeedu_id=counselSeq, summary=내용). 동기화 시각 기록. Phase 2 상담 동기화도 이 스크립트 재사용.
 *
 *   node --env-file=.env.local scripts/_makeedu/sync-consultations.cjs          # dry(매칭/표본만)
 *   node --env-file=.env.local scripts/_makeedu/sync-consultations.cjs --apply  # 상세 fetch + upsert
 */
const postgres = require("postgres");
const L = require("./lib.cjs");
const { makeCounselorMatcher, loadSubjectLabels, resolveConsultationSubject, loadEnrolledSubjects } = require("./consultation-counselor.cjs");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("@playwright/test"));
}

const BASE = "https://school.makeedu.co.kr";
const APPLY = process.argv.includes("--apply");
const CONC = Number(process.env.MAKEEDU_CONC || 8);

// ⚠️ additive 동기화 결정(2026-06-29): 재원생 상담은 **건너뜀** — ijw 상담 1340건이 정본이고, makeedu 상담
// (~2686, counselSeq 키)은 ijw와 공유 키가 없어 그냥 더하면 같은 상담이 대량 중복된다. 이 스크립트는 makeedu
// 상담을 전부 추가(=중복)하므로 additive 부트스트랩에서 제외. 의도적으로 실행하려면 --force 필요.
if (!process.argv.includes("--force")) {
  console.log(
    "[skip] 재원생 상담은 additive 부트스트랩에서 제외(ijw 1340건 정본, 중복 방지 결정 2026-06-29).\n" +
      "       의도적으로 makeedu 상담을 추가하려면 --force 플래그로 실행.",
  );
  process.exit(0);
}

async function login(page) {
  const id = process.env.MAKEEDU_ID, pw = process.env.MAKEEDU_PW;
  if (!id || !pw) throw new Error("MAKEEDU_ID / MAKEEDU_PW 누락(.env.local)");
  await page.goto(`${BASE}/login.do`, { waitUntil: "domcontentloaded" });
  const pwIn = page.locator('input[type="password"]').first();
  await pwIn.waitFor({ timeout: 15000 });
  await page.locator('input[type="text"], input:not([type])').first().fill(id);
  await pwIn.fill(pw);
  await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), pwIn.press("Enter")]);
  await page.waitForTimeout(1200);
  if (/\/login\.do/i.test(page.url())) throw new Error("로그인 실패");
}

// 목록 행 추출: counselSeq(히든 counselSeqTmp) + 이름/학교/학년/제목/등록자/상담일.
function EXTRACT_LIST() {
  const tables = Array.from(document.querySelectorAll("table"));
  let best = null, br = 0;
  for (const t of tables) { const r = t.querySelectorAll("tbody tr").length; if (r > br) { br = r; best = t; } }
  if (!best) return [];
  const H = Array.from(best.querySelectorAll("thead th, thead td")).map((h) => (h.textContent || "").replace(/\s+/g, " ").trim());
  const ix = (s) => H.findIndex((h) => (h || "").includes(s));
  const I = { name: ix("이름"), school: ix("학교"), grade: ix("학년"), title: ix("제목"), reg: ix("등록자"), cdate: ix("상담일") };
  const out = [];
  for (const tr of best.querySelectorAll("tbody tr")) {
    const c = Array.from(tr.children);
    const seqEl = tr.querySelector('input[name="counselSeqTmp"]');
    const seq = seqEl ? seqEl.value : "";
    const cell = (i) => (i >= 0 && c[i] ? (c[i].innerText || "").replace(/\s+/g, " ").trim() : "");
    const name = cell(I.name);
    if (!seq || !name) continue;
    out.push({ seq, name, school: cell(I.school), grade: cell(I.grade), title: cell(I.title), reg: cell(I.reg), cdate: cell(I.cdate) });
  }
  return out;
}

// 상세 본문(내용 셀) 추출.
function EXTRACT_DETAIL() {
  for (const tr of document.querySelectorAll("table tr")) {
    const c = Array.from(tr.children);
    for (let i = 0; i + 1 < c.length; i++) {
      if ((c[i].textContent || "").replace(/\s+/g, "").trim() === "내용") {
        return (c[i + 1].innerText || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]*\n+/g, "\n").trim();
      }
    }
  }
  return "";
}

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const tenantId = await L.resolveTenantId(sql);
  // 학생/직원 매칭 맵
  const studs = await sql`select id, name, grade, school from students where tenant_id = ${tenantId} and makeedu_id is not null`;
  const m3 = new Map(), m2 = new Map(), m1 = new Map();
  for (const s of studs) {
    const n = L.normalizeName(s.name);
    m3.set(`${n}|${s.grade || ""}|${s.school || ""}`, s.id);
    m2.set(`${n}|${s.grade || ""}`, s.id);
    m1.set(n, m1.has(n) ? null : s.id);
  }
  const users = await sql`select id, display_name, english_name, subjects, status from users where tenant_id = ${tenantId} and system_role <> 'student'`;
  const matchCounselor = makeCounselorMatcher(users);
  const subjectLabels = await loadSubjectLabels(sql, tenantId);

  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page);
    console.log("login ok");
    await page.goto(`${BASE}/counsel/counselList.do`, { waitUntil: "networkidle" });
    const ls = page.locator('select[name="listSize"]');
    if (await ls.count()) {
      const vals = await page.$$eval('select[name="listSize"] option', (os) => os.map((o) => o.value).filter((v) => /^\d+$/.test(v)).map(Number));
      await ls.selectOption(String(Math.max(...vals))).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(700);
    }
    const all = [], seen = new Set();
    for (let p = 1; p <= 30; p++) {
      const rows = await page.evaluate(EXTRACT_LIST);
      let added = 0;
      for (const r of rows) { if (!seen.has(r.seq)) { seen.add(r.seq); all.push(r); added++; } }
      const next = page.locator('.paging a, .pagination a, [class*="pag"] a, .page a').filter({ hasText: new RegExp(`^\\s*${p + 1}\\s*$`) });
      if (added === 0 || (await next.count()) === 0) break;
      await next.first().click().catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(600);
    }
    console.log("list rows (counselSeq):", all.length);

    // 학생 매칭
    const matched = [];
    for (const r of all) {
      const n = L.normalizeName(r.name);
      const sid = m3.get(`${n}|${r.grade || ""}|${r.school || ""}`) || m2.get(`${n}|${r.grade || ""}`) || m1.get(n) || null;
      if (!sid) continue;
      r.student_id = sid;
      r.counselor = matchCounselor(r.reg);
      r.counselor_id = r.counselor?.id ?? null;
      matched.push(r);
    }
    // 과목 = 상담사 담당 과목 → 그날 학생 수강 과목(consultation-counselor.cjs resolveConsultationSubject — 추측 금지).
    const dayOf = (r) => { const t = L.parseTimestamp(r.cdate); return t ? String(t).slice(0, 10) : null; };
    const enrolledBy = await loadEnrolledSubjects(sql, tenantId, matched.map((r) => ({ studentId: r.student_id, date: dayOf(r) })));
    for (const r of matched) {
      r.subject = resolveConsultationSubject({
        counselor: r.counselor,
        enrolledSubjects: enrolledBy.get(`${r.student_id}|${dayOf(r)}`) || [],
        labels: subjectLabels,
      })?.label ?? null;
      delete r.counselor;
    }
    console.log(`matched(active students): ${matched.length} / ${all.length}`);

    if (!APPLY) {
      console.log("[DRY] sample:", JSON.stringify({ ...matched[0], student_id: "…" }));
      return;
    }

    // 상세 내용 fetch (동시 CONC)
    let idx = 0, failed = 0;
    async function worker() {
      const pg = await ctx.newPage();
      while (true) {
        const my = idx++;
        if (my >= matched.length) break;
        const r = matched[my];
        try {
          await pg.goto(`${BASE}/counsel/counselList_detail.do?counselSeq=${r.seq}`, { waitUntil: "domcontentloaded", timeout: 20000 });
          r.content = await pg.evaluate(EXTRACT_DETAIL);
        } catch { failed++; r.content = ""; }
        if (my % 400 === 0) console.log(`  detail ${my}/${matched.length}`);
      }
      await pg.close();
    }
    await Promise.all(Array.from({ length: CONC }, () => worker()));
    console.log("detail fetched, failed:", failed);

    // ↻ 동기화 배지 = "지난 동기화가 새로 추가한 상담". 이 성공 실행 시작에 지난 신규 표시를 클리어(0062a).
    // (do update에는 sync_added_at을 넣지 않아 기존 행은 NULL 유지 = 신규 insert만 라벨 대상.)
    const cleared = await sql`update student_consultations set sync_added_at = null where tenant_id = ${tenantId} and sync_added_at is not null`;
    if (cleared.count) console.log(`  지난 동기화 라벨 클리어: ${cleared.count}`);
    // upsert (makeedu_id=counselSeq, summary=내용 || 제목)
    let up = 0;
    for (const r of matched) {
      const summary = r.content && r.content.length > 10 ? r.content : r.title || "상담";
      await sql`
        insert into student_consultations (tenant_id, makeedu_id, student_id, counselor_id, subject, summary, consulted_at, sync_added_at)
        values (${tenantId}, ${r.seq}, ${r.student_id}, ${r.counselor_id}, ${r.subject}, ${summary}, ${L.parseTimestamp(r.cdate) ?? sql`now()`}, now())
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null
        do update set student_id = excluded.student_id,
          counselor_id = coalesce(student_consultations.counselor_id, excluded.counselor_id),
          subject = coalesce(nullif(btrim(student_consultations.subject), ''), excluded.subject),
          summary = excluded.summary, consulted_at = excluded.consulted_at, updated_at = now()`;
      up++;
    }
    await L.recordSync(sql, tenantId, "consultations", up);
    console.log("upserted consultations (with content):", up);
  } finally {
    await browser.close();
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
