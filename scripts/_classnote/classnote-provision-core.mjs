/**
 * scripts/_classnote/classnote-provision-core.mjs — 일일 보드 프로비저닝 + 자동 배정(데몬 호출용).
 *
 * 신규생 흐름 자동화: 매일 KST 05시 이후 첫 폴에서 1회 —
 *   ① 재원 + 발송 opt-in 과목 활성 수강인데 보드 없는 학생 → `(과목)이름` 빈 보드 생성(DOM)
 *   ② 학부모 가입까지 됐는데 자기 보드가 비어있는 학생 → 배정(POST /api/v1/enrollments/, ID 기반)
 * 동명이인(aywa 유효이름 중복·ClassNote 동명 원아)은 자동 처리 안 하고 로그로 보류 — 오발송 방지.
 * 학부모 초대(가입)만 사람 몫으로 남는다. 수동 실행판 = provision/assign-classnote-*.mjs (동일 기준).
 *
 * 실행 조건: 데몬 --post 모드에서만(dry-run 데몬은 아무것도 안 만짐). 발송 스위치(classnoteSendEnabled)와는
 * 무관 — 보드·배정은 발송이 아니라 인프라 준비(스위치 OFF 기간에도 신규생 보드가 미리 쌓이도록).
 * ⚠️ 배정 시 ClassNote가 학부모 앱에 반 배정 알림을 보낼 수 있음(정상 온보딩 절차).
 * 하루 1회 마커 = 로컬 파일(CLASSNOTE_OUT/provision-last-run.txt) — PC 재설정 시 재실행돼도 diff 기반이라 멱등.
 */
import fs from "node:fs";
import { stateFile } from "./classnote-paths.mjs";
import {
  BOARD_GROUPS,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  fetchChildren,
  fetchChildDetail,
  fetchBoardChildren,
  enrollChild,
  createBoard,
  planChildMatches,
  hasForeignStudentBoard,
  norm,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";
import { getClassnoteMathRoute } from "./classnote-class-route.mjs";
import { loadVerifiedChildren } from "./math-class-boards-load.mjs";
import { dropVerifiedTargets } from "./class-board-plan.mjs";

/** 역방향 유일성 검사용 우주 — **status·과목 무필터 전 학생 유효이름**(퇴원 포함).
 *  타깃 목록만 쓰면 퇴원 동명이인(F1)·과목 필터 뒤 동명(F2)·동명 보류 제외분(F3)이 안 보인다. */
export async function fetchUniverseNames(sql, tenant) {
  const rows = await sql`select name, classnote_name from students where tenant_id = ${tenant}`;
  return [...new Set(rows.map((r) => (r.classnote_name || r.name || "").trim()).filter(Boolean))];
}

// ⚠️ 마커 경로는 classnote-paths 단일 진입점 경유(2026-07-21) — 예전엔 여기서 `D:/tmp/classnote`를 직접 쓰다가
// 그 폴더를 못 만드는 PC에서 markRun이 조용히 실패 → lastRun()이 늘 빈값 → **하루 1회여야 할 프로비저닝이
// 매 폴(15초)마다 재실행**됐다(실측). 폴더 결정은 쓰기 테스트까지 통과한 곳만 고른다.
const STATE_FILE = stateFile("provision-last-run.txt");
const RUN_AFTER_HOUR_KST = 5; // 새벽 5시 이후(수업 전 준비 완료, 야간 소음 회피)

function kstDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
function kstHour() {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()),
  );
}
// 메모리 마커 — 파일이 안 써지는 환경에서도 **한 프로세스 안에선 하루 1회**를 보장하는 안전망.
// 파일은 "데몬 재시작을 넘어" 기억하기 위한 것이고, 메모리는 파일이 죽어도 폭주를 막는 최후 방어선이다.
// (2026-07-21: 파일만 믿다가 매 폴 재실행됐다.)
let memoryLastRun = "";
function lastRun() {
  if (memoryLastRun) return memoryLastRun;
  if (!STATE_FILE) return "";
  try {
    return fs.readFileSync(STATE_FILE, "utf8").trim();
  } catch {
    return "";
  }
}
function markRun(d) {
  memoryLastRun = d;
  if (!STATE_FILE) return;
  try {
    fs.writeFileSync(STATE_FILE, d); // 폴더는 stateFile()이 이미 보장(쓰기 테스트 통과)
  } catch {
    /* 마커 실패가 데몬을 죽이면 안 됨 — 메모리 마커가 당일 폭주는 막는다 */
  }
}

