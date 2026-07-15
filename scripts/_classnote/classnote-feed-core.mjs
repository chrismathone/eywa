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
 * 동명이인 접미사(A~G)까지 정확하다 — 애초에 1인 보드 구조가 그러라고 있는 것. 대상 집합은 발송(provision)의
 * `expectedFor`와 같은 쿼리(재원 + 활성 수강)를 쓰되, **신원 유일성은 전 학생 우주**로 따로 본다
 * (`boardsToStudents` 주석의 F1 참조 — 퇴원 동명이인의 보드가 재원 동명에게 붙는 사고를 막는다).
 *
 * 안전장치:
 *  - **읽기 전용**(GET) — ClassNote에 아무것도 쓰지 않는다. 구조상 학부모에게 나가는 경로 자체가 없다.
 *  - 콜드 스타트(워터마크 없음) = 현재 최대 id만 기록하고 **알림 0건**(과거 글 폭탄 방지).
 *  - age 가드(기본 3일) — PC가 오래 꺼졌다 켜져도 밀린 과거 글로 벨이 도배되지 않는다.
 *  - `--post` 데몬에서만 동작(dry-run 데몬 2대가 같이 돌아도 중복 알림 없음). 발송 킬스위치
 *    (classnoteSendEnabled)는 **따르지 않는다** — 이건 발송이 아니라 인바운드 감지다(provision-core와 같은 논리).
 */
import { boardNameAmbiguity, evaluateBoardSafety, kstSchoolYear } from "./board-safety.mjs";
import { getClassnoteBoardAllowlist } from "./classnote-core.mjs";
import {
  BOARD_GROUPS,
  fetchBoardChildren,
  fetchBoards,
  fetchCenterId,
  loginClassnote,
  norm,
} from "./classnote-admin-core.mjs";
import {
  buildNotificationText,
  classnotePostUrl,
  countByEffectiveName,
  maxPostId,
  pageOlderThanAgeGuard,
  reachedWatermark,
  selectNewParentPosts,
} from "./parent-post-filter.mjs";

const SCOPE = "parent_posts";
const POLL_INTERVAL_MS = 60_000; // 데몬 폴은 15초 — 피드는 1분에 1번이면 "즉시"에 충분
const PAGE_SIZE = 100;
const MAX_AGE_DAYS = 3;
/**
 * 워터마크까지 거슬러 올라갈 **하드 백스톱**. 평소(1분 폴)엔 1페이지로 끝나고, 이 상한은 **따라잡기**
 * (연동 PC가 며칠 꺼졌다 켜진 경우)에만 의미가 있다.
 *
 * ⚠️ 5(=500행)였다가 10으로 올림 — "피드 ~140건/일"이라는 내 추정이 **틀렸다**(2026-07-15 실측:
 * 바쁜 날 **249~270건/일**. 07-13 270 · 07-14 249). 500행은 바쁜 이틀도 못 덮어서, age 가드(3일) 안에
 * 있는 글인데도 조용히 건너뛰었다(실측: 2일 전 글이 565번째 행 = 6페이지째라 상한 밖).
 * 따라잡기가 필요한 바로 그 순간에 못 따라잡는 셈. 3일 × 300건 = 900행 → 10페이지로 여유를 준다.
 *
 * 진짜 종료 조건은 아래 `collectFeed`의 **age 컷오프**다(그보다 오래된 글은 어차피 전부 tooOld라 볼 이유가 없다).
 * MAX_PAGES는 그 조건이 어떤 이유로든 안 걸릴 때를 위한 안전망일 뿐 — 정상 경로에서 여기까지 오면 안 된다.
 */
const MAX_PAGES = 10;

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
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    cached = { browser, page, centerId };
    return cached;
  } catch (e) {
    // ⚠️ 여기서 안 닫으면 그 page는 **영영 안 닫힌다** — cached에 못 들어갔으므로 dropFeedPage()도 못 찾는다.
    // 로그인 실패는 예외가 아니라 상시 시나리오다(위 스로틀 주석 참조 + 과거 CLASSNOTE_UPLOAD_PW 유실 사고).
    // 데몬은 실패해도 60초 뒤 재시도하므로 누수가 분당 1개씩 쌓여 공유 브라우저가 OOM → 발송·공지까지 같이 죽는다.
    // (형제 코어 provision-core:123·notice-core:273도 전부 newPage→try/finally close 패턴.)
    await page.close().catch(() => {});
    throw e;
  }
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

