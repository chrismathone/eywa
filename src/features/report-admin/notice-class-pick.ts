/**
 * **원생 개별 공지·교재요청서를 어느 반 보드로 보낼지** — 순수 판정(서버·테스트 공용, `server-only`/`use client` 금지).
 *
 * 원장 2026-10-02: *"수학은 더 이상 1인 보드 안쓰는 방향"* · *"개인 공지는 수업보고서와 동일하게 일인발송으로 배선"* ·
 * *"어차피 수학은 해당반의 담당선생님이 있으니 해당 선생님 반 학생 삼자 일치를 기준으로 발송하면 될듯"* ·
 * *"배선이 철저해야 오발송 일어나지 않음"*.
 *
 * 규칙 = **삼자 일치**(보내는 선생님 – 반 – 학생):
 *  · 학생 다리 = 그 학생이 오늘 다니는 수학 반 중 **이 학생의 살아 있는 반 보드**가 있는 반(연결 0302a + 원아 매칭 전부 ok) — `live`.
 *  · 선생님 다리 = 보내는 선생님이 그 반 담당(담임 · 오늘 유효한 교시 담당 · 오늘 위임) — `taught`.
 *  · 둘 다 맞는 반이 하나면 그 반. 여럿이면(같은 선생님의 정규 반 + 개별 반 등) 화면이 고른 반 → 담임인 반 → 반 이름순.
 *    🔴 화면이 고른 반이 아니면 **JJ 반(반 이름에 `JJ` 코드)은 후순위** — 원장 2026-10-20 *"제이제이를 후순위로 두도록"*
 *    (이강우: 같은 선생님의 `초등M 개별 JJ2K`·`초등M 초6 BS2P` 중 이름순으로 JJ2K가 골라졌다). 담임 판정보다 앞선다.
 *    어느 반으로 가도 같은 학생의 같은 원아에게 가므로 오발송이 아니다 — 고르는 규칙만 정해 둔다(매번 같은 반).
 *  · 보내는 선생님이 없는 발송(사무실)은 선생님 다리 대신 **화면이 고른 반**(그 반 명단에서 뽑은 학생)을 쓴다.
 *    그것도 없으면 학생의 반이 하나일 때만 그 반, 여럿이면 반 이름순 첫 반.
 *  · 선생님 다리는 **강사 본인이 보낼 때만 문**이다(`strict` — 남의 반 보드로는 못 보낸다). 사무실이 요청서 주인 대신 보낼 때는
 *    **우선순위**다(`prefer`) — 주인이 가르치는 반이 있으면 그 반, 없으면(사무실 직원이 직접 낸 요청 등) 위 사무실 규칙으로 간다.
 * 🔴 맞는 반이 없으면 **보내지 않는다** — 1인 보드 `(수학)이름`으로 되돌리지 않는다(수학은 1인 보드를 안 쓰는 방향).
 * 🔴 원아는 여기서 고르지 않는다 — 워커가 0302a에 적힌 원아 번호로 올린다(이름으로 찾지 않는다).
 */

export type NoticeClassCandidate = {
  classId: string;
  className: string;
  /** ClassNote에 지금 붙은 반 보드 이름(연결표 `board_name`). */
  boardName: string;
  /** 보내는 선생님이 이 반 담당인가(담임 · 오늘 교시 담당 · 오늘 위임). 선생님 없는 발송이면 false. */
  taught: boolean;
  /** 보내는 선생님이 이 반 담임인가. */
  homeroom: boolean;
};

export type NoticeClassFail = "no_class_board" | "not_my_class";

export type NoticeClassPick =
  | { ok: true; classId: string; className: string; boardName: string; via: "teacher" | "selected" | "only" | "first" }
  | { ok: false; reason: NoticeClassFail };

/** JJ 반 — 반 이름의 코드가 `JJ`로 시작(`초등M 개별 JJ2K` · `중등M 중2 JJPS`). 화면이 고르지 않았으면 후순위. */
export const isJjClassName = (name: string): boolean => /(^|[^A-Za-z])JJ/.test(name);

/** 정렬·우선순위가 보는 칸(수학 반 보드 후보 · 영어 반 후보 공용). */
type Ranked = { classId: string; className: string; homeroom: boolean };

