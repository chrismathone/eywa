/**
 * scripts/_classnote/scan-offboard-candidates.mjs — eywa 퇴원생의 ClassNote **퇴원처리 후보 스캔**. **READ-ONLY**.
 *
 * 아무것도 변경하지 않는다(ClassNote는 GET만, eywa DB는 select만). 쓰기 경로는 이 스캔이 실데이터에서
 * "재원생 오탐 0"을 증명한 뒤 **별도 승인**으로 만든다 — 순서를 뒤집으면 첫 실행이 첫 실험이 된다.
 *
 * 판정은 전부 [offboard-safety.mjs](./offboard-safety.mjs)(순수)가 한다. 이 파일의 책임은 **사실 수집**과
 * **독립 검증**뿐이다.
 *
 * 🔴 왜 이렇게까지 하나: ClassNote 퇴원처리는 원아를 센터 명부에서 내리므로(실측: 처리된 87명 중 명부 잔존
 * 2명 = 2%) 되돌리려면 **학부모 재초대 + 재가입**이 필요하다 — 자동화 불가 구간이다. 잘못 내리면 재원생
 * 가족을 학원 앱에서 끊는다. 그래서 모든 가드가 fail-closed고, 이 스캔은 4개 블록의 **단위가 다른** 통계를
 * 섞지 않고 따로 보고한다(child 수 / board 수 / ERP 행·이름그룹 수).
 *
 * 실행: node --env-file=.env.local scripts/_classnote/scan-offboard-candidates.mjs [--json] [--grace=45] [--limit-detail=N]
 * exit code: 독립 검증 위반(재원생이 후보에 섞임)·필수 입력 결손 시 **1**.
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  launchAdminBrowser,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  fetchOffboardChildren,
  fetchChildDetail,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";
import { kstSchoolYear, normBoard } from "./board-safety.mjs";
import { childIdentityKeys, studentIdentityKeys, matchesIdentity } from "./identity-keys.mjs";
import { evaluateOffboardCandidate, ownedBoardNames, GUARDS } from "./offboard-safety.mjs";

const JSON_OUT = process.argv.includes("--json");
const GRACE_DAYS = Number(process.argv.find((a) => a.startsWith("--grace="))?.split("=")[1] ?? 45);
const DETAIL_LIMIT = Number(process.argv.find((a) => a.startsWith("--limit-detail="))?.split("=")[1] ?? 0);
const DETAIL_FAIL_RATIO = 0.2; // 이 비율을 넘겨 실패하면 부분 판정을 내지 않고 중단한다
const ACTIVITY_DAYS = 30;
const STUDENT_BOARD = /^\((수학|영어)\)(.+)$/;
const BROADCAST_BOARD = /^\[ALL\]/;

/** KST 오늘(YYYY-MM-DD) — 워커 PC 로컬시간이 아니라 명시적으로 서울 기준. */
function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}
function shiftDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
const fail = (msg) => {
  console.error(`\n🔴 ${msg}`);
  process.exitCode = 1;
};