/**
 * 피드를 거슬러 수집 — 평소(1분 폴)엔 **1페이지**로 끝난다. 여러 페이지를 파는 건 따라잡기뿐.
 * 종료: ① 워터마크 도달(= 이미 본 구간) ② **age 가드보다 오래된 구간 진입**(그 아래는 어차피 전부 tooOld)
 * ③ 마지막 페이지 ④ MAX_PAGES 백스톱(여기까지 오면 비정상 — 경고).
 */
async function collectFeed(page, centerId, lastSeenId, log) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { list, next } = await fetchFeedPage(page, centerId, cursor);
    all.push(...list);
    if (!list.length || !next) return all;
    if (reachedWatermark(list, lastSeenId)) return all;
    if (pageOlderThanAgeGuard(list, { maxAgeDays: MAX_AGE_DAYS })) return all; // 더 파도 전부 버릴 글
    cursor = next;
  }
  // 여기 도달 = 3일치가 1,000행을 넘었다는 뜻(밀도 급증). 건너뛴 구간은 age 가드 안일 수 있으니 경고를 남긴다.
  log(`[feed] ⚠️ ${MAX_PAGES}페이지(${all.length}건)를 봤는데도 워터마크·age 컷오프 미도달 — 더 과거 글은 건너뜁니다`);
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
 * 동명이인 판정 우주 = **status·과목 무필터 전 학생**(퇴원·예비 포함) → 이름별 인원수.
 *
 * ⚠️ **재원생 안에서만 동명을 보면 안 된다(F1 구멍, 2026-07-15 적대리뷰가 프로덕션에서 실증)**:
 * ClassNote 보드는 학생 수명주기보다 오래 산다(원아 해제·보드 삭제 자동화 없음 — REST 405).
 * 그래서 **퇴원한 동명 학생의 보드에 그 가족이 그대로 붙어 있다.** 그 보드명을 재원 동명 학생에게
 * 유일 매핑하면 **퇴원 가족의 사적인 글이 엉뚱한 강사에게** 간다.
 * 실측(injaewon): `(수학)김채은` 보드의 원아 생년월일은 **퇴원 김채은(중1)** 것인데 재원 김채은은 고1로 딴 사람이고
 * 담당 강사도 안 겹친다. `(수학)김서윤`도 동일. 수학 재원 237명 중 4건(김서윤·김채은·김수아·이지호A).
 * provision은 `fetchUniverseNames`+`planChildMatches`로 이 F1을 이미 방어한다 — 이 코어가 그 층을 빠뜨렸었다.
 *
 * ⚠️ `fetchUniverseNames`를 그대로 재사용하면 **안 잡힌다** — 거긴 `Set`이라 **완전히 같은 이름 2명이 1개로 접힌다**
 * (그 함수는 "다른 이름끼리의 충돌"용). 여기선 반드시 **인원수를 센다.**
 */
async function duplicateNameCounts(sql, tenant) {
  const rows = await sql`select name, classnote_name from students where tenant_id = ${tenant}`;
  return countByEffectiveName(rows, norm); // 규칙 본체는 순수 모듈(Vitest) — 여기선 우주(전 학생)만 책임진다
}

/**
 * 보드명 → 학생.
 * - **대상 집합**(누구에게 보드가 있나) = provision `expectedFor`와 동일 쿼리(재원 + 활성 수강).
 * - **신원 유일성**(그 보드가 정말 이 학생 건가) = **전 학생 우주**(위 duplicateNameCounts) — expectedFor에는
 *   없는 층이다(provision은 planChildMatches가 담당). ⚠️ "provision과 완전히 같다"고 쓰지 말 것 — 두 층은 다르다.
 */