const byName = (a: Ranked, b: Ranked) => a.className.localeCompare(b.className, "ko") || a.classId.localeCompare(b.classId);
/** JJ 반을 뒤로, 그 안에서는 반 이름순. */
const byPriority = (a: Ranked, b: Ranked) => Number(isJjClassName(a.className)) - Number(isJjClassName(b.className)) || byName(a, b);
/** 담임 반 우선 — 단 JJ가 아닌 반이 있으면 JJ 담임 반보다 그 반이 먼저다. */
const preferred = <T extends Ranked>(pool: readonly T[]): T => {
  const head = pool.filter((c) => !isJjClassName(c.className));
  const tier = head.length ? head : pool;
  return tier.find((c) => c.homeroom) ?? tier[0]!;
};
/** 화면이 고른 반 중 후보 안에 있는 첫 반. */
const hintedIn = <T extends { classId: string }>(pool: readonly T[], hints: readonly string[] | undefined): T | null => {
  for (const id of hints ?? []) {
    const hit = pool.find((c) => c.classId === id);
    if (hit) return hit;
  }
  return null;
};

/** 선생님 다리를 어떻게 쓸지 — strict = 문(강사 본인 발송) · prefer = 우선순위(사무실이 주인 대신) · none = 선생님 없는 발송. */
export type NoticeTeacherMode = "strict" | "prefer" | "none";

export function pickNoticeClass(input: {
  /** 학생 다리를 통과한 반(오늘 다니는 수학 반 ∩ 이 학생의 살아 있는 반 보드). */
  live: readonly NoticeClassCandidate[];
  teacher: NoticeTeacherMode;
  /**
   * 보내는 선생님이 **이 학생이 다니는 반을 맡고는 있는가**(그 반의 반 보드 상태와 무관). strict에서 맞는 반이 없을 때의 사유를 가른다:
   * 맡은 반이 있는데 그 반 보드가 없는 것(반 보드 없음)과, 애초에 맡은 반이 아닌 것(담당 반 아님)은 고치는 길이 다르다.
   */
  teachesStudent?: boolean;
  /** 화면이 고른 반(그 학생을 뽑은 반 — 여러 반에서 뽑혔으면 순서대로). 후보 안에 있을 때만 쓴다. */
  hints?: readonly string[];
}): NoticeClassPick {
  const live = [...input.live].sort(byPriority);
  if (!live.length) return { ok: false, reason: "no_class_board" };
  const ok = (c: NoticeClassCandidate, via: "teacher" | "selected" | "only" | "first"): NoticeClassPick => ({
    ok: true, classId: c.classId, className: c.className, boardName: c.boardName, via,
  });
  const hinted = (pool: readonly NoticeClassCandidate[]) => hintedIn(pool, input.hints);
  if (input.teacher !== "none") {
    const mine = live.filter((c) => c.taught);
    if (mine.length) return ok(hinted(mine) ?? preferred(mine), "teacher");
    if (input.teacher === "strict") return { ok: false, reason: input.teachesStudent ? "no_class_board" : "not_my_class" };
  }
  const sel = hinted(live);
  if (sel) return ok(sel, "selected");
  return live.length === 1 ? ok(live[0]!, "only") : ok(live[0]!, "first");
}

/**
 * **영어 개별 공지·교재요청서의 반**(원장 2026-11-04 *"추천으로 해"* — 1인 보드 배정 금지 뒤 영어 신입이 받을 곳이 없어서).
 * 후보 = 이 학생이 오늘 다니는 영어 반 **전부**(반 방 연결과 무관) — 반을 먼저 정하고, 그 반에 ClassNote 반 방(s2_0006)이 이어져
 * 있으면 반 방, 없으면 지금처럼 이미 있는 `(영어)이름` 1인 보드(`personal`)로 간다. 반을 고르는 규칙은 수학과 같은 삼자 일치다:
 *  · 선생님 다리(strict = 강사 본인 · prefer = 사무실이 요청서 주인 대신) — 맡은 반이 있으면 그 반(화면이 고른 반 → 반 방 있는 반 →
 *    JJ 아닌 반 → 담임 반 → 이름순). 🔴 strict인데 맡은 반이 없으면 반 방으로 보내지 않는다(남의 반 방 금지) — 지금처럼 1인 보드.
 *  · 선생님 없는 발송(사무실 '반 공지' 탭) = 화면이 고른 반 → 없으면 반 방 있는 반 → 이름순 첫 반.
 * 화면이 고른 반이 여럿이면(한 학생이 고른 반 둘에 다 다닌다) **고른 반들 안에서** 같은 순서(반 방 있는 반 먼저)로 고른다 —
 * 고른 순서(수강 행 순서·로스터)에 따라 반 방과 1인 보드가 갈리지 않게(리뷰 2026-11-04).
 * 🔴 고른 반이 전부 반 방 없는 반이면 다른 반의 반 방으로 옮기지 않는다(고른 반의 일이다) — 1인 보드로 간다.
 * 어느 반 방으로 가도 받는 것은 이 학생의 확정 원아뿐이다(워커가 원아 연결 ∩ 지금 그 방으로 다시 고른다 — 이름으로 찾지 않는다).
 */