const TODAY = kstToday();
const SINCE = shiftDays(TODAY, -ACTIVITY_DAYS);
const SCHOOL_YEAR = kstSchoolYear();

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchAdminBrowser();
const page = await browser.newPage();
try {
  const tenant = await resolveTenant(sql);

  // ── eywa 사실 ─────────────────────────────────────────────────────────────
  const students = await sql`
    select s.id, s.name, s.classnote_name, s.status, s.grade,
           to_char(s.withdrawn_at, 'YYYY-MM-DD') as withdrawn_at
    from students s where s.tenant_id = ${tenant}`;
  // 활성 수강 = **과목 무관 전 과목**(퇴원처리는 학생 전체를 명부에서 내리므로 어떤 과목이든 살아 있으면 제외)
  const activeRows = await sql`
    select distinct e.student_id, c.subject
    from enrollments e join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where e.tenant_id = ${tenant} and e.end_date is null`;
  const activeBySid = new Map();
  for (const r of activeRows) activeBySid.set(r.student_id, [...(activeBySid.get(r.student_id) ?? []), r.subject ?? "(과목없음)"]);
  // ⚠️ 보드 감사(블록 2)의 '과목이탈' 판정에 **발송 opt-in을 섞지 말 것** — opt-in이 수학뿐이면 영어를
  //    멀쩡히 다니는 학생의 영어 보드가 전부 '과목이탈'로 잡힌다(실측: 58 → 237로 부풀었다).
  //    "그 보드 과목의 수강이 살아 있는가"는 opt-in과 무관한 사실이므로 activeBySid(전 과목)로 본다.

  // 최근 활동(hold 신호)
  const sentRows = await sql`
    select distinct student_id, max(coalesce(to_char(classnote_sent_at, 'YYYY-MM-DD'), to_char(report_date, 'YYYY-MM-DD'))) as at
    from lesson_reports
    where tenant_id = ${tenant} and classnote_status in ('success','queued','processing')
      and (report_date >= ${SINCE}::date or classnote_sent_at >= ${SINCE}::date)
    group by student_id`;
  const sentBySid = new Map(sentRows.map((r) => [r.student_id, r.at]));
  const startRows = await sql`
    select student_id, max(to_char(start_date, 'YYYY-MM-DD')) as at
    from enrollments where tenant_id = ${tenant} and start_date >= ${SINCE}::date group by student_id`;
  const startBySid = new Map(startRows.map((r) => [r.student_id, r.at]));
  // ⚠️ 인바운드 알림엔 student_id가 없다(schema: title/body/link만) → **이름 부분일치**뿐이라 약한 신호다.
  //    hold 방향 전용이라 과대매칭은 무해(비용 = 정리 지연). "안전하다"의 근거로는 절대 쓰지 않는다.
  const inbound = await sql`
    select coalesce(title,'') || ' ' || coalesce(body,'') as text
    from notifications
    where tenant_id = ${tenant} and type in ('classnote_parent_post','classnote_parent_comment')
      and created_at >= ${SINCE}::date`;
  const inboundText = inbound.map((r) => normBoard(r.text));

  // ── ClassNote 사실(GET only) ───────────────────────────────────────────────
  await loginClassnote(page);
  await page.goto(`${CLASSNOTE_BASE}/service/report`, { waitUntil: "domcontentloaded" });
  await dismissHonorificDialog(page);
  const centerId = await fetchCenterId(page);

  let boards = [];
  let boardScanComplete = true;
  try {
    boards = await fetchBoards(page, centerId);
  } catch (e) {
    boardScanComplete = false;
    console.warn(`⚠️ 보드 전건 조회 실패 — 전건이 보류됩니다: ${e.message}`);
  }
  const children = await fetchOffboardChildren(page, centerId);
  const erp = await page.evaluate(async (cid) => {
    const r = await fetch(`/api/v1_2/centers/${cid}/erp-children/`, { headers: { accept: "application/json" } });
    if (!r.ok) return { error: r.status };
    return { rows: await r.json() };
  }, centerId);

  // ERP 필수 필드 결손 = 부분 판정 금지(스캔 중단)
  let erpRows = null;
  if (erp?.error || !Array.isArray(erp?.rows)) {
    fail(`ERP 명부 조회 실패(HTTP ${erp?.error ?? "?"}) — 부분 판정을 하지 않고 중단합니다`);
  } else {
    const bad = erp.rows.filter((r) => r?.id == null || !r?.child_name || !("in_date" in r) || !("out_date" in r));
    if (bad.length) fail(`ERP 명부 필수 필드 결손 ${bad.length}행 — ClassNote 스키마 변경 의심, 중단합니다`);
    else erpRows = erp.rows;
  }
  if (process.exitCode === 1) throw new Error("입력 계약 위반으로 중단");

  // ── 키·카디널리티 ─────────────────────────────────────────────────────────
  // ⚠️ 카디널리티는 **이름 매칭만으로** 센다(생년으로 좁히지 않는다). 생년으로 후보를 좁히면 학년이 없는
  //    동명 학생이 집합에서 빠져 모호성이 숨는다 — 생년은 별개 가드(identity_unknown)로만 검사한다.
  const studentKeys = students.map((s) => ({ s, keys: studentIdentityKeys(s.name, s.classnote_name) }));
  const childKeySets = children.map((c) => ({ c, keys: childIdentityKeys(c.name) }));
  const matchedStudents = new Map(); // childId → students[]
  const matchedChildren = new Map(); // studentId → children[]
  for (const { c, keys } of childKeySets) {
    const hits = studentKeys.filter((x) => matchesIdentity(x.keys, keys)).map((x) => x.s);
    matchedStudents.set(c.id, hits);
    for (const s of hits) matchedChildren.set(s.id, [...(matchedChildren.get(s.id) ?? []), c]);
  }

  // 보드 인덱스
  const boardsByNorm = new Map();
  for (const b of boards) boardsByNorm.set(normBoard(b.name), [...(boardsByNorm.get(normBoard(b.name)) ?? []), b]);
  const broadcastBoardIds = boards.filter((b) => BROADCAST_BOARD.test(b.name)).map((b) => b.id);
  // 보드 **ID → 1인 보드인가**. foreign 판정을 이름 비교가 아니라 ID 해석으로 하기 위한 색인.
  // 목록에 없는 id는 map에 없어 `undefined`가 되고, 순수 판정이 fail-closed로 foreign 취급한다.
  const isStudentBoardById = new Map(boards.map((b) => [b.id, STUDENT_BOARD.test(b.name)]));

  // ERP 이름 증거(제외 방향 전용)
  const erpByName = new Map();
  for (const r of erpRows) {
    const k = normBoard(String(r.child_name));
    const cur = erpByName.get(k) ?? { activeRows: 0, outRows: 0 };
    if (r.out_date) cur.outRows++;
    else cur.activeRows++;
    erpByName.set(k, cur);
  }

  function factsFor(c, childDetail) {
    const hits = matchedStudents.get(c.id) ?? [];
    const s = hits.length === 1 ? hits[0] : null;
    const eff = s ? (s.classnote_name || s.name || "").trim() : null;
    const owned = eff ? ownedBoardNames(eff) : [];
    let nameConflicts = 0;
    const ownedBoardRows = [];
    for (const name of owned) {
      const found = boardsByNorm.get(normBoard(name)) ?? [];
      if (found.length > 1) nameConflicts++;
      for (const b of found) ownedBoardRows.push({ id: b.id, name: b.name, children: b.children });
    }
    // ⚠️ ERP 전건을 이미 받아 필수 필드까지 검증했으므로 **"같은 이름 행이 0개"도 계산된 사실**이다 →
    //    null(=미조회)로 넘기면 그 가드가 '미평가'로 남아 factsComplete가 false인 후보가 생긴다
    //    (스캐너 자기 검증이 실제로 이 결함을 1건 잡았다). null은 ERP 미조회 전용이고, 여기선 발생하지 않는다.
    const erpEv = erpByName.get(normBoard(c.name)) ?? (eff ? erpByName.get(normBoard(eff)) : null) ?? { activeRows: 0, outRows: 0 };
    return {
      child: c,
      matchedStudentCount: hits.length,
      reverseMatchCount: s ? (matchedChildren.get(s.id) ?? []).length : 0,
      student: s
        ? {
            id: s.id,
            name: s.name,
            grade: s.grade,
            status: s.status,
            activeSubjects: activeBySid.get(s.id) ?? [],
            withdrawnAt: s.withdrawn_at,
          }
        : null,
      childDetail,
      ownedBoards: { scanComplete: boardScanComplete, boards: ownedBoardRows, nameConflicts },
      broadcastBoardIds,
      erpNameEvidence: erpEv,
      activity: s
        ? {
            lastReportSentAt: sentBySid.get(s.id) ?? null,
            recentEnrollmentStart: startBySid.get(s.id) ?? null,
            inboundNameHit: eff ? inboundText.some((t) => t.includes(normBoard(eff))) : false,
          }
        : {},
      today: TODAY,
      schoolYear: SCHOOL_YEAR,
      graceDays: GRACE_DAYS,
    };
  }

  // ── 1-pass(전건, 값싼 사실) ────────────────────────────────────────────────
  const verdicts = new Map();
  for (const c of children) verdicts.set(c.id, evaluateOffboardCandidate(factsFor(c, { status: "not_collected" })));

  // ── 2-pass — exclude가 아닌 전부(hold 포함!) 원아 상세 보강 후 재평가 ──────
  // ⚠️ hold도 반드시 통과시킨다: 뒤에서 foreign_board 같은 exclude가 드러나면 exclude가 hold를 이겨야 하는데,
  //    hold에서 수집을 끊으면 위험이 hold 뒤에 숨는다.
  let pending = children.filter((c) => verdicts.get(c.id).action !== "exclude");
  if (DETAIL_LIMIT > 0) pending = pending.slice(0, DETAIL_LIMIT);
  let detailFailed = 0;
  const detailById = new Map(); // 진단(어떤 보드가 foreign으로 잡혔나) 출력을 위해 보관
  for (const c of pending) {
    let detail = { status: "failed" };
    try {
      const d = await fetchChildDetail(page, c.id);
      detail = {
        status: "ok",
        // 보드 카테고리는 **ID로** 해석해서 넘긴다(순수 판정이 이름을 파싱하지 않도록).
        enrollments: (d?.enrollment ?? []).map((e) => ({ ...e, isStudentBoard: isStudentBoardById.get(e.belong_to_class) })),
      };
    } catch {
      detailFailed++;
    }
    detailById.set(c.id, detail);
    verdicts.set(c.id, evaluateOffboardCandidate(factsFor(c, detail)));
  }
  if (pending.length && detailFailed / pending.length > DETAIL_FAIL_RATIO) {
    fail(`원아 상세 조회 실패율 ${Math.round((detailFailed / pending.length) * 100)}% — 부분 판정을 신뢰할 수 없어 중단합니다`);
    throw new Error("상세 조회 실패율 초과");
  }

  const rows = children.map((c) => ({ child: c, v: verdicts.get(c.id), student: (matchedStudents.get(c.id) ?? [])[0] ?? null }));
  const candidates = rows.filter((r) => r.v.action === "offboard");
  const holds = rows.filter((r) => r.v.action === "hold");
  const excluded = rows.filter((r) => r.v.action === "exclude");

  // ── 블록 1. 원아 판정(단위 = child 수) ─────────────────────────────────────
  const byCode = (list) => {
    const m = new Map();
    for (const r of list) m.set(r.v.primaryCode, (m.get(r.v.primaryCode) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const complete = rows.filter((r) => r.v.factsComplete).length;
  const overlap = new Map();
  for (const r of rows.filter((x) => x.v.factsComplete)) for (const code of r.v.matchedCodes) overlap.set(code, (overlap.get(code) ?? 0) + 1);

  if (!JSON_OUT) {
    console.log(`\n════ 블록 1. 원아 판정 (단위: ClassNote 원아 명부 ${children.length}명 · 기준일 ${TODAY} KST · 유예 ${GRACE_DAYS}일) ════`);
    console.log(`  후보(offboard) ${candidates.length} · 보류(hold) ${holds.length} · 자동처리 제외(exclude) ${excluded.length}`);
    console.log(`  사실 완전 수집(factsComplete) ${complete}/${rows.length}`);
    console.log(`  제외 사유별: ${byCode(excluded).map(([c, n]) => `${c} ${n}`).join(" · ") || "없음"}`);
    console.log(`  보류 사유별: ${byCode(holds).map(([c, n]) => `${c} ${n}`).join(" · ") || "없음"}`);
    console.log(`  중첩 가드(factsComplete 행만): ${[...overlap].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ") || "없음"}`);
    // foreign_board가 무엇 때문에 걸렸는지 근거를 보여준다 — 그룹반을 foreign으로 세면 정상 학생이 통째로
    // 오차단되므로(실측 64건) 이 목록이 '남의 1인 보드'로만 채워져 있는지 사람이 확인할 수 있어야 한다.
    const foreignRows = rows.filter((r) => r.v.matchedCodes.includes("foreign_board"));
    if (foreignRows.length) {
      const tally = new Map();
      for (const r of foreignRows) {
        const f = factsFor(r.child, detailById.get(r.child.id) ?? { status: "not_collected" });
        const ownedIds = new Set(f.ownedBoards.boards.map((b) => b.id));
        for (const e of (f.childDetail.enrollments ?? []).filter(
          (x) => !x.removed_child && !ownedIds.has(x.belong_to_class) && !broadcastBoardIds.includes(x.belong_to_class) && x.isStudentBoard !== false,
        ))
          tally.set(e.class_name ?? `보드 ${e.belong_to_class}`, (tally.get(e.class_name ?? `보드 ${e.belong_to_class}`) ?? 0) + 1);
      }
      console.log(
        `  foreign_board 근거 보드 상위: ${[...tally].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => `${n}×${k}`).join(" · ")}`,
      );
    }
    if (candidates.length) {
      console.log(`\n  ── 후보 상세(승인 대상) ──`);
      for (const r of candidates) {
        const s = r.student;
        console.log(
          `   · ${r.child.name}(원아 ${r.child.id}) ← eywa ${s?.name}/${s?.grade}/퇴원 ${s?.withdrawn_at} · ` +
            `보드 ${r.v.snapshot.boardNames.join(", ") || "없음"} · 복구연락처 ${r.v.snapshot.parentName ?? r.v.snapshot.parentUsername}`,
        );
      }
    }
  }

  // ── 블록 1-B. 독립 검증 — 판정 경로를 쓰지 않고 별도 SQL로 대조 ───────────
  // 순환 검증 방지: 판정이 쓴 사실(activeBySid 등)을 재사용하지 않고 **DB에 다시 물어본다**.
  // ⚠️ 두 조건을 **AND가 아니라 OR**로 본다: `status<>'withdrawn' AND 활성수강`으로 좁히면
  //    "퇴원 표시인데 수강이 살아 있는" 데이터 모순 케이스가 검증 그물을 통째로 빠져나간다.
  //    원장 지시(2026-07-30): **한 과목이라도 살아 있으면 ClassNote에 남겨둔다.**
  const liveIds = new Set(
    (
      await sql`
      select distinct s.id from students s
      left join enrollments e on e.student_id = s.id and e.tenant_id = ${tenant} and e.end_date is null
      where s.tenant_id = ${tenant} and (s.status <> 'withdrawn' or e.id is not null)`
    ).map((r) => r.id),
  );
  const candidateSids = candidates.map((r) => r.student?.id).filter(Boolean);
  const violations = candidateSids.filter((id) => liveIds.has(id));
  if (!JSON_OUT) {
    console.log(`\n  ── 독립 검증(별도 SQL: 재원 또는 활성 수강 보유 ${liveIds.size}명) ──`);
    console.log(`   후보 ∩ 재원생 = ${violations.length}${violations.length === 0 ? " ✅" : " 🔴"}`);
  }
  if (violations.length) {
    for (const id of violations) {
      const r = candidates.find((x) => x.student?.id === id);
      fail(`재원생이 후보에 섞였습니다 — eywa ${r?.student?.name}(${id}) / 원아 ${r?.child?.name}(${r?.child?.id})`);
    }
  }
  const incomplete = candidates.filter((r) => !r.v.factsComplete);
  if (incomplete.length) fail(`사실이 불완전한 후보 ${incomplete.length}건 — 2-pass가 누락됐습니다(후보는 항상 factsComplete여야 함)`);

  // ── 블록 2. 보드 감사(단위 = 보드 수, 원아 판정과 별개 통계) ───────────────
  const studentBoards = boards.filter((b) => STUDENT_BOARD.test(b.name));
  const unknownMembers = studentBoards.filter((b) => b.children == null);
  const sharedBoards = studentBoards.filter((b) => (b.children ?? 0) >= 2);
  const nameToStudents = new Map();
  for (const { s, keys } of studentKeys) for (const k of keys) nameToStudents.set(k, [...(nameToStudents.get(k) ?? []), s]);
  let bWithdrawn = 0;
  let bDropped = 0;
  let bNoMatch = 0;
  let bActive = 0;
  for (const b of studentBoards) {
    const m = STUDENT_BOARD.exec(b.name);
    const subjectLabel = m[1];
    const hits = nameToStudents.get(normBoard(m[2])) ?? [];
    if (!hits.length) {
      bNoMatch++;
      continue;
    }
    const alive = hits.filter((s) => s.status !== "withdrawn");
    if (!alive.length) {
      bWithdrawn++;
      continue;
    }
    // 그 보드 과목의 활성 수강이 있는가(없으면 '과목 이탈' 보드) — opt-in 무관, 전 과목 기준
    const wanted = subjectLabel === "수학" ? ["math", "subject_1"] : ["english"];
    const stillTaking = alive.some((s) => (activeBySid.get(s.id) ?? []).some((x) => wanted.includes(x)));
    if (stillTaking) bActive++;
    else bDropped++;
  }
  const candidateBoardCount = new Set(candidates.flatMap((r) => r.v.snapshot.boardIds)).size;
  if (!JSON_OUT) {
    console.log(`\n════ 블록 2. 보드 감사 (단위: 보드 — 원아 수와 직접 비교 금지) ════`);
    console.log(`  전체 ${boards.length} · 학생모드 ${studentBoards.length} · 정상(수강중) ${bActive}`);
    console.log(`  퇴원 학생 보드 ${bWithdrawn} · 과목이탈 보드 ${bDropped} · eywa 미매칭 ${bNoMatch} · 공유(가족2+) ${sharedBoards.length}`);
    console.log(`  ⚠️ 연결 가족 수 미확인 ${unknownMembers.length}${unknownMembers.length ? " — ClassNote API 변경 의심(해당 보드는 전부 보류)" : " ✅"}`);
    console.log(`  후보 원아에 연결된 보드 수 ${candidateBoardCount}`);
  }

  // ── 블록 3. ERP 품질(단위 = 행·이름 그룹) ─────────────────────────────────
  const erpActive = erpRows.filter((r) => !r.out_date);
  const dupActive = [...erpActive.reduce((m, r) => m.set(normBoard(r.child_name), (m.get(normBoard(r.child_name)) ?? 0) + 1), new Map())].filter(
    ([, n]) => n > 1,
  );
  if (!JSON_OUT) {
    console.log(`\n════ 블록 3. ERP 명부 품질 (단위: 행 / 이름 그룹 — 스키마 감시 전용) ════`);
    console.log(`  총 ${erpRows.length}행 · 활성 ${erpActive.length} · 퇴원 ${erpRows.length - erpActive.length}`);
    console.log(`  활성 명부 동명(같은 이름 2행+) ${dupActive.length} 그룹 — 이름으로 ERP 행을 지목할 수 없는 근거`);
    console.log(`  필수 필드 결손 0 ✅ (id·child_name·in_date·out_date)`);
  }

  // ── 블록 4. 유예 효과(단위 = child 수) ────────────────────────────────────
  const noGrace = children.filter((c) => {
    const v = evaluateOffboardCandidate({ ...factsFor(c, { status: "ok", enrollments: [] }), graceDays: 0 });
    return v.action === "offboard";
  }).length;
  if (!JSON_OUT) {
    console.log(`\n════ 블록 4. 유예 효과 (단위: 원아 수) ════`);
    console.log(`  유예 0일이라면 후보 ${noGrace}명 → 유예 ${GRACE_DAYS}일 적용 후 ${candidates.length}명 (차이 ${noGrace - candidates.length})`);
    if (noGrace <= candidates.length)
      console.log("  ⚠️ 유예가 아무도 걸러내지 않았습니다 — 유예 계산이나 퇴원일 데이터를 확인하세요");
    console.log(`\n가드 목록(우선순위 순): ${GUARDS.map((g) => g.code).join(" > ")} > ok`);
    console.log("\n이 스캔은 아무것도 변경하지 않았습니다(ClassNote GET · DB select 전용).");
  }

  if (JSON_OUT)
    console.log(
      JSON.stringify(
        {
          today: TODAY,
          graceDays: GRACE_DAYS,
          childVerdicts: rows.map((r) => ({ childId: r.child.id, ...r.v })),
          boardAudit: {
            total: boards.length,
            studentBoards: studentBoards.length,
            withdrawn: bWithdrawn,
            subjectDropped: bDropped,
            noMatch: bNoMatch,
            shared: sharedBoards.length,
            membersUnknown: unknownMembers.length,
            candidateBoards: candidateBoardCount,
          },
          erp: { rows: erpRows.length, active: erpActive.length, dupActiveNameGroups: dupActive.length },
          grace: { withoutGrace: noGrace, withGrace: candidates.length },
          independentCheck: { liveStudents: liveIds.size, violations: violations.length },
        },
        null,
        2,
      ),
    );
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
