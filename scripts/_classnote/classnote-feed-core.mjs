/**
 * scripts/_classnote/classnote-feed-core.mjs — ClassNote 학부모 **새 글·댓글** → 담당 강사 eywa 인앱 알림(인바운드).
 *
 * 배경(2026-07-15 실측): 학부모가 ClassNote에 "오늘 늦어요 / 아파서 쉬어요"를 남겨도 강사가 ClassNote 앱을
 * 안 보면 그냥 묻힌다. 실제로 수학 1인보드 학부모 글 8건 중 3건이 무응답이었고(강사별 편차 — 어떤 강사는 5/5 응답,
 * 어떤 강사는 0/2), 그중 하나는 보드에 **퇴직 강사가 연결**돼 있었다. 그래서 강사가 매일 보는 eywa 화면(알림 벨)에
 * 띄운다. eywa 매핑이 ClassNote 보드 연결보다 정확하다(퇴직자 배제 + 현직 담당 전원).
 *
 * **두 폴러가 산다** — 감지 방식이 근본적으로 달라 분리돼 있다(둘 다 읽기 전용, 세션·게이트는 공유):
 *  ① `pollParentPostsOnce` — 학부모 **새 글**. 피드에 새 행으로 뜨므로 **워터마크(마지막 본 id)** 하나로 결정적.
 *     1분 주기 · 보통 페이지 1개.
 *  ② `pollParentCommentsOnce` — 학부모 **댓글**(2026-07-16 추가). 전용 피드가 없어 기존 행의 `num_comments`
 *     증가로만 드러난다 → **댓글 수 스냅샷 대조**. 10분 주기 · 감시 창 최대 20페이지.
 *
 * 왜 댓글까지: 실측(최근 5~6일) **새 글 4.2건/일 vs 학부모 댓글 12건/일** — 학부모 연락의 다수가 댓글로 온다.
 * ClassNote의 자연스러운 흐름이 "강사가 알림장 → 학부모가 댓글로 답"이라 새 글이 오히려 예외다.
 *
 * 매핑이 보드명 기준인 이유: 피드 행의 `child_name`은 **학부모가 등록한 원아명**이라 제멋대로다
 * (실측: 보드 `(수학)박서연E`의 원아명이 그냥 "서연"). 반면 보드명은 **우리가 eywa 유효이름으로 만든 것**이라
 * 동명이인 접미사(A~G)까지 정확하다 — 애초에 1인 보드 구조가 그러라고 있는 것. 대상 집합은 발송(provision)의
 * `expectedFor`와 같은 쿼리(재원 + 활성 수강)를 쓰되, **신원 유일성은 전 학생 우주**로 따로 본다
 * (`boardsToStudents` 주석의 F1 참조 — 퇴원 동명이인의 보드가 재원 동명에게 붙는 사고를 막는다).
 *
 * 안전장치:
 *  - **읽기 전용**(GET) — ClassNote에 아무것도 쓰지 않는다. 구조상 학부모에게 나가는 경로 자체가 없다.
 *  - 콜드 스타트 = 기준선만 잡고 **알림 0건**(과거 글·댓글 폭탄 방지).
 *  - age 가드(기본 3일) — PC가 오래 꺼졌다 켜져도 밀린 과거 글·댓글로 벨이 도배되지 않는다.
 *  - **게이트는 두 폴러가 같은 함수**(`loadGateInputs`+`gateBoard`) — 한쪽만 취약해지는 구조를 원천 차단
 *    (발송 워커·공지 워커가 `evaluateBoardSafety`를 공유하는 것과 같은 이유).
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
  buildCommentNotificationText,
  pruneCounts,
  selectChangedReports,
  selectNewComments,
} from "./parent-comment-filter.mjs";
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

// ── 댓글 폴러 상수 ────────────────────────────────────────────────────────────
const COMMENT_SCOPE = "parent_comments";
/**
 * 10분 주기 — 원장이 명시적으로 수용한 지연("10분정도면 학부모가 늦게 확인해도 이해해주실거같은데").
 *
 * 글 폴러(1분)보다 느린 이유: 댓글 감지는 **감시 창 전체를 매번 다시 읽어야** 한다(전용 피드가 없어
 * `num_comments` 대조가 유일한 신호). 1분으로 당기면 요청이 하루 ~28,800회가 되지만 10분이면 ~2,880회 —
 * 기존 글 폴러(1,440회/일)와 같은 자릿수다. 지연 5분을 사자고 창을 얕게 파는 건 **거꾸로 된 거래**다(아래 참조).
 */
