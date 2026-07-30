/**
 * scripts/_classnote/scan-board-cleanup.mjs — eywa 기준 **ClassNote 반(보드) 정리 후보** 스캔. **READ-ONLY**.
 *
 * 아무것도 변경하지 않는다(ClassNote GET · DB select 전용). 삭제·배정해제·퇴원처리는 **사람이 UI에서** 한다
 * (원아 배정 해제·교사 해제·반 삭제는 REST가 전부 405/부재).
 *
 * ⚠️⚠️ **두 작업의 자격이 다르다** (원장 지시 2026-07-30):
 *   · **Operation A = 보드 삭제 + 배정 해제** → **그 과목**을 그만뒀으면 가능(전과목 퇴원이든 일부 과목이든)
 *   · **Operation B = 명부 퇴원처리**        → **전과목 퇴원만**
 *   원장 원문: *"두 과목 이상 수강하다가 한 과목을 퇴원한 경우 반 삭제 및 반 배정해제하고 퇴원처리는 하면 안 됨.
 *   여전히 다른 수업에는 배정되어 있어야 하기 때문."*
 * 판정은 [offboard-safety.mjs](./offboard-safety.mjs)의 `evaluateBoardRelease`(순수)가 한다.
 *
 * **안전 기준 = 45일 무게시**(원장: "게시물이 1.5개월 이상 올라오지 않았으므로 안전장치가 충분") +
 * **전화 대조**(원장 제안: 운영관리에서 보호자 연락처를 볼 수 있다) + 공유보드·동명이인·미매칭 제외.
 *
 * 🔴 **개인정보**: `admissioninfos`에는 보호자 연락처뿐 아니라 **알레르기·병력·응급병원·주소**까지 실려 있다.
 * 전화는 **대조에만** 쓰고 어디에도 저장·출력하지 않는다(값 대신 일치/불일치만 보고). AI 프롬프트에 절대 넣지 말 것.
 *
 * 실행: node --env-file=.env.local scripts/_classnote/scan-board-cleanup.mjs [--json] [--limit=N]
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  launchAdminBrowser,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";
import { normBoard } from "./board-safety.mjs";
import { studentIdentityKeys } from "./identity-keys.mjs";
import { evaluateBoardRelease, phoneMatches, RELEASE_GUARDS } from "./offboard-safety.mjs";

const JSON_OUT = process.argv.includes("--json");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
const DORMANT_DAYS = Number(process.argv.find((a) => a.startsWith("--dormant="))?.split("=")[1] ?? 45);
// ⭐ 원장 백스톱: 그 학생의 어떤 보드든 이 기간 내 게시물이 있으면 **퇴원처리 불가**(보드 삭제는 허용).
const ANY_POST_DAYS = Number(process.argv.find((a) => a.startsWith("--anypost="))?.split("=")[1] ?? 7);
const STUDENT_BOARD = /^\((수학|영어)\)(.+)$/;
const POST_PAGE = 100;

function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * 보드 게시물 이력 — `{count, lastPostAt, complete}`.
 *
 * ⚠️⚠️ **응답의 `count`를 쓰면 안 된다.** 이 엔드포인트의 `count`는 **항상 1인 상수**다(2026-07-30 실측:
 * `page_size` 무관, **존재하지 않는 `cls`에도 `count:1`**). 그걸 믿고 세면 **모든 보드가 "게시물 1건"** 으로
 * 보여 판정이 통째로 거짓이 된다(실제로 69개 보드가 전부 1건으로 나왔다). 진짜 수는 `results.length`.
 * ⚠️ **`next` 커서로 이어받지 말 것 — `cls` 필터가 풀린다**(6건 보드가 11페이지·20건, 남의 보드 글 혼입).
 * 그래서 단일 요청만 하고, `next`가 있으면 `complete:false`로 두어 **판정에서 제외**시킨다.
 * ⚠️ 결과 순서는 날짜순이 아니다(실측: 06-17, 04-15, 05-20) → `lastPostAt`은 **최댓값**으로 구한다.
 */
