/**
 * eywa 반 로스터 ↔ ClassNote 반 보드 원아 대조 — 순수 함수(Vitest).
 *
 * 왜: 영어는 학생 1인 보드가 아니라 **반 보드**로 운영된다. 그래서 eywa에서 반을 옮기거나 신입이
 * 들어와도 ClassNote 보드는 따라오지 않고, 그 학생은 **발송이 조용히 실패**한다. 2026-07-23 실측
 * 학생-반 248건 중 30건(12%)이 그 상태였다. 반 이동·신입·퇴원 때마다 재발하므로 상시 점검이 필요하다.
 *
 * 판정 단위 = (반, 학생). 결과는 **사실만** 말하고 자동 수정은 하지 않는다 —
 * ClassNote 배정은 학부모 초대가 얽혀 있어 사람이 판단해야 한다.
 */

/** ClassNote 원아 1명(스냅샷). */
export type BoardMember = { childId: number; childName: string; birthYear: number | null };
/** ClassNote 반 보드 1개 + 원아. */
export type BoardSnapshot = { boardId: number; boardName: string; members: BoardMember[] };
/** eywa 반 1개 + 재원 로스터(유효이름 = classnote_name || name). */
export type ClassRoster = { classId: string; className: string; teacher: string | null; students: string[] };

/**
 * ClassNote 원아 표시명 → 매칭 키 집합.
 *
 * ⚠️ **워커 `childKeys`(scripts/_classnote/classnote-admin-core.mjs)와 같은 규칙이어야 한다.**
 * 저쪽은 실제 발송 대상을 고르고 여기는 그 결과를 예고한다 — 어긋나면 화면이 거짓말을 한다.
 * (한쪽은 .mjs+playwright라 import로 공유가 안 돼 이식했다. board-roster-diff.test.ts가 규칙을 고정한다.)
 * 괄호 추출은 **영문닉(한글) 한정** — "박지민(지민)" 같은 한글(별명)에서 별명을 이름으로 승격하면 오매칭 연료가 된다.
 */
export function childKeys(name: string): Set<string> {
  const keys = new Set<string>();
  const t = (name ?? "").trim();
  if (!t) return keys;
  keys.add(t);
  const stripped = t.replace(/[a-zA-Z]/g, "").replace(/[()]/g, "").trim();
  if (stripped) keys.add(stripped);
  const paren = t.match(/^[A-Za-z .]+\(([가-힣]{2,6})\)$/);
  if (paren) keys.add(paren[1]!);
  return keys;
}

/** 워커 `resolveBoardChildEnrollments`의 후보 선정과 동일 — 이름(원문 또는 알파벳 제거본)이 키에 있으면 후보. */
export function matchMembers(studentName: string, members: readonly BoardMember[]): BoardMember[] {
  const clean = (studentName ?? "").replace(/[a-zA-Z]/g, "").trim();
  return members.filter((m) => {
    const keys = childKeys(m.childName);
    return keys.has(studentName) || (clean !== "" && keys.has(clean));
  });
}

/** 한글 음절의 초성 인덱스(0~18). 한글 음절이 아니면 null. */
function initialConsonant(ch: string): number | null {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return Math.floor((code - 0xac00) / 588);
}

/**
 * 이름 표기 차이 **후보**(힌트 전용 — 자동 적용 금지).
 *
 * 실측된 두 유형만 잡는다:
 *  ① 한쪽이 다른 쪽에 포함 — `박서연E` ↔ `서연`(학부모가 성 없이 등록)
 *  ② 같은 길이에 한 글자 차이 **+ 그 글자의 초성이 같음** — `강지윈` ↔ `강지원`(오타)
 *
 * ⚠️ 초성 조건이 없으면 `김태빈` ↔ `김태오` 같은 **완전한 남남**이 후보로 뜬다(실측 DP5반).
 *    오타는 대개 모음·받침에서 나므로 초성까지 갈리면 다른 이름으로 본다.
 */
export function looksLikeSameName(a: string, b: string): boolean {
  const x = (a ?? "").replace(/[a-zA-Z\s]/g, "");
  const y = (b ?? "").replace(/[a-zA-Z\s]/g, "");
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  if (x.length !== y.length) return false;
  let at = -1;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (at >= 0) return false; // 두 글자 이상 다름
    at = i;
  }
  if (at < 0) return false;
  const ix = initialConsonant(x[at]!);
  const iy = initialConsonant(y[at]!);
  return ix != null && ix === iy;
}