export async function boardsToStudents(sql, tenant, keys, prefix) {
  const [rows, dupCounts] = await Promise.all([
    sql`
      select distinct s.id, s.name, s.classnote_name, s.grade
      from students s
      join enrollments e on e.student_id = s.id and e.end_date is null and e.tenant_id = ${tenant}
      join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
      where s.tenant_id = ${tenant}
        and s.status = 'enrolled'
        and c.subject in ${sql(keys)}`,
    duplicateNameCounts(sql, tenant),
  ]);
  const board = new Map();
  const collisions = [];
  for (const r of rows) {
    const eff = (r.classnote_name || r.name || "").trim();
    if (!eff) continue;
    const key = norm(eff);
    const dup = dupCounts.get(key) ?? 1;
    if (dup > 1) {
      // 신원 불명(퇴원·타과목·예비 동명 포함) → 알림 보류. 엉뚱한 강사에게 남의 집 얘기가 가면 안 된다.
      collisions.push(`${prefix}${eff}(전체 동명 ${dup}명)`);
      continue;
    }
    board.set(norm(`${prefix}${eff}`), { id: r.id, name: eff, grade: r.grade });
  }
  return { board, collisions: [...new Set(collisions)] };
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

    // ⚠️ **공유 보드 게이트** — 발송 워커와 **같은 순수 판정**(evaluateBoardSafety)을 태운다.
    // 동명이인 가드(boardsToStudents)로는 이 클래스를 **원천적으로 못 잡는다**: 공유 보드는 ClassNote 쪽
    // 멤버십 문제인데 eywa DB엔 보드 멤버십이 없다. 실사례 `(수학)박서준`(초6+중3 두 가족 동거)에서
    // eywa엔 "박서준"과 "박서준C"가 **다른 이름**이라 dup=1로 통과해버린다 → 중3 가족의 사적인 글이
    // 초6 담당 강사에게 간다(2026-07-15 2차 적대리뷰가 프로덕션에서 실증. docs §8도 같은 취지).
    // 보드 조회는 **잡힌 글이 있을 때만**(학부모 글 3주 8건 = 사실상 공짜). 실패 시 fail-closed(전건 보류).
    const held = [];
    let safeBoards = null;
    let allowlist = [];
    let universeNames = [];
    let feedPage = null;
    let feedCenterId = null;
    try {
      const { page, centerId } = await getFeedPage(browser);
      feedPage = page;
      feedCenterId = centerId;
      let nameRows;
      [safeBoards, allowlist, nameRows] = await Promise.all([
        fetchBoards(page, centerId),
        getClassnoteBoardAllowlist(sql, tenant),
        // 동명 판정 우주 — **퇴원·예비 포함 전 학생**(재원만 보면 퇴원 동명이인의 보드가 무방비).
        sql`select name, classnote_name from students where tenant_id = ${tenant}`,
      ]);
      universeNames = nameRows.map((x) => (x.classnote_name || x.name || "").trim()).filter(Boolean);
    } catch (e) {
      // 보드 확인 실패 = 공유 보드인지 모름 → 알리지 않는다(오배달보다 미알림이 낫다). 워터마크도 안 전진 → 다음 폴 재시도.
      log(`[feed] ⚠️ 보드 안전 확인 실패 — 이번 폴은 알림 보류(다음 폴 재시도): ${e.message}`);
      return { ran: true, detected: picked.length, notified: 0, held: picked.length };
    }

    const { board, collisions } = await boardsToStudents(sql, tenant, keys, group.prefix);
    const hits = [];
    for (const p of picked) {
      const s = board.get(norm(p.class_name));
      // 매핑 검증 — 이 보드의 원아가 정말 이 학생인가. **모호한 이름일 때만** 원아를 조회한다
      // (학부모는 가입 시 이름 뒤 알파벳을 안 붙여 `(수학)박서준` 하나가 초6·중3을 동시에 가리킬 수 있다).
      // 아니면 남의 집 학부모 글이 엉뚱한 강사에게 간다.
      const amb = s ? boardNameAmbiguity(s.name, universeNames) : { ambiguous: false, siblings: [] };
      let mapping = null;
      if (amb.ambiguous) {
        const first = evaluateBoardSafety({ className: p.class_name, boards: safeBoards, allowlist });
        const live = first.boardId
          ? await fetchBoardChildren(feedPage, feedCenterId, first.boardId).catch(() => null)
          : null;
        mapping = Array.isArray(live)
          ? { grade: s.grade ?? null, children: live, schoolYear: kstSchoolYear() }
          : { grade: null, children: [], schoolYear: kstSchoolYear() }; // 조회 실패 = 확인 불가 → 아래서 보류
      }
      const safety = evaluateBoardSafety({ className: p.class_name, boards: safeBoards, allowlist, mapping });
      if (!safety.ok) {
        held.push(`${p.class_name}(${safety.code} — ${String(safety.reason).slice(0, 60)})`);
        continue;
      }
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
          link: classnotePostUrl(h.post.id), // ClassNote 그 글로 직행(벨이 확인 팝업 후 새 창)
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
    // ⚠️ 워터마크를 트랜잭션 밖에서 읽었으므로(피드 조회가 네트워크라 락을 오래 쥘 수 없다) 여기서 **다시 잠그고
    // 확인**한다. 값이 그새 바뀌었다면 **다른 러너가 이 구간을 이미 처리한 것**(예: 데몬이 도는데 운영자가
    // process-parent-posts.mjs --apply를 같이 돌림) → 그쪽이 이미 알렸으므로 **중복 insert 금지**, 워터마크만 최대로.
    // notifications엔 유니크 제약이 없어 중복이 그대로 벨에 쌓이므로 이 확인이 유일한 방어다.
    let raced = false;
    await sql.begin(async (tx) => {
      const [fresh] = await tx`
        select last_seen_post_id from classnote_feed_state
        where tenant_id = ${tenant} and scope = ${SCOPE} for update`;
      const freshId = fresh?.last_seen_post_id == null ? null : Number(fresh.last_seen_post_id);
      if (freshId !== lastSeenId) {
        raced = true;
        await saveWatermark(tx, tenant, watermark);
        return;
      }
      if (plan.length) {
        await tx`insert into notifications ${tx(plan, "tenant_id", "recipient_id", "type", "title", "body", "link")}`;
      }
      await saveWatermark(tx, tenant, watermark);
    });

    if (raced) {
      log(`[feed] 다른 러너가 이 구간을 이미 처리함 — 중복 알림 방지로 ${plan.length}건 생략(워터마크만 전진)`);
      return { ran: true, detected: picked.length, notified: 0, held: held.length, tooOld: tooOld.length };
    }
    log(`[feed] 학부모 새 글 ${picked.length}건 감지 → 강사 알림 ${plan.length}건${held.length ? ` · 보류 ${held.length}건` : ""}`);
    for (const h of held) log(`[feed]   보류: ${h}`);
    return { ran: true, detected: picked.length, notified: plan.length, held: held.length, tooOld: tooOld.length };
  } catch (e) {
    await dropFeedPage(); // 다음 폴은 깨끗한 세션으로
    throw e;
  }
}

