/**
 * ClassNote **반 보드 구성** 스냅샷 — 하루 1회(0142a). 워커 전용 IO.
 *
 * 왜 워커인가: ClassNote 조회엔 Playwright 세션이 필요하고 자격증명은 연동 PC에만 있다.
 * 화면(서버 컴포넌트)은 브라우저를 못 띄우므로 **여기서 적재하고 화면은 DB만 읽는다**(0140a와 같은 구조).
 *
 * 무엇을 담나: **반 보드만** — 보드명이 `(수학)`·`(영어)`로 시작하지 않는 것(실측 654개 중 128개).
 * 1인 보드 526개는 provision/assign이 이미 담당하고, 전건을 매일 훑으면 요청이 5배가 된다.
 *
 * ⚠️ 읽기 전용이다 — GET만 한다. 배정·생성·발송은 **하지 않는다**(그건 provision/queue의 일).
 * ⚠️ 판정(누가 빠졌나)은 여기서 하지 않는다. 원본만 적재하고 대조는 앱의 순수 함수
 *    (src/features/report-admin/board-roster-diff.ts)가 한다 — 규칙이 바뀌어도 재계산이 되게.
 */
import { stateFile } from "./classnote-paths.mjs";
import { loginClassnote, fetchCenterId, fetchBoards, fetchBoardChildren } from "./classnote-admin-core.mjs";

const STATE_FILE = stateFile("board-roster-last-run.txt");
const RUN_AFTER_HOUR_KST = 5; // 새벽 5시 이후(수업 전에 최신화, 야간 소음 회피)
/**
 * 1인 보드 = `(수학)홍길동`·`(영어)홍길동` 규약(앱 BOARD_PREFIX와 짝). 스냅샷에서 제외한다.
 * ⚠️ 일부러 **과목명을 명시**한다 — `[^)]+`처럼 넓게 잡으면 `(초등) …` 같은 반 보드까지 조용히 빠진다.
 *    새 과목 보드가 생기면 그건 스냅샷에 들어오고(느려질 뿐 틀리진 않음) 아래 상한 로그가 알려 준다.
 */
const ONE_PERSON_BOARD = /^\(\s*(수학|영어)\s*\)/;
/** 폭주 방어 — 반 보드가 이 수를 넘으면 규약이 깨진 것이니 스냅샷을 접고 로그로 알린다. */
const MAX_BOARDS = 400;

let memoryLastRun = ""; // 상태 폴더가 없을 때의 폴백(워커 상태폴더 사망 사례 대비)

function kstDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
function kstHour() {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()));
}
async function lastRun() {
  if (memoryLastRun) return memoryLastRun;
  if (!STATE_FILE) return "";
  try {
    const fs = await import("node:fs");
    return fs.readFileSync(STATE_FILE, "utf8").trim();
  } catch {
    return "";
  }
}
async function markRun(d) {
  memoryLastRun = d;
  if (!STATE_FILE) return;
  try {
    const fs = await import("node:fs");
    fs.writeFileSync(STATE_FILE, d);
  } catch {
    /* 파일 못 써도 메모리 폴백으로 하루 1회는 지켜진다 */
  }
}

/** `2014-02-05` → 2014. 없거나 이상하면 null(0으로 뭉개면 "모름"과 "0년생"이 섞인다). */
function birthYearOf(v) {
  const y = Number(String(v ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1900 && y < 2100 ? y : null;
}

/**
 * 하루 1회 실행(가드 내장) — 데몬이 매 폴 불러도 대부분 즉시 no-op.
 * @returns {{ran:boolean, boards?:number, members?:number, skipped?:number}}
 */
export async function snapshotBoardRosterOnce(sql, browser, { tenant, log = console.log, force = false } = {}) {
  const today = kstDate();
  if (!force) {
    if (kstHour() < RUN_AFTER_HOUR_KST) return { ran: false };
    if ((await lastRun()) === today) return { ran: false };
  }

  const page = await browser.newPage();
  const startedAt = new Date();
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    const all = await fetchBoards(page, centerId);
    const classBoards = all.filter((b) => b.name && !ONE_PERSON_BOARD.test(b.name));
    if (classBoards.length > MAX_BOARDS) {
      log(`[roster] 반 보드가 ${classBoards.length}개 — 상한(${MAX_BOARDS}) 초과라 스냅샷 생략(보드 명명 규약 확인 필요)`);
      await markRun(today);
      return { ran: true, boards: 0, members: 0, skipped: classBoards.length };
    }

    let members = 0;
    for (const b of classBoards) {
      // ⚠️ 한 보드가 실패해도 전체를 접지 않는다 — 나머지 스냅샷은 여전히 쓸모 있다.
      let kids;
      try {
        kids = await fetchBoardChildren(page, centerId, b.id);
      } catch (e) {
        log(`[roster] 보드 "${b.name}" 원아 조회 실패 — ${e.message}`);
        continue;
      }
      await sql`
        insert into classnote_boards (tenant_id, board_id, board_name, child_count, synced_at)
        values (${tenant}, ${b.id}, ${b.name}, ${b.children ?? null}, ${startedAt})
        on conflict (tenant_id, board_id)
        do update set board_name = excluded.board_name, child_count = excluded.child_count, synced_at = excluded.synced_at`;
      for (const k of kids) {
        await sql`
          insert into classnote_board_members (tenant_id, board_id, child_id, child_name, birth_year, synced_at)
          values (${tenant}, ${b.id}, ${k.id}, ${(k.name || "").trim()}, ${birthYearOf(k.date_birth)}, ${startedAt})
          on conflict (tenant_id, board_id, child_id)
          do update set child_name = excluded.child_name, birth_year = excluded.birth_year, synced_at = excluded.synced_at`;
      }
      members += kids.length;
    }

    // 이번 회차에 못 본 행 = ClassNote에서 사라진 보드·원아 → 지운다.
    // ⚠️ 전건 조회에 성공한 뒤에만 지운다(위에서 throw 나면 여기 못 옴) — 조회 실패 때 지우면 화면이 "전부 미배정"이 된다.
    await sql`delete from classnote_board_members where tenant_id=${tenant} and synced_at < ${startedAt}`;
    await sql`delete from classnote_boards where tenant_id=${tenant} and synced_at < ${startedAt}`;

    await markRun(today);
    log(`[roster] 반 보드 스냅샷 ${classBoards.length}개 · 원아 ${members}명`);
    return { ran: true, boards: classBoards.length, members };
  } finally {
    await page.close().catch(() => {});
  }
}
