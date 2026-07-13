/**
 * scripts/_classnote/classnote-provision-core.mjs — 일일 보드 프로비저닝 + 자동 배정(데몬 호출용).
 *
 * 신규생 흐름 자동화: 매일 KST 05시 이후 첫 폴에서 1회 —
 *   ① 재원 + 발송 opt-in 과목 활성 수강인데 보드 없는 학생 → `(과목)이름` 빈 보드 생성(DOM)
 *   ② 학부모 가입까지 됐는데 자기 보드가 비어있는 학생 → 배정(POST /api/v1/enrollments/, ID 기반)
 * 동명이인(eywa 유효이름 중복·ClassNote 동명 원아)은 자동 처리 안 하고 로그로 보류 — 오발송 방지.
 * 학부모 초대(가입)만 사람 몫으로 남는다. 수동 실행판 = provision/assign-classnote-*.mjs (동일 기준).
 *
 * 실행 조건: 데몬 --post 모드에서만(dry-run 데몬은 아무것도 안 만짐). 발송 스위치(classnoteSendEnabled)와는
 * 무관 — 보드·배정은 발송이 아니라 인프라 준비(스위치 OFF 기간에도 신규생 보드가 미리 쌓이도록).
 * ⚠️ 배정 시 ClassNote가 학부모 앱에 반 배정 알림을 보낼 수 있음(정상 온보딩 절차).
 * 하루 1회 마커 = 로컬 파일(CLASSNOTE_OUT/provision-last-run.txt) — PC 재설정 시 재실행돼도 diff 기반이라 멱등.
 */
import fs from "node:fs";
import path from "node:path";
import {
  BOARD_GROUPS,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  fetchChildren,
  fetchChildDetail,
  enrollChild,
  createBoard,
  childKeys,
  norm,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";

const STATE_DIR = process.env.CLASSNOTE_OUT || "D:/tmp/classnote";
const STATE_FILE = path.join(STATE_DIR, "provision-last-run.txt");
const RUN_AFTER_HOUR_KST = 5; // 새벽 5시 이후(수업 전 준비 완료, 야간 소음 회피)

function kstDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
function kstHour() {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()),
  );
}
function lastRun() {
  try {
    return fs.readFileSync(STATE_FILE, "utf8").trim();
  } catch {
    return "";
  }
}
function markRun(d) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, d);
  } catch {
    /* 마커 실패가 데몬을 죽이면 안 됨 — 최악은 다음 폴 재시도(멱등) */
  }
}

/** 그룹별 기대 보드 — 재원 + 활성 수강(subjectKeys ∩ opt-in). 동명이인은 collisions로 분리. */
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
    if (!byName.has(eff)) byName.set(eff, []);
    byName.get(eff).push(r);
  }
  const targets = [];
  const collisions = [];
  for (const [eff, students] of byName) {
    if (students.length > 1) collisions.push({ name: eff, count: students.length });
    else targets.push({ student: eff, board: `${prefix}${eff}` });
  }
  return { targets, collisions };
}

/**
 * 일일 1회 실행(가드 내장) — 데몬이 매 폴 불러도 대부분 즉시 no-op. force=true는 가드 무시(수동 점검용).
 * 반환: { ran, created?, assigned?, held? }.
 */
export async function provisionDailyOnce(sql, browser, { tenant, post, log = console.log, force = false }) {
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
    markRun(today);
    log("[provision] 발송 허용 과목 없음 — 건너뜀");
    return { ran: true, created: 0, assigned: 0 };
  }

  const page = await browser.newPage();
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    let boardByNorm = new Map((await fetchBoards(page, centerId)).map((b) => [norm(b.name), b]));
    const children = await fetchChildren(page, centerId);

    const plans = [];
    const held = [];
    for (const g of groups) {
      const { targets, collisions } = await expectedFor(sql, tenant, g.keys, g.prefix);
      plans.push({ group: g, targets });
      for (const c of collisions) held.push(`${g.prefix}${c.name}(동명이인 ${c.count}명)`);
    }

    // ① 누락 보드 생성(DOM) — 있을 때만 반 정보 관리 진입
    let created = 0;
    const missing = plans.flatMap((p) => p.targets.filter((t) => !boardByNorm.has(norm(t.board))));
    if (missing.length) {
      await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
      await dismissHonorificDialog(page);
      for (const m of missing) {
        const res = await createBoard(page, m.board);
        log(`[provision] 보드 생성 ${m.board} → ${res.ok ? "✅" : `❌ ${res.reason}`}`);
        if (res.ok) created++;
        await page.waitForTimeout(900);
      }
      // 생성분 반영해 보드 목록 재조회(배정 단계에서 새 보드 id 필요)
      boardByNorm = new Map((await fetchBoards(page, centerId)).map((b) => [norm(b.name), b]));
    }

    // ② 가입됐는데 자기 보드가 빈 학생 → 자동 배정(원아 ID 기반, 동명 원아는 보류)
    let assigned = 0;
    for (const p of plans) {
      for (const t of p.targets) {
        const board = boardByNorm.get(norm(t.board));
        if (!board || board.children >= 1) continue;
        const clean = t.student.replace(/[a-zA-Z]/g, "").trim();
        const cands = children.filter((c) => {
          const keys = childKeys(c.name);
          return keys.has(t.student) || keys.has(clean);
        });
        if (cands.length !== 1) {
          if (cands.length > 1) held.push(`${t.board}(동명 원아 ${cands.length}명 — 생일 대조 필요)`);
          continue; // 0명 = 미가입(초대 대기) — 정상, 보류 아님
        }
        const detail = await fetchChildDetail(page, cands[0].id);
        if ((detail.enrollment ?? []).some((e) => e.belong_to_class === board.id && !e.removed_child)) continue;
        const res = await enrollChild(page, cands[0].id, board.id);
        log(`[provision] 배정 ${t.board} → ${res.status < 300 ? "✅" : `❌ HTTP ${res.status}`}`);
        if (res.status < 300) assigned++;
      }
    }

    markRun(today);
    if (held.length) log(`[provision] 자동 처리 보류: ${held.join(", ")}`);
    return { ran: true, created, assigned, held: held.length };
  } finally {
    await page.close().catch(() => {});
  }
}