/** 그룹별 기대 보드 — 재원 + 활성 수강(subjectKeys ∩ opt-in). 동명이인은 collisions로 분리.
 *  ⚠️ 그룹핑 키 = norm(유효이름, 공백 제거) — "김 민수"와 "김민수"가 서로 다른 학생인데 같은 물리 보드로
 *  합쳐지는 것을 동명이인으로 취급해 보류(2026-07-13 적대 검증 픽스). */
async function expectedFor(sql, tenant, keys, prefix) {
  const rows = await sql`
    select distinct s.id, s.name, s.classnote_name
    from students s
    join enrollments e on e.student_id = s.id and e.end_date is null and e.tenant_id = ${tenant}
    join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where s.tenant_id = ${tenant}
      and s.status = 'enrolled'
      and c.subject in ${sql(keys)}`;
  const byName = new Map();
  for (const r of rows) {
    const eff = (r.classnote_name || r.name || "").trim();
    if (!eff) continue;
    const key = norm(eff);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ ...r, eff });
  }
  const targets = [];
  const collisions = [];
  for (const [, students] of byName) {
    if (students.length > 1) collisions.push({ name: students[0].eff, count: students.length });
    else targets.push({ student: students[0].eff, board: `${prefix}${students[0].eff}`, studentId: students[0].id });
  }
  return { targets, collisions };
}

/**
 * 수학이 반별 발송(class)이면 **반 보드에서 원아 확인을 마친 학생**은 1인 보드를 만들지도 채우지도 않는다(원장 2026-11-02 —
 * 1인 보드 원아 배정 해제 → 12월 보드 삭제). 반 보드 동기화가 그 학생은 확인 기록으로 원아를 판정한다(class-board-plan.mjs ①).
 * 안 빼면 비운 1인 보드를 "가입했는데 빈 보드"로 보고 다시 배정하고(학부모 앱에 반 배정 알림이 갈 수 있다), 지운 보드는 다시 만든다.
 * 확인 기록이 없는 학생(신입·보류)은 그대로 둔다 — 1인 보드가 그 원아를 처음 확인하는 출처다.
 * 🔴 경로·기록을 못 읽으면 그날 **수학을 통째로 건너뛴다**(모르는 채로 비운 보드를 다시 채우지 않는다 — 신입 보드는 다음 날 만든다).
 */
async function dropRetiredMathTargets(sql, tenant, plans, log) {
  const math = plans.find((p) => p.group.prefix === BOARD_GROUPS.math.prefix);
  if (!math || !math.targets.length) return;
  let route;
  try {
    ({ route } = await getClassnoteMathRoute(sql, tenant));
  } catch {
    math.targets = [];
    log("[provision] 수학 발송 경로를 읽지 못해 오늘은 수학 1인 보드 준비를 건너뜀");
    return;
  }
  if (route !== "class") return;
  const verified = await loadVerifiedChildren(sql, tenant);
  if (!verified) {
    math.targets = [];
    log("[provision] 반 보드 확인 기록을 읽지 못해 오늘은 수학 1인 보드 준비를 건너뜀");
    return;
  }
  const before = math.targets.length;
  math.targets = dropVerifiedTargets(math.targets, verified);
  if (before !== math.targets.length) log(`[provision] 반 보드에서 확인된 수학 학생 ${before - math.targets.length}명은 1인 보드 준비 제외(반별 발송)`);
}

