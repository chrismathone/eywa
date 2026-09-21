/**
 * aywa 반 로스터 ↔ ClassNote 반 보드 원아 대조 — 순수 함수(Vitest).
 *
 * 왜: 영어는 학생 1인 보드가 아니라 **반 보드**로 운영된다. 그래서 aywa에서 반을 옮기거나 신입이
 * 들어와도 ClassNote 보드는 따라오지 않고, 그 학생은 **발송이 조용히 실패**한다. 2026-07-23 실측
 * 학생-반 248건 중 30건(12%)이 그 상태였다. 반 이동·신입·퇴원 때마다 재발하므로 상시 점검이 필요하다.
 *
 * 판정 단위 = (반, 학생). 결과는 **사실만** 말하고 자동 수정은 하지 않는다 —
 * ClassNote 배정은 학부모 초대가 얽혀 있어 사람이 판단해야 한다.
 *
 * 이름이 서로 다른 경우(학부모가 `박서연E`를 `서연`으로 등록)는 **고정 연결(pin, 0145a)** 로 푼다.
 * ⚠️ pin은 오발송으로 직결되므로 여기서 **매번 재검증**한다(연결해 둔 원아가 지금도 그 보드에 있는가).
 */

/** ClassNote 원아 1명(스냅샷). */
export type BoardMember = { childId: number; childName: string; birthYear: number | null };
/** ClassNote 반 보드 1개 + 원아. */
export type BoardSnapshot = { boardId: number; boardName: string; members: BoardMember[] };
/** aywa 재원생 1명 — 유효이름(classnote_name || name) + 학년(생년 대조용). */
export type RosterStudent = { studentId: string; name: string; grade: string | null };
/** aywa 반 1개 + 재원 로스터. */
export type ClassRoster = { classId: string; className: string; teacher: string | null; students: RosterStudent[] };
/** 저장된 고정 연결(0145a). */
export type ChildLink = { studentId: string; boardId: number; childId: number; childNameAtLink: string };

// ── 생년 대조 ────────────────────────────────────────────────────────────────
// ⚠️ **워커 board-safety.mjs의 GRADE_AGE_OFFSET/expectedBirthYear와 같은 규칙이어야 한다.**
//    (.mjs+playwright라 import로 공유가 안 돼 이식했다. board-roster-diff.test.ts가 규칙을 고정한다.)

const GRADE_AGE_OFFSET: Record<string, number> = {
  초1: 7, 초2: 8, 초3: 9, 초4: 10, 초5: 11, 초6: 12,
  중1: 13, 중2: 14, 중3: 15,
  고1: 16, 고2: 17, 고3: 18,
};
/** 조기입학·유급·학부모 오입력(자기 생일을 1년 틀리게 넣은 실측 사례)을 흡수. */
export const BIRTH_YEAR_TOLERANCE = 1;

/** aywa 학년 → 기대 출생연도. 모르는 학년이면 null(= 대조 불가 = 연결 금지). */
export function expectedBirthYear(grade: string | null | undefined, schoolYear: number): number | null {
  const off = GRADE_AGE_OFFSET[String(grade ?? "").trim()];
  if (off == null) return null;
  return Number.isFinite(schoolYear) && schoolYear > 1900 ? schoolYear - off : null;
}

/** KST 기준 학년도 — 3월 시작(1~2월은 전 학년도). */
export function kstSchoolYear(now: Date = new Date()): number {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  return (m ?? 1) >= 3 ? y! : y! - 1;
}

/**
 * 이 원아를 이 학생으로 **연결해도 되는가**(생년 대조).
 *
 * 🔴 오발송 방지의 마지막 관문이다. **모르면 거부**한다 — 생년이 없거나 학년을 모르면
 * "아마 맞겠지"로 넘기지 않는다(그렇게 남의 집에 성적표가 갔던 전례가 있다 — 김서윤·김채은).
 */
export function birthYearMatches(grade: string | null | undefined, birthYear: number | null, schoolYear: number): boolean {
  const want = expectedBirthYear(grade, schoolYear);
  if (want == null || birthYear == null) return false;
  return Math.abs(birthYear - want) <= BIRTH_YEAR_TOLERANCE;
}