const COMMENT_POLL_INTERVAL_MS = 10 * 60_000;
/**
 * 감시 창 깊이(일) — 이 안에 있는 글의 댓글만 잡힌다.
 *
 * ⚠️ **깊어야 한다. 얕게 잡으면 제일 급한 걸 놓친다**(2026-07-16 실측이 직관을 뒤집음): 학부모는 그 알림장에
 * *답하는* 게 아니라 **자기 아이 보드 맨 위에 보이는 글에 그냥 말을 건다.** 그래서 지연은 "응답 속도"가 아니라
 * **"그 아이 알림장이 얼마나 뜸한가"** 고, 보고서가 뜸한 보드일수록 **오래된 글에 급한 용건**이 달린다.
 * 실제로 가장 늦게 달린 두 건이 가장 급했다 — 169.6h(7일) "오늘 배구방과후가 늦게끝나서 오늘 학원못갈것같아서",
 * 209.9h(8.7일) "상담 요청 드립니다 전화주세요". "늦게 달린 건 인사겠지"는 **틀린 가설**이다.
 * 수학 학부모 댓글 54건 분포: 3일 93% · 4일 96% · 나머지 4%가 위 두 건.
 */
const COMMENT_WINDOW_DAYS = 10;
/**
 * 창 백스톱(3,000행 = 30페이지). **반드시 창(10일)보다 넉넉히 커서 age 컷오프가 먼저 걸려야 한다.**
 *
 * ⚠️ 여유가 필요한 이유(2026-07-16 실측): 밀도가 계절 따라 크게 흔들린다 — 방학·특강 피크인 지금은
 * **최근 10일 = 1,913행 = 20페이지**라, 20페이지로 잡으면 창과 딱 겹쳐 매 폴 백스톱이 먼저 걸리고
 * (창을 온전히 못 봄) "20페이지 봤는데 창 끝 미도달" 경고가 상시 뜬다. 30페이지 ≈ 20일이라 밀도가 더
 * 치솟아도 10일 창이 항상 먼저 닫힌다. 정상 폴은 age 컷오프가 10일에서 멈춰 **실제로는 ~20페이지에서 끝난다**
 * — 30은 피크 대비 안전 여유일 뿐, 매 폴 30페이지를 다 읽지는 않는다.
 */
const COMMENT_MAX_PAGES = 30;
/**
 * 스냅샷 상한 — 창(최대 3,000글)보다 넉넉해야 한다. 창 안 글이 잘려나가면 다음 폴에 "처음 보는 글"로 되살아나
 * 기준선만 다시 잡고(=알림 0) 그 사이 달린 댓글을 **조용히** 놓친다.
 */
const COMMENT_COUNTS_CAP = 3500;

let lastRunAt = 0; // 모듈 스코프 인메모리 가드 — 재시작 시 즉시 1회 실행은 정상(워터마크가 중복을 막음)
let lastCommentRunAt = 0; // 위와 같은 취지(재시작 시 1회 즉시 실행 — 스냅샷이 중복을 막음)

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

/** 그 글의 댓글 전건 — id **내림차순**(최신 먼저)이 API 계약. 순서 의존 판단은 순수 모듈이 asc로 다시 정렬해서 한다. */
async function fetchComments(page, reportId) {
  return page.evaluate(
    async ([id]) => {
      const r = await fetch(`/api/v1/reports/${id}/comments/?page_size=100`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`댓글 조회 실패 HTTP ${r.status}`);
      const j = await r.json();
      return j?.results ?? [];
    },
    [reportId],
  );
}

