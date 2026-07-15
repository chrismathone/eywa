/**
 * scripts/_classnote/classnote-feed-core.mjs — ClassNote 학부모 **새 글** → 담당 강사 eywa 인앱 알림(인바운드).
 *
 * 배경(2026-07-15 실측): 학부모가 ClassNote에 "오늘 늦어요 / 아파서 쉬어요"를 남겨도 강사가 ClassNote 앱을
 * 안 보면 그냥 묻힌다. 실제로 수학 1인보드 학부모 글 8건 중 3건이 무응답이었고(강사별 편차 — 어떤 강사는 5/5 응답,
 * 어떤 강사는 0/2), 그중 하나는 보드에 **퇴직 강사가 연결**돼 있었다. 그래서 강사가 매일 보는 eywa 화면(알림 벨)에
 * 띄운다. eywa 매핑이 ClassNote 보드 연결보다 정확하다(퇴직자 배제 + 현직 담당 전원).
 *
 * 파이프라인: 데몬(watch-classnote-queue.mjs)이 매 폴 호출 → 60초 가드 → 기관 전체 피드 **요청 1개** →
 *   author.type==="parent" ∧ 워터마크 초과 ∧ `(수학)` 보드 → 보드명으로 eywa 학생 확정 → 담당 수학 강사 →
 *   notifications insert + 워터마크 전진(**같은 트랜잭션** = 크래시 시 중복 알림 없음).
 *
 * 매핑이 보드명 기준인 이유: 피드 행의 `child_name`은 **학부모가 등록한 원아명**이라 제멋대로다
 * (실측: 보드 `(수학)박서연E`의 원아명이 그냥 "서연"). 반면 보드명은 **우리가 eywa 유효이름으로 만든 것**이라
 * 동명이인 접미사(A~G)까지 정확하다 — 애초에 1인 보드 구조가 그러라고 있는 것. 그래서 발송(provision)과
 * **완전히 같은 기준**(expectedFor: 재원 + 활성 수강 + 동명이인 자동 보류)으로 보드명→학생을 확정한다.
 * 실검증: 수학 학부모 글 8/8 매핑, 보류 0.
 *
 * 안전장치:
 *  - **읽기 전용**(GET) — ClassNote에 아무것도 쓰지 않는다. 구조상 학부모에게 나가는 경로 자체가 없다.
 *  - 콜드 스타트(워터마크 없음) = 현재 최대 id만 기록하고 **알림 0건**(과거 글 폭탄 방지).
 *  - age 가드(기본 3일) — PC가 오래 꺼졌다 켜져도 밀린 과거 글로 벨이 도배되지 않는다.
 *  - `--post` 데몬에서만 동작(dry-run 데몬 2대가 같이 돌아도 중복 알림 없음). 발송 킬스위치
 *    (classnoteSendEnabled)는 **따르지 않는다** — 이건 발송이 아니라 인바운드 감지다(provision-core와 같은 논리).
 */
import {
  BOARD_GROUPS,
  fetchCenterId,
  loginClassnote,
  norm,
} from "./classnote-admin-core.mjs";
import {
  buildNotificationText,
  maxPostId,
  reachedWatermark,
  selectNewParentPosts,
} from "./parent-post-filter.mjs";

const SCOPE = "parent_posts";
const POLL_INTERVAL_MS = 60_000; // 데몬 폴은 15초 — 피드는 1분에 1번이면 "즉시"에 충분
const PAGE_SIZE = 100;
const MAX_PAGES = 5; // 워터마크까지 거슬러 올라갈 상한(피드 ~140건/일이라 평소 1페이지로 끝)
const MAX_AGE_DAYS = 3;

let lastRunAt = 0; // 모듈 스코프 인메모리 가드 — 재시작 시 즉시 1회 실행은 정상(워터마크가 중복을 막음)

/**
 * 로그인된 페이지를 **폴 사이에 유지**한다 — 이게 이 코어의 핵심 비용 설계.
 *
 * ⚠️ 다른 코어(queue·notice·provision)는 **할 일이 있을 때만** 로그인하지만, 피드 폴러는 할 일이 없어도
 * 1분마다 돈다. 매번 `browser.newPage()`(= 새 컨텍스트 = 쿠키 없음) + 로그인하면 **하루 1,440회 로그인**이 되어
 * 봇 계정이 스로틀/차단당한다(2026-07-15 실측: 짧은 시간에 로그인을 반복하자 로그인 자체가 실패).
 * → 페이지 하나를 살려두고 **폴마다 same-origin fetch 1번만** 한다(내비게이션 0). 세션이 죽으면 1회 재로그인.
 */
let cached = null; // { browser, page, centerId }