export type EnglishNoticeClass = {
  classId: string;
  className: string;
  /** 이 반에 이어진 ClassNote 영어 반 방 이름(`classnote_english_class_boards.board_name`). 없으면 null. */
  room: string | null;
  /** 보내는 선생님이 이 반 담당인가(담임 · 오늘 교시 담당 · 오늘 위임). */
  taught: boolean;
  /** 보내는 선생님이 이 반 담임인가. */
  homeroom: boolean;
};

export type EnglishNoticePick =
  | { route: "room"; classId: string; className: string; boardName: string; via: "teacher" | "selected" | "only" | "first" }
  | { route: "personal" };

export function pickEnglishNoticeClass(input: {
  /** 이 학생이 오늘 다니는 영어 반(종강·폐지·휴원·끝난 수강 제외). */
  classes: readonly EnglishNoticeClass[];
  teacher: NoticeTeacherMode;
  hints?: readonly string[];
}): EnglishNoticePick {
  // 반 방 있는 반 → JJ 아닌 반 → 이름순(매번 같은 반을 고른다).
  const all = [...input.classes].sort((a, b) => Number(!a.room) - Number(!b.room) || byPriority(a, b));
  const chosen = (c: EnglishNoticeClass, via: "teacher" | "selected" | "only" | "first"): EnglishNoticePick =>
    c.room ? { route: "room", classId: c.classId, className: c.className, boardName: c.room, via } : { route: "personal" };
  // 여러 반 중 하나 — 반 방 있는 반 → JJ 아닌 반 → 담임 반 → 이름순(`pool`은 이미 반 방·JJ·이름 순이다).
  const best = (pool: readonly EnglishNoticeClass[]) => {
    const linked = pool.filter((c) => c.room);
    return preferred(linked.length ? linked : pool);
  };
  // 화면이 고른 반 — 고른 순서가 아니라 위와 같은 순서로(고른 반들 안에서). 고른 반이 후보에 없으면 null.
  const hints = new Set(input.hints ?? []);
  const hinted = (pool: readonly EnglishNoticeClass[]) => {
    const hit = pool.filter((c) => hints.has(c.classId));
    return hit.length ? best(hit) : null;
  };
  if (!all.length) return { route: "personal" };
  if (input.teacher !== "none") {
    const mine = all.filter((c) => c.taught);
    if (mine.length) return chosen(hinted(mine) ?? best(mine), "teacher");
    if (input.teacher === "strict") return { route: "personal" };
  }
  const sel = hinted(all);
  if (sel) return chosen(sel, "selected");
  return chosen(all[0]!, all.length === 1 ? "only" : "first");
}

/**
 * 반 보드 경로 타깃의 **표시·대조 키**(`targets[].board`) — 한 반 보드에 여러 학생이 가므로 반 보드 이름만으로는 서로 구분되지 않는다.
 * 워커는 이 값을 결과(`results[].board`)에 그대로 돌려주고, 화면은 이 값으로 결과와 대상을 맞춘다(notice-links.ts).
 * 🔴 워커는 이 글자로 보드를 찾지 않는다 — 반 보드 경로는 `classId`(→ 0302a 보드 번호)만 쓴다.
 */
export function classTargetKey(boardName: string, studentName: string): string {
  return `${boardName.trim()} · ${studentName.trim()}`;
}