/**
 * 피드를 거슬러 수집 — 두 폴러가 **다른 창**으로 같은 함수를 쓴다.
 * 종료: ① 워터마크 도달(글 폴러만 — 이미 본 구간) ② **age 컷오프보다 오래된 구간 진입** ③ 마지막 페이지
 * ④ maxPages 백스톱.
 *
 * @param {{ watermark?: number|null, useWatermark?: boolean, maxPages: number, maxAgeDays: number, label: string }} opts
 *   useWatermark=false(댓글 폴러)면 워터마크로 멈추지 않는다 — 댓글은 **이미 본 글에** 달리므로 창 전체를 봐야 한다.
 */
async function collectFeed(page, centerId, opts, log) {
  const { watermark = null, useWatermark = false, maxPages, maxAgeDays, label } = opts;
  const all = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const { list, next } = await fetchFeedPage(page, centerId, cursor);
    all.push(...list);
    if (!list.length || !next) return all;
    if (useWatermark && reachedWatermark(list, watermark)) return all;
    if (pageOlderThanAgeGuard(list, { maxAgeDays })) return all; // 더 파도 창 밖
    cursor = next;
  }
  // 여기 도달 = 창 기간치가 maxPages를 넘었다는 뜻(밀도 급증). 건너뛴 구간은 창 안일 수 있으니 경고를 남긴다.
  log(`[${label}] ⚠️ ${maxPages}페이지(${all.length}건)를 봤는데도 창(${maxAgeDays}일) 끝에 도달 못 함 — 더 과거는 건너뜁니다`);
  return all;
}

/** 유지된 세션으로 피드 조회. 세션 만료·페이지 사망이면 **1회만** 재로그인 후 재시도. */
async function fetchWindow(browser, opts, log) {
  for (let attempt = 0; ; attempt++) {
    const { page, centerId } = await getFeedPage(browser);
    try {
      return await collectFeed(page, centerId, opts, log);
    } catch (e) {
      await dropFeedPage();
      if (attempt >= 1) throw e;
      log(`[${opts.label}] 세션 재수립 후 재시도: ${e.message}`);
    }
  }
}

/**
 * 게이트 재료(보드 목록 · 예외 등재 · 동명 판정 우주) — **알릴 후보가 실제로 있을 때만** 부른다.
 * 두 폴러가 공유해서 한쪽만 취약해지는 구조를 막는다.
 */
async function loadGateInputs(sql, browser, tenant) {
  const { page, centerId } = await getFeedPage(browser);
  const [safeBoards, allowlist, nameRows] = await Promise.all([
    fetchBoards(page, centerId),
    getClassnoteBoardAllowlist(sql, tenant),
    // 동명 판정 우주 — **퇴원·예비 포함 전 학생**(재원만 보면 퇴원 동명이인의 보드가 무방비).
    sql`select name, classnote_name from students where tenant_id = ${tenant}`,
  ]);
  return {
    page,
    centerId,
    safeBoards,
    allowlist,
    universeNames: nameRows.map((x) => (x.classnote_name || x.name || "").trim()).filter(Boolean),
  };
}

/**
 * 보드명 하나가 **알려도 되는 보드인가** — 공유보드·중복보드 차단 + 동명이인 매핑 검증.
 *
 * ⚠️ **동명이인 가드(boardsToStudents)로는 공유 보드를 원천적으로 못 잡는다**: 공유 보드는 ClassNote 쪽
 * 멤버십 문제인데 eywa DB엔 보드 멤버십이 없다. 실사례 `(수학)박서준`(초6+중3 두 가족 동거)에서
 * eywa엔 "박서준"과 "박서준C"가 **다른 이름**이라 dup=1로 통과해버린다 → 중3 가족의 사적인 글이
 * 초6 담당 강사에게 간다(2026-07-15 2차 적대리뷰가 프로덕션에서 실증. docs §8도 같은 취지).
 *
 * 매핑 검증(원아 생일 ↔ eywa 학년)은 **모호한 이름일 때만** 원아를 조회한다 — 학부모는 가입 시 이름 뒤
 * 알파벳을 안 붙여 `(수학)박서준` 하나가 초6·중3을 동시에 가리킬 수 있다. 조회 실패 = 확인 불가 → 보류.
 *
 * @returns {Promise<{ok:true, student:object} | {ok:false, reason:string}>}
 */