/**
 * 워터마크 저장 — **단조증가만 허용**(`greatest`).
 *
 * ⚠️ 무조건 덮어쓰면 **역행**한다: 워터마크 읽기가 트랜잭션 밖이라, 데몬이 도는 중에 운영자가
 * `process-parent-posts.mjs --apply`를 같이 돌리면(스크립트 안내는 "데몬이 죽었을 때"라고 하지만 오판 가능)
 * 둘 다 같은 lastSeen을 읽고 → 늦게 커밋한 쪽이 **더 작은 값**으로 덮어 이미 알린 글이 재알림된다.
 * greatest로 역행만은 구조적으로 막는다(같은 폴에서의 중복 insert는 그래도 가능 — 아래 주석 참조).
 */
async function saveWatermark(sql, tenant, id) {
  await sql`
    insert into classnote_feed_state (tenant_id, scope, last_seen_post_id, last_polled_at, status, error, updated_at)
    values (${tenant}, ${SCOPE}, ${id}, now(), 'ok', null, now())
    on conflict (tenant_id, scope) do update set
      last_seen_post_id = greatest(coalesce(classnote_feed_state.last_seen_post_id, 0), excluded.last_seen_post_id),
      last_polled_at = now(), status = 'ok', error = null, updated_at = now()`;
}