async function fetchBoardPosts(page, centerId, boardId) {
  const r = await page.evaluate(
    async ([cid, bid, size]) => {
      const res = await fetch(`/api/v1_2/centers/${cid}/reports/?cls=${bid}&page_size=${size}`, { headers: { accept: "application/json" } });
      if (!res.ok) return null;
      const j = await res.json();
      const rows = j?.results ?? [];
      return { n: rows.length, more: !!j?.next, dates: rows.map((x) => x.date_written).filter(Boolean) };
    },
    [centerId, boardId, POST_PAGE],
  );
  if (!r) return null;
  return { count: r.n, complete: !r.more, lastPostAt: r.dates.length ? r.dates.slice().sort().pop() : null };
}

const TODAY = kstToday();
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchAdminBrowser();
const page = await browser.newPage();
try {
  const tenant = await resolveTenant(sql);
  const students = await sql`
    select s.id, s.name, s.classnote_name, s.status, s.grade, s.makeedu_id,
           s.parent_phone, s.student_phone, to_char(s.withdrawn_at,'YYYY-MM-DD') as withdrawn_at
    from students s where s.tenant_id = ${tenant}`;
  const activeRows = await sql`
    select distinct e.student_id, c.subject
    from enrollments e join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where e.tenant_id = ${tenant} and e.end_date is null`;
  const activeBySid = new Map();
  for (const r of activeRows) activeBySid.set(r.student_id, [...(activeBySid.get(r.student_id) ?? []), r.subject ?? "?"]);

  await loginClassnote(page);
  await page.goto(`${CLASSNOTE_BASE}/service/report`, { waitUntil: "domcontentloaded" });
  await dismissHonorificDialog(page);
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);

  // 반 목록이 교사·원아 승인 인원을 함께 준다 — 삭제 가능 조건(학생·교사 없음)을 한 요청으로 얻는다.
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

  // 운영관리 명부 — child_id·보호자 연락처·생년·반 소속. ⚠️ 민감정보 동반이라 전화는 대조에만 쓴다.
  const adm = await page.evaluate(async (cid) => {
    const r = await fetch(`/api/v1_2/centers/${cid}/admissioninfos?name=&page_size=2000`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (j.results ?? []);
    return rows.map((x) => ({
      childId: x.child_id ?? null,
      name: x.basic_info?.child_name ?? null,
      birth: x.basic_info?.child_date_birth ?? null,
      phone: x.basic_info?.carer1_phone ?? null,
      boardIds: (x.enrollments ?? []).filter((e) => !e.date_left).map((e) => e.belong_to_class),
    }));
  }, centerId);
  if (!adm) {
    console.error("🔴 운영관리 명부(admissioninfos) 조회 실패 — 전화 대조 없이는 판정하지 않고 중단합니다");
    process.exitCode = 1;
    throw new Error("admissioninfos 조회 실패");
  }
  const admByBoard = new Map();
  for (const a of adm) for (const bid of a.boardIds) admByBoard.set(bid, [...(admByBoard.get(bid) ?? []), a]);

  const studentKeys = students.map((s) => ({ s, keys: studentIdentityKeys(s.name, s.classnote_name) }));
  const studentBoards = boards.filter((b) => STUDENT_BOARD.test(b.name));

  let targets = studentBoards;
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  // 1단계 — 보드별 사실 수집(게시물·매칭·전화). 판정은 학생 단위 합산 뒤에 한다.
  const collected = [];
  for (const b of targets) {
    const m = STUDENT_BOARD.exec(b.name);
    const subjectLabel = m[1];
    const base = normBoard(m[2]);
    // 보드명은 우리가 만든 이름이라 **정확 일치**로 조회(원아 표시명용 childIdentityKeys를 쓰면 접미사가 벗겨진다).
    let hits = studentKeys.filter((x) => x.keys.has(base)).map((x) => x.s);

    // ── 전화 대조로 후보 좁히기(원장 제안) — 이름·생년은 추정이지만 전화는 그 집의 사실이다.
    const occupants = admByBoard.get(b.id) ?? [];
    const cnPhones = occupants.map((o) => o.phone).filter(Boolean);
    let phone = { checked: false, match: null };
    if (hits.length && cnPhones.length) {
      const matched = hits.filter((s) => phoneMatches([s.parent_phone, s.student_phone], cnPhones) === true);
      if (matched.length === 1) {
        hits = matched; // 동명이인이라도 전화가 확정해준다
        phone = { checked: true, match: true };
      } else if (matched.length === 0) {
        phone = { checked: true, match: false };
      } else {
        hits = matched; // 2명 이상 일치(형제 등) → ambiguous로 흘려보낸다
        phone = { checked: true, match: true };
      }
    }

    const s = hits.length === 1 ? hits[0] : null;
    const wanted = subjectLabel === "수학" ? ["math", "subject_1"] : ["english"];
    const active = s ? (activeBySid.get(s.id) ?? []) : [];
    const meta = classMeta[b.id] ?? {};
    const posts = await fetchBoardPosts(page, centerId, b.id);
    collected.push({ b, s, hits, phone, wanted, active, meta, posts, subjectLabel });
  }

  // ⭐ 원장 백스톱(2026-07-30): "최근 7일 사이에 어떠한 보고서라도 업로드된 학생은 퇴원처리 불가".
  // **과목·보드를 가리지 않고** 그 학생의 전 보드 게시물을 합산한다 — 수강 데이터가 틀려도 ClassNote 활동
  // 자체가 생존을 증명하므로, 다른 가드가 다 실패해도 재원생을 명부에서 내리는 것을 막는 마지막 그물이다.
  const anyPostByStudent = new Map();
  for (const c of collected) {
    if (!c.s) continue;
    const cur = anyPostByStudent.get(c.s.id) ?? { complete: true, lastPostAt: null };
    if (!c.posts || c.posts.complete !== true) cur.complete = false;
    if (c.posts?.lastPostAt && (!cur.lastPostAt || c.posts.lastPostAt > cur.lastPostAt)) cur.lastPostAt = c.posts.lastPostAt;
    anyPostByStudent.set(c.s.id, cur);
  }

  const results = [];
  for (const { b, s, hits, phone, wanted, active, meta, posts, subjectLabel } of collected) {
    const v = evaluateBoardRelease({
      board: { id: b.id, name: b.name, children: meta.children ?? b.children },
      matchedStudentCount: hits.length,
      student: s
        ? {
            id: s.id,
            name: s.name,
            status: s.status,
            subjectActive: active.some((x) => wanted.includes(x)),
            allSubjectsEnded: active.length === 0,
            withdrawnAt: s.withdrawn_at,
          }
        : null,
      phone,
      posts,
      teachers: meta.teachers ?? 0,
      today: TODAY,
      dormantDays: DORMANT_DAYS,
      studentAnyPost: s ? (anyPostByStudent.get(s.id) ?? null) : null,
      anyPostDays: ANY_POST_DAYS,
    });
    results.push({ board: b, student: s, v, posts, phone, teachers: meta.teachers ?? 0, families: meta.children ?? b.children, subjectLabel });
  }

  const release = results.filter((r) => r.v.action === "release");
  const opB = release.filter((r) => r.v.alsoOffboard);
  const opAonly = release.filter((r) => !r.v.alsoOffboard);
  const holds = results.filter((r) => r.v.action === "hold");
  const excluded = results.filter((r) => r.v.action === "exclude");
  const tally = (list) => {
    const m = new Map();
    for (const r of list) m.set(r.v.primaryCode, (m.get(r.v.primaryCode) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ") || "없음";
  };
  const line = (r) =>
    `   · ${r.board.name} (id ${r.board.id})` +
    (r.student ? ` ← eywa ${r.student.name}/${r.student.grade ?? "?"}` : "") +
    (r.student?.withdrawn_at ? `/퇴원 ${r.student.withdrawn_at}` : "") +
    ` · 가족 ${r.families ?? "?"} · 교사 ${r.teachers} · 게시물 ${r.posts ? r.posts.count + (r.posts.complete ? "" : "+") : "?"}` +
    (r.posts?.lastPostAt ? `(마지막 ${r.posts.lastPostAt})` : "") +
    ` · 전화 ${r.phone.checked ? (r.phone.match ? "일치✅" : "불일치") : "미확인"}` +
    (r.student?.makeedu_id ? " · makeedu✅" : "");

  if (!JSON_OUT) {
    console.log(`\n════ ClassNote 반 정리 후보 (READ-ONLY · eywa 기준 · 기준일 ${TODAY} KST · 무게시 ${DORMANT_DAYS}일) ════`);
    console.log(`전체 보드 ${boards.length} · 학생모드 ${studentBoards.length} · 판정 ${results.length}`);
    console.log(`\n▶ 정리 가능(release) ${release.length}건 = **A+B(전과목 퇴원 → 반삭제+배정해제+퇴원처리) ${opB.length}** · **A만(일부 과목 퇴원 → 반삭제+배정해제, 퇴원처리 금지) ${opAonly.length}**`);
    console.log(`▶ 보류(hold) ${holds.length} — ${tally(holds)}`);
    console.log(`▶ 제외(exclude) ${excluded.length} — ${tally(excluded)}`);

    console.log(`\n══ [A+B] 전과목 퇴원 — 반 삭제 + 배정 해제 + 명부 퇴원처리 : ${opB.length}건 ══`);
    opB.forEach((r) => console.log(line(r)));

    console.log(`\n══ [A만] 일부 과목 퇴원 — 반 삭제 + 배정 해제 (⚠️ 퇴원처리 금지: 다른 과목 수강 중) : ${opAonly.length}건 ══`);
    opAonly.forEach((r) => console.log(line(r)));

    console.log(`\n══ 보류 상세 ══`);
    holds.slice(0, 25).forEach((r) => console.log(`${line(r)}\n       ↳ ${r.v.reason}`));
    if (holds.length > 25) console.log(`   … 외 ${holds.length - 25}건`);

    const notable = excluded.filter((r) => ["phone_mismatch", "shared_board", "members_unknown", "posts_unknown", "ambiguous"].includes(r.v.primaryCode));
    console.log(`\n══ 제외 중 사람이 봐야 할 것 ${notable.length}건 ══`);
    notable.slice(0, 25).forEach((r) => console.log(`${line(r)}\n       ↳ ${r.v.reason}`));

    console.log(`\n가드(우선순위): ${RELEASE_GUARDS.map((g) => g.code).join(" > ")} > ok`);
    console.log("이 스캔은 아무것도 변경하지 않았습니다(ClassNote GET · DB select 전용).");
  } else {
    console.log(
      JSON.stringify(
        {
          today: TODAY,
          dormantDays: DORMANT_DAYS,
          summary: { boards: boards.length, studentBoards: studentBoards.length, release: release.length, opB: opB.length, opAonly: opAonly.length, hold: holds.length, exclude: excluded.length },
          rows: results.map((r) => ({
            boardId: r.board.id,
            board: r.board.name,
            studentId: r.student?.id ?? null,
            action: r.v.action,
            alsoOffboard: r.v.alsoOffboard,
            primaryCode: r.v.primaryCode,
            matchedCodes: r.v.matchedCodes,
            factsComplete: r.v.factsComplete,
            families: r.families,
            teachers: r.teachers,
            posts: r.posts?.count ?? null,
            lastPostAt: r.posts?.lastPostAt ?? null,
            phoneChecked: r.phone.checked,
            phoneMatch: r.phone.match,
          })),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