/**
 * ClassNote 원아 표시명 → 매칭 키 집합.
 *
 * ⚠️ **워커 `childKeys`(scripts/_classnote/classnote-admin-core.mjs)와 같은 규칙이어야 한다.**
 * 저쪽은 실제 발송 대상을 고르고 여기는 그 결과를 예고한다 — 어긋나면 화면이 거짓말을 한다.
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
    if (at >= 0) return false;
    at = i;
  }
  if (at < 0) return false;
  const ix = initialConsonant(x[at]!);
  const iy = initialConsonant(y[at]!);
  return ix != null && ix === iy;
}

/** 연결 버튼을 띄울 수 있는 원아 — **생년이 맞는 것만** 오른다. */
export type PinCandidate = { childId: number; childName: string; birthYear: number | null; nameHint: boolean };

export type StudentVerdict = {
  studentId: string;
  student: string;
  /**
   * ok         — 원아 정확히 1명(발송 가능). 이름 매칭 또는 고정 연결.
   * dup_account— 후보 2명+인데 **생년이 같다** = 같은 아이의 계정 둘(부모·본인). 워커가 전원에게 게시 = 의도된 동작.
   * conflict   — 후보 2명+에 생년이 갈린다 = 🔴 다른 아이에게도 갈 수 있다.
   * missing    — 보드에 없음. 발송이 **실패**한다(오발송은 아님 = fail-safe).
   */
  kind: "ok" | "dup_account" | "conflict" | "missing";
  children: string[];
  /** 고정 연결로 풀린 건가(이름이 아니라 사람이 확정한 것). renamed=연결 후 원아명이 바뀜. */
  pinned?: { childId: number; childName: string; renamed: boolean };
  /** 연결이 저장돼 있었으나 **재검증에 실패**해 무시했다 — 화면이 이유를 말해야 한다. */
  pinBroken?: string;
  /** missing일 때만 — 이름만 다른 것으로 보이는 보드 원아(힌트). */
  hint?: string;
  /** missing일 때만 — 생년이 맞아 연결 버튼을 띄울 수 있는 원아. 비면 버튼 없음. */
  pinCandidates?: PinCandidate[];
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
  /** 보드엔 있는데 aywa 이 반 수강이 아닌 원아 — 퇴원·타반·형제 계정일 수 있다. 강사가 반 보드에 직접 쓴 글은 **이들에게도 간다.** */
  extras: string[];
  problems: number;
};

