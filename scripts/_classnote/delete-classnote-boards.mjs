/**
 * scripts/_classnote/delete-classnote-boards.mjs — 정리 대상 보드 **삭제 실행기**. 기본 **dry-run**.
 *
 * 판정은 [offboard-safety.mjs](./offboard-safety.mjs) `evaluateBoardRelease`(순수)가 하고, 이 파일은
 * **사실 수집 → 실행 직전 재확인 → 삭제 → 사후 검증**만 한다. 스캔([scan-board-cleanup.mjs](./scan-board-cleanup.mjs))과
 * **같은 판정 함수**를 쓴다(목록과 실행이 갈라지면 안 된다).
 *
 * 🔴 **1군만 지운다**: `가족 0 · 교사 0 · 게시물 0`.
 *   · 게시물 0 = **추억보기로 잃을 게 없다**(§11 — 학부모는 퇴원 후에도 과거 알림장을 본다. 게시물이 있으면
 *     삭제가 그 원본을 없앤다). 실측상 release 81건이 전부 게시물 0이라 이 조건은 후보를 줄이지 않는다.
 *   · 가족 1+ = ClassNote가 애초에 삭제를 거부한다(학생 있으면 삭제 불가). 배정 해제는 REST 405라 UI 전용.
 *   · 되돌리기: 🔴 2026-11-04부터 1인 보드는 다시 만들지 않는다(원장 "앞으로 1인보드에 배정 시키지마 절대" — 일일 준비 삭제)
 *     — 지운 보드는 되살리지 않는 정리다. aywa는 보드 id를 저장하지 않고(고아 참조 없음), 게시물 0·가족 0인 빈 보드만
 *     지우므로 잃는 것은 없다(**게시물만이 유일한 비가역 손실**).
 *
 * ⚠️ **삭제 경로는 ID 우선**: `DELETE /api/v1/classes/{id}/`를 먼저 시도한다. DOM 클릭은 목록에서 행을 찾아
 * 누르는 방식이라 **오클릭으로 남의 보드를 지울 위험**이 있어 최후 수단이다(API가 막히면 그때만).
 *
 * 실행:
 *   node --env-file=.env.local scripts/_classnote/delete-classnote-boards.mjs            # dry-run(기본)
 *   node --env-file=.env.local scripts/_classnote/delete-classnote-boards.mjs --apply --limit=3
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  launchAdminBrowser,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  fetchBoardChildren,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";
import { normBoard } from "./board-safety.mjs";
import { studentIdentityKeys } from "./identity-keys.mjs";
import { evaluateBoardRelease, phoneMatches } from "./offboard-safety.mjs";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
const DORMANT_DAYS = Number(process.argv.find((a) => a.startsWith("--dormant="))?.split("=")[1] ?? 45);
const ANY_POST_DAYS = Number(process.argv.find((a) => a.startsWith("--anypost="))?.split("=")[1] ?? 7);
const STUDENT_BOARD = /^\((수학|영어)\)(.+)$/;

const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** 보드 게시물 — ⚠️ `count`는 항상 1인 상수라 쓰면 안 되고, `next` 커서는 cls 필터를 푼다(§11). */
async function fetchBoardPosts(page, centerId, boardId) {
  const r = await page.evaluate(
    async ([cid, bid]) => {
      const res = await fetch(`/api/v1_2/centers/${cid}/reports/?cls=${bid}&page_size=100`, { headers: { accept: "application/json" } });
      if (!res.ok) return null;
      const j = await res.json();
      const rows = j?.results ?? [];
      return { n: rows.length, more: !!j?.next, dates: rows.map((x) => x.date_written).filter(Boolean) };
    },
    [centerId, boardId],
  );
  if (!r) return null;
  return { count: r.n, complete: !r.more, lastPostAt: r.dates.length ? r.dates.slice().sort().pop() : null };
}

/** 보드 삭제 — **ID 지목 API 우선**, 실패 시 사유 반환(DOM 폴백은 오클릭 위험이라 자동으로 하지 않는다). */
async function deleteBoardById(page, boardId) {
  return page.evaluate(async (id) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const tries = [`/api/v1/classes/${id}/`, `/api/v1/classes/${id}`, `/api/v1_2/classes/${id}/`];
    const out = [];
    for (const u of tries) {
      const res = await fetch(u, {
        method: "DELETE",
        headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
      });
      out.push({ url: u, status: res.status });
      if (res.status >= 200 && res.status < 300) return { ok: true, attempts: out };
    }
    return { ok: false, attempts: out };
  }, boardId);
}