async function gateBoard(gate, board, className) {
  const s = board.get(norm(className));
  const amb = s ? boardNameAmbiguity(s.name, gate.universeNames) : { ambiguous: false, siblings: [] };
  let mapping = null;
  if (amb.ambiguous) {
    const first = evaluateBoardSafety({ className, boards: gate.safeBoards, allowlist: gate.allowlist });
    const live = first.boardId ? await fetchBoardChildren(gate.page, gate.centerId, first.boardId).catch(() => null) : null;
    mapping = Array.isArray(live)
      ? { grade: s.grade ?? null, children: live, schoolYear: kstSchoolYear() }
      : { grade: null, children: [], schoolYear: kstSchoolYear() }; // 조회 실패 = 확인 불가 → 아래서 보류
  }
  const safety = evaluateBoardSafety({ className, boards: gate.safeBoards, allowlist: gate.allowlist, mapping });
  if (!safety.ok) return { ok: false, reason: `${className}(${safety.code} — ${String(safety.reason).slice(0, 60)})` };
  if (!s) return { ok: false, reason: `${className}(재원·수강 아님 또는 동명이인 보류)` };
  return { ok: true, student: s };
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
    const rows = await fetchWindow(
      browser,
      { watermark: lastSeenId, useWatermark: true, maxPages: MAX_PAGES, maxAgeDays: MAX_AGE_DAYS, label: "feed" },
      log,
    );
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

    // ⚠️ **보드 게이트**(공유보드·중복·동명이인 매핑) — 댓글 폴러·발송 워커와 **같은 판정**을 태운다(gateBoard 주석 참조).
    // 보드 조회는 **잡힌 글이 있을 때만**(학부모 글 3주 8건 = 사실상 공짜). 실패 시 fail-closed(전건 보류).
    const held = [];
    let gate;
    try {
      gate = await loadGateInputs(sql, browser, tenant);
    } catch (e) {
      // 보드 확인 실패 = 공유 보드인지 모름 → 알리지 않는다(오배달보다 미알림이 낫다). 워터마크도 안 전진 → 다음 폴 재시도.
      log(`[feed] ⚠️ 보드 안전 확인 실패 — 이번 폴은 알림 보류(다음 폴 재시도): ${e.message}`);
      return { ran: true, detected: picked.length, notified: 0, held: picked.length };
    }

    const { board, collisions } = await boardsToStudents(sql, tenant, keys, group.prefix);
    const hits = [];
    for (const p of picked) {
      const g = await gateBoard(gate, board, p.class_name);
      if (!g.ok) {
        held.push(g.reason);
        continue;
      }
      hits.push({ post: p, student: g.student });
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

/** 댓글 수 스냅샷 저장(scope=parent_comments). 워터마크와 달리 **통째 교체** — 창이 앞으로 굴러가므로 병합이 무의미. */
async function saveCounts(sql, tenant, counts) {
  await sql`
    insert into classnote_feed_state (tenant_id, scope, counts, last_polled_at, status, error, updated_at)
    values (${tenant}, ${COMMENT_SCOPE}, ${sql.json(counts)}, now(), 'ok', null, now())
    on conflict (tenant_id, scope) do update set
      counts = excluded.counts, last_polled_at = now(), status = 'ok', error = null, updated_at = now()`;
}

/**
 * 한 주기 — 학부모 **댓글** 감지 → 담당 강사 알림. 데몬이 매 폴 부르지만 대부분 즉시 no-op(10분 가드).
 *
 * 흐름: 감시 창(최대 20페이지) 조회 → `num_comments`가 지난 스냅샷과 **달라진 수학 글**만 골라
 *   그 글의 댓글 API를 연다(하루 ~12~24회) → **새로 달린 학부모 댓글**만(강사 답글도 수를 올리므로 걸러짐) →
 *   보드 게이트 → 담당 강사 → notifications insert + 스냅샷 갱신(**같은 트랜잭션**).
 *
 * @param {object} opts - { tenant, post, log, force, dryRun }
 *   dryRun=true면 감지·매핑까지만 하고 **insert도 스냅샷 갱신도 안 함**(점검용 one-shot).
 * @returns {Promise<{ran:boolean, changed?:number, detected?:number, notified?:number, held?:number, tooOld?:number, plan?:Array}>}
 */
export async function pollParentCommentsOnce(sql, browser, { tenant, post, log = console.log, force = false, dryRun = false }) {
  if (!force) {
    if (!post) return { ran: false };
    if (Date.now() - lastCommentRunAt < COMMENT_POLL_INTERVAL_MS) return { ran: false };
  }
  lastCommentRunAt = Date.now();

  const group = BOARD_GROUPS.math;
  const keys = group.subjectKeys;

  const [state] = await sql`
    select counts, updated_at from classnote_feed_state
    where tenant_id = ${tenant} and scope = ${COMMENT_SCOPE}`;
  const counts = state?.counts ?? null;
  const readAt = state?.updated_at ? new Date(state.updated_at).toISOString() : null;

  try {
    const rows = await fetchWindow(
      browser,
      { useWatermark: false, maxPages: COMMENT_MAX_PAGES, maxAgeDays: COMMENT_WINDOW_DAYS, label: "comment" },
      log,
    );
    if (!rows.length) return { ran: true, changed: 0, notified: 0 };

    const { changed, nextCounts, firstSeen } = selectChangedReports(rows, counts, { prefix: group.prefix });

    // 콜드 스타트 — 기준선만 잡고 알림 0건. 댓글 수가 피드 행에 이미 있어 **추가 요청 0**이다(글 폴러의 워터마크 초기화와 같은 역할).
    if (counts === null) {
      if (!dryRun) await saveCounts(sql, tenant, pruneCounts(nextCounts, COMMENT_COUNTS_CAP));
      log(`[comment] 첫 실행 — 수학 글 ${firstSeen}개의 댓글 수 기준선 기록(과거 댓글은 알리지 않음)`);
      return { ran: true, changed: 0, notified: 0 };
    }

    if (!changed.length) {
      if (!dryRun) await saveCounts(sql, tenant, pruneCounts(nextCounts, COMMENT_COUNTS_CAP));
      return { ran: true, changed: 0, notified: 0 };
    }

    let gate;
    try {
      gate = await loadGateInputs(sql, browser, tenant);
    } catch (e) {
      // 보드 확인 실패 = 알려도 되는 보드인지 모름 → 알리지 않는다. 스냅샷도 안 갱신 → 다음 폴에 같은 글이 다시 잡힌다.
      log(`[comment] ⚠️ 보드 안전 확인 실패 — 이번 폴은 알림 보류(다음 폴 재시도): ${e.message}`);
      return { ran: true, changed: changed.length, notified: 0, held: changed.length };
    }
    const { board } = await boardsToStudents(sql, tenant, keys, group.prefix);

    const held = [];
    const hits = [];
    let detected = 0;
    let tooOldCount = 0;
    for (const ch of changed) {
      let list;
      try {
        list = await fetchComments(gate.page, ch.id);
      } catch (e) {
        // 이 글만 되돌린다 — 나머지 글의 스냅샷 전진은 유효하므로 폴 전체를 버리지 않는다.
        nextCounts[String(ch.id)] = ch.knownCount;
        held.push(`${ch.className}(댓글 조회 실패 — ${String(e.message).slice(0, 40)})`);
        continue;
      }
      const { picked, tooOld, incomplete } = selectNewComments(list, {
        knownCount: ch.knownCount,
        actualCount: ch.count,
        maxAgeDays: MAX_AGE_DAYS,
      });
      if (incomplete) {
        // 전건을 못 봤다 → **추측하지 않고** 기준선을 되돌려 다음 폴에 다시 본다. 여기서 진전시키면 중간 댓글이 영영 샌다.
        nextCounts[String(ch.id)] = ch.knownCount;
        log(`[comment] ${ch.className} 댓글 전건 확인 실패(피드 ${ch.count}개 vs 응답 ${list.length}개) — 다음 폴 재시도`);
        continue;
      }
      tooOldCount += tooOld.length;
      // 강사 답글만 늘었거나 삭제된 경우 — 정상. 게이트(원아 조회)를 태울 이유가 없다.
      if (!picked.length) continue;
      detected += picked.length;
      const g = await gateBoard(gate, board, ch.className);
      if (!g.ok) {
        // 게이트 차단은 안정적인 판정이라 스냅샷은 그대로 전진시킨다(매 폴 재조회해도 결론이 같다).
        held.push(g.reason);
        continue;
      }
      for (const k of picked) hits.push({ comment: k, student: g.student, reportId: ch.id });
    }

    const byTeacher = await teachersFor(sql, tenant, [...new Set(hits.map((h) => h.student.id))], keys);
    const plan = [];
    for (const h of hits) {
      const teachers = byTeacher.get(h.student.id) ?? [];
      if (!teachers.length) {
        held.push(`${group.prefix}${h.student.name}(활성 담당 강사 없음)`);
        continue;
      }
      const { title, body } = buildCommentNotificationText(h.comment, h.student.name);
      for (const t of teachers) {
        plan.push({
          tenant_id: tenant,
          recipient_id: t,
          type: "classnote_parent_comment",
          title,
          body,
          link: classnotePostUrl(h.reportId), // 댓글이 달린 그 글로 직행(벨이 확인 팝업 후 새 창)
        });
      }
    }

    if (dryRun) {
      log(`[comment] (점검) 댓글 수 변한 글 ${changed.length}건 → 새 학부모 댓글 ${detected}건 → 알림 ${plan.length}건 예정 · 보류 ${held.length}건`);
      for (const h of held) log(`[comment]   보류: ${h}`);
      return { ran: true, changed: changed.length, detected, notified: 0, held: held.length, tooOld: tooOldCount, plan };
    }

    // 알림 insert와 스냅샷 갱신을 **한 트랜잭션**으로 — 중간에 죽어도 같은 댓글을 두 번 알리지 않는다.
    // ⚠️ 스냅샷을 트랜잭션 밖에서 읽었으므로(피드·댓글 조회가 네트워크라 락을 오래 쥘 수 없다) 여기서 **다시 잠그고
    // 확인**한다. 그새 바뀌었다면 **다른 러너가 이 구간을 이미 처리한 것**(예: 데몬이 도는데 운영자가 one-shot을
    // 같이 돌림) → 우리 nextCounts는 낡은 기준선이라 그대로 쓰면 그쪽이 이미 알린 댓글을 **되살린다**(카운트 되돌림
    // → 다음 폴에 재알림). notifications엔 유니크 제약이 없어 중복이 그대로 벨에 쌓이므로, 통째로 포기하고
    // 다음 폴에서 새로 읽는 게 유일하게 안전한 선택이다.
    let raced = false;
    await sql.begin(async (tx) => {
      const [fresh] = await tx`
        select updated_at from classnote_feed_state
        where tenant_id = ${tenant} and scope = ${COMMENT_SCOPE} for update`;
      const freshAt = fresh?.updated_at ? new Date(fresh.updated_at).toISOString() : null;
      if (freshAt !== readAt) {
        raced = true;
        return;
      }
      if (plan.length) {
        await tx`insert into notifications ${tx(plan, "tenant_id", "recipient_id", "type", "title", "body", "link")}`;
      }
      await saveCounts(tx, tenant, pruneCounts(nextCounts, COMMENT_COUNTS_CAP));
    });

    if (raced) {
      log(`[comment] 다른 러너가 이 구간을 이미 처리함 — 중복 알림 방지로 ${plan.length}건 생략(다음 폴에서 새로 읽음)`);
      return { ran: true, changed: changed.length, detected, notified: 0, held: held.length, tooOld: tooOldCount };
    }
    if (tooOldCount) log(`[comment] ${MAX_AGE_DAYS}일 지난 학부모 댓글 ${tooOldCount}건 건너뜀(밀린 알림 폭주 방지)`);
    if (plan.length || held.length) {
      log(`[comment] 새 학부모 댓글 ${detected}건 감지 → 강사 알림 ${plan.length}건${held.length ? ` · 보류 ${held.length}건` : ""}`);
      for (const h of held) log(`[comment]   보류: ${h}`);
    }
    return { ran: true, changed: changed.length, detected, notified: plan.length, held: held.length, tooOld: tooOldCount };
  } catch (e) {
    await dropFeedPage(); // 다음 폴은 깨끗한 세션으로
    throw e;
  }
}