/**
 * 일일 1회 실행(가드 내장) — 데몬이 매 폴 불러도 대부분 즉시 no-op. force=true는 가드 무시(수동 점검용).
 * 반환: { ran, created?, assigned?, held?, remaining? }.
 *
 * 지금 동기화(0313a, 원장 2026-09-30 *"필요한것만 동기화하게"*) 옵션:
 * - `studentIds` = 이 학생들만 본다(보드 생성·배정 대상). 동명이인·역방향 판정은 그대로 **전 학생 우주**로 한다.
 * - `maxWrites` = 보드 생성 + 배정 합계 상한 — 넘으면 멈추고 `remaining`으로 남긴다(새벽 정기 실행이 마저 한다).
 * 🔴 force 실행은 오늘 표식을 남기지 않는다 — 일부만 본 수동 실행이 새벽 전체 실행을 건너뛰게 하면 안 된다.
 */
export async function provisionDailyOnce(sql, browser, { tenant, post, log = console.log, force = false, studentIds = null, maxWrites = Infinity }) {
  const today = kstDate();
  if (!force) {
    if (!post) return { ran: false };
    if (kstHour() < RUN_AFTER_HOUR_KST) return { ran: false };
    if (lastRun() === today) return { ran: false };
  }

  // 발송 opt-in 과목 → 보드 그룹(교집합 키만 — 발송 게이트와 동일 기준)
  const [row] = await sql`select data->'report'->'classnoteSubjects' as subs
    from tenant_settings where tenant_id=${tenant}`;
  const optIn = Array.isArray(row?.subs) ? row.subs : [];
  const groups = Object.values(BOARD_GROUPS)
    .map((g) => ({ ...g, keys: g.subjectKeys.filter((k) => optIn.includes(k)) }))
    .filter((g) => g.keys.length);
  if (!groups.length) {
    if (!force) markRun(today);
    log("[provision] 발송 허용 과목 없음 — 건너뜀");
    return { ran: true, created: 0, assigned: 0 };
  }

  // 기대 보드(aywa DB만) — ClassNote 로그인 **전에** 계산한다. 결과는 로그인 뒤에 계산하던 것과 같다(ClassNote 값을 안 쓴다).
  const plans = [];
  const held = [];
  for (const g of groups) {
    const { targets: all, collisions } = await expectedFor(sql, tenant, g.keys, g.prefix);
    // 지금 동기화 범위 — 동명이인(collisions)은 애초에 targets에 없으므로 거르기만 해도 동명이인 방어는 그대로다.
    const only = studentIds ? new Set(studentIds) : null;
    const targets = only ? all.filter((t) => only.has(t.studentId)) : all;
    plans.push({ group: g, targets });
    if (!only) for (const c of collisions) held.push(`${g.prefix}${c.name}(동명이인 ${c.count}명)`);
  }
  await dropRetiredMathTargets(sql, tenant, plans, log);
  // 지금 동기화(범위 지정)인데 대상이 하나도 없다(발송 과목이 아닌 학생뿐 등) — ClassNote에 로그인조차 하지 않는다(과부하 방지).
  if (studentIds && !plans.some((p) => p.targets.length)) {
    log("[provision] 지금 동기화 — 1인 보드 준비 대상 없음(ClassNote 조회 안 함)");
    return { ran: true, created: 0, assigned: 0, held: 0, remaining: 0 };
  }

  const page = await browser.newPage();
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    let boardByNorm = new Map((await fetchBoards(page, centerId)).map((b) => [norm(b.name), b]));
    const children = await fetchChildren(page, centerId);

    // ① 누락 보드 생성(DOM) — 있을 때만 반 정보 관리 진입
    let created = 0;
    let writes = 0; // 보드 생성 + 배정(maxWrites 상한)
    let remaining = 0;
    const missing = plans.flatMap((p) => p.targets.filter((t) => !boardByNorm.has(norm(t.board))));
    if (missing.length) {
      await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
      await dismissHonorificDialog(page);
      for (const m of missing) {
        if (writes >= maxWrites) {
          remaining++;
          continue;
        }
        writes++;
        const res = await createBoard(page, m.board);
        log(`[provision] 보드 생성 ${m.board} → ${res.ok ? "✅" : `❌ ${res.reason}`}`);
        if (res.ok) created++;
        await page.waitForTimeout(900);
      }
      // 생성분 반영해 보드 목록 재조회(배정 단계에서 새 보드 id 필요)
      boardByNorm = new Map((await fetchBoards(page, centerId)).map((b) => [norm(b.name), b]));
    }

    // ② 가입됐는데 자기 보드가 빈 학생 → 자동 배정(원아 ID 기반). 방어 4겹(2026-07-13 적대 감사 반영):
    //   ⓐ 양방향 유일성 — 원아가 DB 전체(퇴원·타과목 포함) 동명 학생 2+에 걸리면 보류(F1·F2·F3)
    //   ⓑ 잔존 가족 직격 가드 — 원아가 이미 다른 학생의 개인 보드 소속이면 보류(F1 보조)
    //   ⓒ POST 직전 보드 실시간 재확인 — 스냅샷 이후 진짜 가족이 합류했으면 중단(F5)
    //   ⓓ POST 직후 인원 검증 — 2명 이상이면 경보(해제 API 불가라 사후 탐지 필수)
    let assigned = 0;
    const allTargets = plans.flatMap((p) => p.targets);
    const universeNames = await fetchUniverseNames(sql, tenant);
    const { matches, held: matchHeld } = planChildMatches(allTargets, children, universeNames);
    for (const h of matchHeld) held.push(`${h.board}(${h.reason})`);
    for (const t of allTargets) {
      const board = boardByNorm.get(norm(t.board));
      if (!board || board.children >= 1) continue; // 빈 보드만 — 이미 배정된 보드는 절대 안 건드림
      const child = matches.get(t.board);
      if (!child) continue; // 미가입(초대 대기) 또는 모호 보류
      const detail = await fetchChildDetail(page, child.id);
      if ((detail.enrollment ?? []).some((e) => e.belong_to_class === board.id && !e.removed_child)) continue;
      if (hasForeignStudentBoard(detail.enrollment, t.student)) {
        held.push(`${t.board}(원아가 다른 학생 개인 보드에 이미 소속 — 잔존 가족 의심)`);
        continue;
      }
      const live = await fetchBoardChildren(page, centerId, board.id).catch(() => null);
      if (live === null || live.length > 0) {
        if (live?.length) log(`[provision] ${t.board} — 실행 중 다른 원아 합류 감지, 배정 중단`);
        continue;
      }
      if (writes >= maxWrites) {
        remaining++;
        continue;
      }
      writes++;
      const res = await enrollChild(page, child.id, board.id);
      log(`[provision] 배정 ${t.board} → ${res.status < 300 ? "✅" : `❌ HTTP ${res.status}`}`);
      if (res.status < 300) {
        assigned++;
        const after = await fetchBoardChildren(page, centerId, board.id).catch(() => []);
        if (after.length > 1) log(`[provision] ⚠️ 경보: ${t.board} 인원 ${after.length}명 — 수동 확인 필요(기관설정>반)`);
      }
    }

    if (!force) markRun(today);
    if (held.length) log(`[provision] 자동 처리 보류: ${held.join(", ")}`);
    if (remaining) log(`[provision] 상한(${maxWrites}건)에 걸려 ${remaining}건은 다음 동기화로 넘김`);
    return { ran: true, created, assigned, held: held.length, remaining };
  } finally {
    await page.close().catch(() => {});
  }
}
