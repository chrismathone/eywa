// scripts/_classnote/worker-lease.mjs — **실게시 워커는 지점당 한 대**(개명 감사 G6 2026-09-30).
//
// DB에 단일 워커 잠금이 없어 발송 PC 두 대가 같은 지점을 돌면 — 클레임은 SKIP LOCKED로 안 겹쳐도 — 게시 중인 행을
// 다른 PC가 stale로 되살려 다시 집거나, 반 보드 비상 정지가 한 PC에서만 켜지거나, 매일 동기화가 두 번 도는 틈이 있었다.
// 하트비트 표(0084a classnote_workers)를 임대(lease)로 쓴다 — 새 표·손 SQL 없이. 규칙:
//   ① 실게시 모드(--post)로 도는 PC만 센다(dry-run 개발 PC가 주인이 되어 진짜 워커를 막지 않게).
//   ② 살아 있음 = **DB 시계로** 최근 LEASE_SECONDS 안에 하트비트(PC 시계가 틀려도 판정이 안 갈린다).
//      하트비트는 폴과 별도로 LEASE_REFRESH_MS마다 갱신한다 — 매일 동기화처럼 한 폴이 몇 분 걸려도 자리를 안 잃는다.
//   ③ 살아 있는 PC 중 **먼저 시작한 PC**(started_at, 같으면 hostname 순)가 주인 — 모든 PC가 같은 표를 보고 같은 답을 낸다.
//   ④ 같은 PC에서 워커를 두 번 띄우면(표 행이 hostname 하나라 ③으로 못 가른다) 잠금 파일로 뒤에 띄운 쪽이 쉰다.
// 🔴 옛 워커(이 표식 없음)는 세지 않는다 — 옛 zip과 섞여 돌면 막지 못한다(안내문에 "한 대만"을 적는다).
import fs from "node:fs";

export const LEASE_SECONDS = 180;
export const LEASE_REFRESH_MS = 30_000;

/**
 * @param {{ rows: Array<{hostname:string, started_at:string|Date, alive:boolean, post_mode?:boolean|null}>, me: string }} a
 *   alive = DB가 계산한 `now() - last_seen <= LEASE_SECONDS`
 * @returns {{ owner: boolean, holder: string|null }}
 */
export function decideWorkerLease({ rows, me }) {
  const t = (v) => new Date(v).getTime();
  const live = (rows ?? [])
    .filter((r) => r.post_mode === true && r.alive === true)
    .sort((a, b) => t(a.started_at) - t(b.started_at) || String(a.hostname).localeCompare(String(b.hostname)));
  if (!live.length) return { owner: true, holder: null }; // 아무도 없다(내 하트비트 전) — 막지 않는다
  const holder = live[0].hostname;
  return { owner: holder === me, holder };
}

/** 살아 있는 프로세스인가(같은 PC 잠금 파일의 주인 확인). */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM"; // 권한만 없는 경우 = 살아 있다
  }
}

/**
 * 같은 PC 안 두 번째 워커 막기(④) — 잠금 파일에 pid를 적는다. 이미 **살아 있는 다른** pid가 쥐고 있으면 false.
 * 파일을 못 쓰는 환경(state 폴더 없음)이면 막지 않는다(true) — DB 임대가 PC 사이는 여전히 막는다.
 */
/** 잠금 파일이 이만큼 안 갱신되면 주인이 죽은 것으로 본다 — 주인은 30초마다 파일을 다시 쓴다(touchLocalWorkerLock). */
export const LOCAL_LOCK_STALE_MS = 180_000;

export function acquireLocalWorkerLock(file, pid = process.pid, nowMs = Date.now()) {
  if (!file) return true;
  try {
    const cur = Number(fs.readFileSync(file, "utf8").trim());
    // 🔴 pid만 보면 안 된다 — Windows는 pid를 재사용해서, 크래시·재부팅 뒤 **남의 프로세스(크롬 등)가 같은 pid**를
    //    받으면 "살아 있다"로 보여 워커가 영영 쉰다(발송 전면 중단). 그래서 파일이 최근에 갱신됐을 때만 주인으로 인정한다.
    const fresh = nowMs - fs.statSync(file).mtimeMs <= LOCAL_LOCK_STALE_MS;
    if (cur && cur !== pid && fresh && pidAlive(cur)) return false;
  } catch {
    /* 없음 = 비어 있음 */
  }
  try {
    fs.writeFileSync(file, String(pid));
  } catch {
    /* 못 쓰면 막지 않는다 */
  }
  return true;
}

/** 주인 워커가 살아 있다는 표시 — 잠금 파일의 수정 시각만 갱신한다(내 pid일 때만). */
export function touchLocalWorkerLock(file, pid = process.pid) {
  if (!file) return;
  try {
    if (Number(fs.readFileSync(file, "utf8").trim()) !== pid) return;
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {
    /* best-effort */
  }
}
