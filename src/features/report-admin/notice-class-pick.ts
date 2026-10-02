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

const byName = (a: NoticeClassCandidate, b: NoticeClassCandidate) => a.className.localeCompare(b.className, "ko") || a.classId.localeCompare(b.classId);

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
  const live = [...input.live].sort(byName);
  if (!live.length) return { ok: false, reason: "no_class_board" };
  const ok = (c: NoticeClassCandidate, via: "teacher" | "selected" | "only" | "first"): NoticeClassPick => ({
    ok: true, classId: c.classId, className: c.className, boardName: c.boardName, via,
  });
  const hinted = (pool: readonly NoticeClassCandidate[]) => {
    for (const id of input.hints ?? []) {
      const hit = pool.find((c) => c.classId === id);
      if (hit) return hit;
    }
    return null;
  };
  if (input.teacher !== "none") {
    const mine = live.filter((c) => c.taught);
    if (mine.length) return ok(hinted(mine) ?? mine.find((c) => c.homeroom) ?? mine[0]!, "teacher");
    if (input.teacher === "strict") return { ok: false, reason: input.teachesStudent ? "no_class_board" : "not_my_class" };
  }
  const sel = hinted(live);
  if (sel) return ok(sel, "selected");
  return live.length === 1 ? ok(live[0]!, "only") : ok(live[0]!, "first");
}

/**
 * 반 보드 경로 타깃의 **표시·대조 키**(`targets[].board`) — 한 반 보드에 여러 학생이 가므로 반 보드 이름만으로는 서로 구분되지 않는다.
 * 워커는 이 값을 결과(`results[].board`)에 그대로 돌려주고, 화면은 이 값으로 결과와 대상을 맞춘다(notice-links.ts).
 * 🔴 워커는 이 글자로 보드를 찾지 않는다 — 반 보드 경로는 `classId`(→ 0302a 보드 번호)만 쓴다.
 */
export function classTargetKey(boardName: string, studentName: string): string {
  return `${boardName.trim()} · ${studentName.trim()}`;
}