async function getFeedPage(browser) {
  if (cached && cached.browser === browser && !cached.page.isClosed()) return cached;
  await dropFeedPage();
  const page = await browser.newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  cached = { browser, page, centerId };
  return cached;
}

async function dropFeedPage() {
  const c = cached;
  cached = null;
  if (c) await c.page.close().catch(() => {});
}

/** 기관 전체 피드 1페이지 — cursor는 DRF next 토큰(base64 "p=<id>"), 쿼리 파라미터명은 `page`. */
async function fetchFeedPage(page, centerId, cursor) {
  return page.evaluate(
    async ([c, cur, size]) => {
      const qs = new URLSearchParams({ page_size: String(size), tz: "Asia/Seoul", center_id: String(c) });
      if (cur) qs.set("page", cur);
      const r = await fetch(`/api/v1_2/centers/${c}/reports/?${qs}`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`피드 조회 실패 HTTP ${r.status}`);
      const j = await r.json();
      return { list: j?.results ?? [], next: j?.next ?? null };
    },
    [centerId, cursor, PAGE_SIZE],
  );
}

/** 워터마크에 닿을 때까지(또는 상한까지) 피드를 거슬러 수집. 평소엔 1페이지. */
async function collectFeed(page, centerId, lastSeenId, log) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { list, next } = await fetchFeedPage(page, centerId, cursor);
    all.push(...list);
    if (!list.length || !next) return all;
    if (reachedWatermark(list, lastSeenId)) return all;
    cursor = next;
  }
  log(`[feed] ⚠️ ${MAX_PAGES}페이지(${all.length}건)까지 봤는데 워터마크 미도달 — 더 과거 글은 건너뜁니다`);
  return all;
}

/** 유지된 세션으로 피드 조회. 세션 만료·페이지 사망이면 **1회만** 재로그인 후 재시도. */
async function fetchFeedSince(browser, lastSeenId, log) {
  for (let attempt = 0; ; attempt++) {
    const { page, centerId } = await getFeedPage(browser);
    try {
      return await collectFeed(page, centerId, lastSeenId, log);
    } catch (e) {
      await dropFeedPage();
      if (attempt >= 1) throw e;
      log(`[feed] 세션 재수립 후 재시도: ${e.message}`);
    }
  }
}

/**
 * 기대 보드 → 학생 — provision의 expectedFor와 **동일 쿼리·동일 그룹핑**(재원 + 활성 수강, 동명이인 보류).
 * ⚠️ 여기 조건을 바꾸면 발송과 기준이 갈라진다. 바꾸려면 provision-core도 같이.
 */
async function boardsToStudents(sql, tenant, keys, prefix) {
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
  const board = new Map();
  const collisions = [];
  for (const [, students] of byName) {
    if (students.length > 1) {
      collisions.push(`${prefix}${students[0].eff}(동명이인 ${students.length}명)`);
      continue; // 신원 불명 → 알림 보류(엉뚱한 강사에게 남의 집 얘기가 가면 안 됨)
    }
    board.set(norm(`${prefix}${students[0].eff}`), { id: students[0].id, name: students[0].eff });
  }
  return { board, collisions };
}

/** 학생 → 담당 강사(활성 직원 · 활성 반 · 해당 과목). 학생 1명이 여러 반이면 강사 전원. */
async function teachersFor(sql, tenant, studentIds, keys) {
  if (!studentIds.length) return new Map();
  const rows = await sql`
    select distinct e.student_id, c.teacher_id
    from enrollments e
    join classes c on c.id = e.class_id and c.tenant_id = ${tenant} and c.is_active
    join users u on u.id = c.teacher_id and u.tenant_id = ${tenant} and u.status = 'active'
    where e.tenant_id = ${tenant}
      and e.end_date is null
      and e.student_id = any(${studentIds})
      and c.subject in ${sql(keys)}`;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.student_id)) map.set(r.student_id, []);
    map.get(r.student_id).push(r.teacher_id);
  }
  return map;
}

/**
 * 한 주기 — 학부모 새 글 감지 → 담당 강사 알림. 데몬이 매 폴 부르지만 대부분 즉시 no-op(60초 가드).
 * @param {object} opts - { tenant, post, log, force, dryRun }
 *   dryRun=true면 감지·매핑까지만 하고 **insert도 워터마크 전진도 안 함**(점검용 one-shot).
 * @returns {Promise<{ran:boolean, detected?:number, notified?:number, held?:number, tooOld?:number, plan?:Array}>}
 */