const TODAY = kstToday();
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchAdminBrowser();
const page = await browser.newPage();
try {
  const tenant = await resolveTenant(sql);
  const students = await sql`
    select s.id, s.name, s.classnote_name, s.status, s.grade,
           s.parent_phone, s.student_phone, to_char(s.withdrawn_at,'YYYY-MM-DD') as withdrawn_at
    from students s where s.tenant_id = ${tenant}`;
  const activeRows = await sql`
    select distinct e.student_id, c.subject
    from enrollments e join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where e.tenant_id = ${tenant} and e.end_date is null`;
  const activeBySid = new Map();
  for (const r of activeRows) activeBySid.set(r.student_id, [...(activeBySid.get(r.student_id) ?? []), r.subject ?? "?"]);

  // 🔴 돈의 흔적 — "실제로 다닌다"의 가장 강한 신호(원장 지시 2026-07-30). 퇴원 이후의 청구·납부가 있으면
  //    수강·보고서가 전부 조용해도 그 학생은 살아있다(실측: 배한빈 퇴원 04-06인데 07월 청구·06-30 납부).
  const billingRows = await sql`
    select student_id, max(period) as last_period, to_char(max(paid_at),'YYYY-MM-DD') as last_paid
    from invoices where tenant_id = ${tenant} group by student_id`;
  const billingBySid = new Map(billingRows.map((r) => [r.student_id, { lastPeriod: r.last_period ?? null, lastPaidAt: r.last_paid ?? null }]));

  await loginClassnote(page);
  await page.goto(`${CLASSNOTE_BASE}/service/report`, { waitUntil: "domcontentloaded" });
  await dismissHonorificDialog(page);
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);

  const classMeta = await page.evaluate(async (cid) => {
    const out = {};
    for (let p = 1; p <= 3; p++) {
      const r = await fetch(`/api/v1/centers/${cid}/classes?page_size=1000&page=${p}`, { headers: { accept: "application/json" } });
      if (!r.ok) break;
      const j = await r.json();
      for (const c of j.results ?? []) out[c.id] = { teachers: c.approved_teachers ?? null, children: c.approved_children ?? null };
      if (!j.next) break;
    }
    return out;
  }, centerId);

  const adm = await page.evaluate(async (cid) => {
    const r = await fetch(`/api/v1_2/centers/${cid}/admissioninfos?name=&page_size=2000`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (j.results ?? []);
    return rows.map((x) => ({
      phone: x.basic_info?.carer1_phone ?? null,
      boardIds: (x.enrollments ?? []).filter((e) => !e.date_left).map((e) => e.belong_to_class),
    }));
  }, centerId);
  if (!adm) throw new Error("운영관리 명부(admissioninfos) 조회 실패 — 전화 대조 없이는 삭제하지 않습니다");
  const admByBoard = new Map();
  for (const a of adm) for (const bid of a.boardIds) admByBoard.set(bid, [...(admByBoard.get(bid) ?? []), a]);

  const studentKeys = students.map((s) => ({ s, keys: studentIdentityKeys(s.name, s.classnote_name) }));
  const studentBoards = boards.filter((b) => STUDENT_BOARD.test(b.name));

  // ── 사실 수집 + 판정 ────────────────────────────────────────────────────────
  const collected = [];
  for (const b of studentBoards) {
    const m = STUDENT_BOARD.exec(b.name);
    const base = normBoard(m[2]);
    let hits = studentKeys.filter((x) => x.keys.has(base)).map((x) => x.s);
    const cnPhones = (admByBoard.get(b.id) ?? []).map((o) => o.phone).filter(Boolean);
    let phone = { checked: false, match: null };
    if (hits.length && cnPhones.length) {
      const matched = hits.filter((s) => phoneMatches([s.parent_phone, s.student_phone], cnPhones) === true);
      if (matched.length === 1) [hits, phone] = [matched, { checked: true, match: true }];
      else if (matched.length === 0) phone = { checked: true, match: false };
      else [hits, phone] = [matched, { checked: true, match: true }];
    }
    const s = hits.length === 1 ? hits[0] : null;
    const wanted = m[1] === "수학" ? ["math", "subject_1"] : ["english"];
    const active = s ? (activeBySid.get(s.id) ?? []) : [];
    collected.push({ b, s, hits, phone, wanted, active, meta: classMeta[b.id] ?? {}, posts: await fetchBoardPosts(page, centerId, b.id) });
  }

  const anyPostByStudent = new Map();
  for (const c of collected) {
    if (!c.s) continue;
    const cur = anyPostByStudent.get(c.s.id) ?? { complete: true, lastPostAt: null };
    if (!c.posts || c.posts.complete !== true) cur.complete = false;
    if (c.posts?.lastPostAt && (!cur.lastPostAt || c.posts.lastPostAt > cur.lastPostAt)) cur.lastPostAt = c.posts.lastPostAt;
    anyPostByStudent.set(c.s.id, cur);
  }

  const plan = [];
  for (const c of collected) {
    const v = evaluateBoardRelease({
      board: { id: c.b.id, name: c.b.name, children: c.meta.children ?? c.b.children },
      matchedStudentCount: c.hits.length,
      student: c.s
        ? {
            id: c.s.id,
            name: c.s.name,
            status: c.s.status,
            subjectActive: c.active.some((x) => c.wanted.includes(x)),
            allSubjectsEnded: c.active.length === 0,
            withdrawnAt: c.s.withdrawn_at,
          }
        : null,
      phone: c.phone,
      posts: c.posts,
      teachers: c.meta.teachers ?? 0,
      today: TODAY,
      dormantDays: DORMANT_DAYS,
      studentAnyPost: c.s ? (anyPostByStudent.get(c.s.id) ?? null) : null,
      billing: c.s ? (billingBySid.get(c.s.id) ?? null) : null,
      anyPostDays: ANY_POST_DAYS,
    });
    if (v.action !== "release") continue;
    const fam = c.meta.children ?? c.b.children;
    const tea = c.meta.teachers ?? 0;
    // 🔴 1군만: 게시물 0 · 가족 0 · 교사 0. 그 외는 삭제 시도조차 하지 않는다.
    if (c.posts?.count !== 0 || c.posts?.complete !== true) plan.push({ c, v, skip: `게시물 ${c.posts?.count ?? "?"}건 — 삭제하면 추억보기 원본이 사라집니다` });
    else if (fam !== 0) plan.push({ c, v, skip: `가족 ${fam}명 연결 — ClassNote가 삭제를 거부합니다(배정 해제 선행, UI 전용)` });
    else if (tea !== 0) plan.push({ c, v, skip: `교사 ${tea}명 연결 — 먼저 해제해야 삭제됩니다(UI 전용)` });
    else plan.push({ c, v, skip: null });
  }

  const deletable = plan.filter((p) => !p.skip);
  const skipped = plan.filter((p) => p.skip);
  console.log(`\n════ 보드 삭제 ${APPLY ? "실행(--apply)" : "DRY-RUN"} · 기준일 ${TODAY} KST ════`);
  console.log(`학생모드 보드 ${studentBoards.length} → 정리 가능 ${plan.length} → **삭제 대상(1군: 게시물0·가족0·교사0) ${deletable.length}** · 보류 ${skipped.length}`);
  const bySkip = new Map();
  for (const p of skipped) bySkip.set(p.skip.split(" —")[0].replace(/\d+/, "N"), (bySkip.get(p.skip.split(" —")[0].replace(/\d+/, "N")) ?? 0) + 1);
  if (skipped.length) console.log(`  보류 사유: ${[...bySkip].map(([k, n]) => `${k} ${n}`).join(" · ")}`);

  const targets = LIMIT > 0 ? deletable.slice(0, LIMIT) : deletable;
  console.log(`\n${APPLY ? "▶ 삭제 실행" : "▶ 삭제 예정(실행 안 함)"}: ${targets.length}건${LIMIT > 0 ? ` (--limit=${LIMIT})` : ""}`);

  let done = 0;
  let failed = 0;
  for (const p of targets) {
    const { b } = p.c;
    const label = `${b.name} (id ${b.id})`;
    // ── 실행 직전 재확인(TOCTOU) — 스캔 이후 가족이 붙었을 수 있다 ──
    const liveKids = await fetchBoardChildren(page, centerId, b.id).catch(() => null);
    const livePosts = await fetchBoardPosts(page, centerId, b.id);
    if (liveKids === null || livePosts === null) {
      console.log(`   ⏸  ${label} — 재확인 조회 실패, 건너뜁니다`);
      failed++;
      continue;
    }
    if (liveKids.length !== 0 || livePosts.count !== 0 || livePosts.complete !== true) {
      console.log(`   ⏸  ${label} — 재확인에서 상태 변경 감지(가족 ${liveKids.length} · 게시물 ${livePosts.count}), 건너뜁니다`);
      failed++;
      continue;
    }
    if (!APPLY) {
      console.log(`   · ${label} — 재확인 통과(가족 0 · 게시물 0) → 삭제 예정`);
      continue;
    }
    const res = await deleteBoardById(page, b.id);
    if (!res.ok) {
      console.log(`   ❌ ${label} — API 삭제 불가: ${res.attempts.map((a) => `${a.url} ${a.status}`).join(" · ")}`);
      failed++;
      continue;
    }
    // ── 사후 검증: 정말 사라졌나 ──
    const after = await fetchBoards(page, centerId).catch(() => null);
    const stillThere = after ? after.some((x) => x.id === b.id) : null;
    console.log(`   ✅ ${label} — 삭제됨${stillThere === false ? " (목록에서 사라짐 확인)" : stillThere === true ? " ⚠️ 그러나 목록에 아직 있음" : ""}`);
    done++;
  }

  console.log(
    APPLY
      ? `\n완료: 삭제 ${done} · 실패/건너뜀 ${failed}`
      : `\n(dry-run) 아무것도 변경하지 않았습니다. 실제 삭제는 --apply --limit=N 으로.`,
  );
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