export type StudentVerdict = {
  student: string;
  /**
   * ok         — 원아 정확히 1명(발송 가능)
   * dup_account— 후보 2명+인데 **생년이 같다** = 같은 아이의 계정 둘(부모·본인). 워커가 전원에게 게시 = 의도된 동작.
   * conflict   — 후보 2명+에 생년이 갈린다 = 🔴 다른 아이에게도 갈 수 있다.
   * missing    — 보드에 없음. 발송이 **실패**한다(오발송은 아님 = fail-safe).
   */
  kind: "ok" | "dup_account" | "conflict" | "missing";
  children: string[];
  /** missing일 때만 — 이름만 다른 것으로 보이는 보드 원아(있으면 classnote_name 오버라이드로 해결). */
  hint?: string;
};

export type ClassCheck = {
  classId: string;
  className: string;
  teacher: string | null;
  board: { id: number; name: string } | null;
  /**
   * no_board/dup_board — 보드를 특정 못 함(학생 판정 불가)
   * empty_board        — 보드는 있는데 원아 0명(학부모 미가입·미배정: 반 전체가 발송 불가)
   * issues / ok        — 학생 단위 판정 결과
   */
  status: "ok" | "issues" | "empty_board" | "no_board" | "dup_board";
  students: StudentVerdict[];
  /** 보드엔 있는데 eywa 이 반 수강이 아닌 원아 — 퇴원·타반·형제 계정일 수 있다. 강사가 반 보드에 직접 쓴 글은 **이들에게도 간다.** */
  extras: string[];
  problems: number;
};

/** 반별 대조. `boards`는 스냅샷 전건, `keyOf`는 반 이름/보드 이름을 같은 비교키로 만드는 함수(english-writing의 classKey/boardKey). */
export function checkClassRosters(
  classes: readonly ClassRoster[],
  boards: readonly BoardSnapshot[],
  keyOf: { class: (name: string) => string; board: (name: string) => string },
): ClassCheck[] {
  const byKey = new Map<string, BoardSnapshot[]>();
  for (const b of boards) {
    const k = keyOf.board(b.boardName);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(b);
    byKey.set(k, list);
  }

  return classes.map((c) => {
    const cands = byKey.get(keyOf.class(c.className)) ?? [];
    if (cands.length === 0)
      return { ...base(c), board: null, status: "no_board" as const, students: [], extras: [], problems: c.students.length };
    if (cands.length > 1)
      return {
        ...base(c),
        board: { id: cands[0]!.boardId, name: cands[0]!.boardName },
        status: "dup_board" as const,
        students: [],
        extras: [],
        problems: c.students.length,
      };

    const board = cands[0]!;
    const used = new Set<number>();
    const students: StudentVerdict[] = c.students.map((s) => {
      const hit = matchMembers(s, board.members);
      for (const h of hit) used.add(h.childId);
      const names = hit.map((h) => h.childName);
      if (hit.length === 1) return { student: s, kind: "ok", children: names };
      if (hit.length === 0) return { student: s, kind: "missing", children: [] };
      const years = new Set(hit.map((h) => h.birthYear).filter((y): y is number => y != null));
      // 생년을 하나도 모르면 같은 아이라 단정할 수 없다 — 안전한 쪽(conflict)으로 본다.
      return { student: s, kind: years.size === 1 ? "dup_account" : "conflict", children: names };
    });

    const extras = board.members.filter((m) => !used.has(m.childId)).map((m) => m.childName);
    // 미배정 학생에게 "이름만 다른 원아" 힌트를 단다(남는 원아 중에서만 — 이미 매칭된 원아는 후보가 아니다).
    for (const v of students) {
      if (v.kind !== "missing") continue;
      const near = extras.find((e) => looksLikeSameName(v.student, e));
      if (near) v.hint = near;
    }

    const problems = students.filter((s) => s.kind !== "ok").length;
    const status = board.members.length === 0 ? "empty_board" : problems > 0 ? "issues" : "ok";
    return { ...base(c), board: { id: board.boardId, name: board.boardName }, status, students, extras, problems };
  });
}

function base(c: ClassRoster) {
  return { classId: c.classId, className: c.className, teacher: c.teacher };
}

/** 화면 상단 요약 — 문제 있는 것부터 세고, "전부 정상"도 명시적으로 셀 수 있게. */
export function summarize(checks: readonly ClassCheck[]) {
  let ok = 0, missing = 0, conflict = 0, dupAccount = 0, extras = 0, classesWithIssue = 0;
  for (const c of checks) {
    if (c.status !== "ok") classesWithIssue++;
    extras += c.extras.length;
    for (const s of c.students) {
      if (s.kind === "ok") ok++;
      else if (s.kind === "missing") missing++;
      else if (s.kind === "conflict") conflict++;
      else dupAccount++;
    }
    // 보드를 못 찾은 반은 학생 판정이 없다 — 전원 미확인으로 센다(0으로 두면 문제가 사라져 보인다).
    if (c.status === "no_board" || c.status === "dup_board") missing += c.problems;
  }
  return { classes: checks.length, classesWithIssue, ok, missing, conflict, dupAccount, extras };
}