/** 반별 대조. `keyOf`는 반 이름/보드 이름을 같은 비교키로 만드는 함수(english-writing의 classKey/boardKey). */
export function checkClassRosters(
  classes: readonly ClassRoster[],
  boards: readonly BoardSnapshot[],
  keyOf: { class: (name: string) => string; board: (name: string) => string },
  opts: { links?: readonly ChildLink[]; schoolYear?: number } = {},
): ClassCheck[] {
  const schoolYear = opts.schoolYear ?? kstSchoolYear();
  const linkByStudentBoard = new Map<string, ChildLink>();
  for (const l of opts.links ?? []) linkByStudentBoard.set(`${l.studentId}|${l.boardId}`, l);

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
    const byChildId = new Map(board.members.map((m) => [m.childId, m]));
    // 이 보드에서 **연결로 이미 임자가 있는** 원아 — 다른 학생의 이름 매칭에서 제외한다(뺏김 방지).
    const claimed = new Set<number>();
    for (const s of c.students) {
      const l = linkByStudentBoard.get(`${s.studentId}|${board.boardId}`);
      if (l && byChildId.has(l.childId)) claimed.add(l.childId);
    }

    const used = new Set<number>();
    const students: StudentVerdict[] = c.students.map((s) => {
      const link = linkByStudentBoard.get(`${s.studentId}|${board.boardId}`);
      if (link) {
        const live = byChildId.get(link.childId);
        // 🔴 재검증 — 연결해 둔 원아가 **지금도 이 보드에 있어야** 쓴다. 사라졌으면 연결을 무시하고
        //    미배정으로 되돌린다(그 사이 반이 바뀌었을 수 있다. 의심스러우면 안 보낸다).
        if (!live) {
          return {
            studentId: s.studentId,
            student: s.name,
            kind: "missing" as const,
            children: [],
            pinBroken: `연결해 둔 원아(${link.childNameAtLink})가 이 보드에 더 이상 없습니다`,
            pinCandidates: candidatesFor(s, board.members, used, claimed, schoolYear),
          };
        }
        used.add(live.childId);
        return {
          studentId: s.studentId,
          student: s.name,
          kind: "ok" as const,
          children: [live.childName],
          pinned: { childId: live.childId, childName: live.childName, renamed: live.childName !== link.childNameAtLink },
        };
      }

      const hit = matchMembers(s.name, board.members).filter((m) => !claimed.has(m.childId));
      for (const h of hit) used.add(h.childId);
      const names = hit.map((h) => h.childName);
      if (hit.length === 1) return { studentId: s.studentId, student: s.name, kind: "ok" as const, children: names };
      if (hit.length === 0)
        return {
          studentId: s.studentId,
          student: s.name,
          kind: "missing" as const,
          children: [],
          pinCandidates: candidatesFor(s, board.members, used, claimed, schoolYear),
        };
      const years = new Set(hit.map((h) => h.birthYear).filter((y): y is number => y != null));
      // 생년을 하나도 모르면 같은 아이라 단정할 수 없다 — 안전한 쪽(conflict)으로 본다.
      return {
        studentId: s.studentId,
        student: s.name,
        kind: (years.size === 1 ? "dup_account" : "conflict") as "dup_account" | "conflict",
        children: names,
      };
    });

    const extras = board.members.filter((m) => !used.has(m.childId)).map((m) => m.childName);
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

/**
 * 연결 후보 — **생년이 맞는 미배정 원아만.** 이 목록이 비면 화면에 버튼이 안 뜬다.
 * 이미 다른 학생이 이름으로 잡았거나(used) 연결로 임자가 있는(claimed) 원아는 후보에서 뺀다.
 */
function candidatesFor(
  s: RosterStudent,
  members: readonly BoardMember[],
  used: ReadonlySet<number>,
  claimed: ReadonlySet<number>,
  schoolYear: number,
): PinCandidate[] {
  return members
    .filter((m) => !used.has(m.childId) && !claimed.has(m.childId))
    .filter((m) => birthYearMatches(s.grade, m.birthYear, schoolYear))
    .map((m) => ({ childId: m.childId, childName: m.childName, birthYear: m.birthYear, nameHint: looksLikeSameName(s.name, m.childName) }))
    // 이름까지 비슷한 후보를 먼저 — 사람이 고를 때 오선택을 줄인다.
    .sort((a, b) => Number(b.nameHint) - Number(a.nameHint) || a.childName.localeCompare(b.childName, "ko"));
}

function base(c: ClassRoster) {
  return { classId: c.classId, className: c.className, teacher: c.teacher };
}

/** 화면 상단 요약 — 문제 있는 것부터 세고, "전부 정상"도 명시적으로 셀 수 있게. */
export function summarize(checks: readonly ClassCheck[]) {
  let ok = 0, missing = 0, conflict = 0, dupAccount = 0, extras = 0, classesWithIssue = 0, pinned = 0;
  for (const c of checks) {
    if (c.status !== "ok") classesWithIssue++;
    extras += c.extras.length;
    for (const s of c.students) {
      if (s.pinned) pinned++;
      if (s.kind === "ok") ok++;
      else if (s.kind === "missing") missing++;
      else if (s.kind === "conflict") conflict++;
      else dupAccount++;
    }
    // 보드를 못 찾은 반은 학생 판정이 없다 — 전원 미확인으로 센다(0으로 두면 문제가 사라져 보인다).
    if (c.status === "no_board" || c.status === "dup_board") missing += c.problems;
  }
  return { classes: checks.length, classesWithIssue, ok, missing, conflict, dupAccount, extras, pinned };
}