export async function pollParentPostsOnce(sql, browser, { tenant, post, log = console.log, force = false, dryRun = false }) {
  if (!force) {
    if (!post) return { ran: false };
    if (Date.now() - lastRunAt < POLL_INTERVAL_MS) return { ran: false };
  }
  lastRunAt = Date.now();

  // 대상 = 수학 보드 그룹. 발송 opt-in(classnoteSubjects)에 **묶지 않는다** — 인바운드 감지는 발송이 아니고,
  // 보드가 있는 학생의 학부모 글은 발송 스위치와 무관하게 강사가 알아야 한다.
  const group = BOARD_GROUPS.math;
  const keys = group.subjectKeys;

  const [state] = await sql`
    select last_seen_post_id from classnote_feed_state
    where tenant_id = ${tenant} and scope = ${SCOPE}`;
  const lastSeenId = state?.last_seen_post_id == null ? null : Number(state.last_seen_post_id);

  try {
    const rows = await fetchFeedSince(browser, lastSeenId, log);
    const watermark = maxPostId(rows);
    if (watermark === null) return { ran: true, detected: 0, notified: 0 };

    // 콜드 스타트 — 과거 글 전체를 알림으로 쏟지 않는다. 현재 위치만 기록하고 다음 폴부터 진짜 새 글만.
    if (lastSeenId === null) {
      if (!dryRun) await saveWatermark(sql, tenant, watermark);
      log(`[feed] 첫 실행 — 워터마크 ${watermark}로 초기화(과거 글은 알리지 않음)`);
      return { ran: true, detected: 0, notified: 0 };
    }

    const { picked, tooOld } = selectNewParentPosts(rows, {
      lastSeenId,
      prefix: group.prefix,
      maxAgeDays: MAX_AGE_DAYS,
    });
    if (tooOld.length) log(`[feed] ${MAX_AGE_DAYS}일 지난 학부모 글 ${tooOld.length}건 건너뜀(밀린 알림 폭주 방지)`);
    if (!picked.length) {
      if (!dryRun && watermark > lastSeenId) await saveWatermark(sql, tenant, watermark);
      return { ran: true, detected: 0, notified: 0, tooOld: tooOld.length };
    }

    const { board, collisions } = await boardsToStudents(sql, tenant, keys, group.prefix);
    const hits = [];
    const held = [];
    for (const p of picked) {
      const s = board.get(norm(p.class_name));
      if (!s) {
        held.push(`${p.class_name}(재원·수강 아님 또는 동명이인 보류)`);
        continue;
      }
      hits.push({ post: p, student: s });
    }
    const byTeacher = await teachersFor(sql, tenant, [...new Set(hits.map((h) => h.student.id))], keys);

    const plan = [];
    for (const h of hits) {
      const teachers = byTeacher.get(h.student.id) ?? [];
      if (!teachers.length) {
        held.push(`${h.post.class_name}(활성 담당 강사 없음)`);
        continue;
      }
      const { title, body } = buildNotificationText(h.post, h.student.name);
      for (const t of teachers) {
        plan.push({
          tenant_id: tenant,
          recipient_id: t,
          type: "classnote_parent_post",
          title,
          body,
          link: `/students/${h.student.id}`,
        });
      }
    }

    if (dryRun) {
      log(`[feed] (점검) 새 학부모 글 ${picked.length}건 → 알림 ${plan.length}건 예정 · 보류 ${held.length}건`);
      for (const h of held) log(`[feed]   보류: ${h}`);
      if (collisions.length) log(`[feed]   동명이인 보드(전역 보류): ${collisions.length}건`);
      return { ran: true, detected: picked.length, notified: 0, held: held.length, tooOld: tooOld.length, plan };
    }

    // 알림 insert와 워터마크 전진을 **한 트랜잭션**으로 — 중간에 죽어도 같은 글을 두 번 알리지 않는다.
    await sql.begin(async (tx) => {
      if (plan.length) {
        await tx`insert into notifications ${tx(plan, "tenant_id", "recipient_id", "type", "title", "body", "link")}`;
      }
      await saveWatermark(tx, tenant, watermark);
    });

    log(`[feed] 학부모 새 글 ${picked.length}건 감지 → 강사 알림 ${plan.length}건${held.length ? ` · 보류 ${held.length}건` : ""}`);
    for (const h of held) log(`[feed]   보류: ${h}`);
    return { ran: true, detected: picked.length, notified: plan.length, held: held.length, tooOld: tooOld.length };
  } catch (e) {
    await dropFeedPage(); // 다음 폴은 깨끗한 세션으로
    throw e;
  }
}

async function saveWatermark(sql, tenant, id) {
  await sql`
    insert into classnote_feed_state (tenant_id, scope, last_seen_post_id, last_polled_at, status, error, updated_at)
    values (${tenant}, ${SCOPE}, ${id}, now(), 'ok', null, now())
    on conflict (tenant_id, scope) do update set
      last_seen_post_id = excluded.last_seen_post_id,
      last_polled_at = now(), status = 'ok', error = null, updated_at = now()`;
}
