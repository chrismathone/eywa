/**
 * JJ 폼 **이어받기** — '내용 복사 (지난 수업)'가 계획뿐 아니라 학생별 **듣기 레벨·누적 암기 단어수**를
 * 지난 기록에서 채운다(직원 요청 2026-08-19: *"JJ실 양식에 전수업 복사하면 듣기 레벨이랑 누적 단어수도
 * 복사되게 할 수 있나요… 듣기 레벨은 한번씩 바뀌는 거라서 지난시간 거 찾아서 일일이 베껴적는 게 힘드네요"*).
 *
 * 🔑 이 두 칸만 이어받는 이유 = **성질이 이어지는 값**이라서다. 듣기 레벨은 한 번 정하면 한동안 유지되고,
 *    누적 단어수는 말 그대로 누적이라 지난 값이 오늘의 시작점이다. 반대로 '시험 점수'는 그 수업의 결과라
 *    이어받으면 **없던 점수를 지어내는 것**이 되므로 절대 대상이 아니다(폼이 default면 아무것도 안 한다).
 *
 * 🔴 **덮어쓰지 않는다** — 이미 쓴 칸은 그대로 두고 빈 칸만 채운다(0209a 계획 복사와 같은 계약).
 * 🔴 **명단(그날 그 반 수강생) 밖 학생에겐 행을 만들지 않는다.** 마크 행이 생기면 그 학생이 로스터
 *    합집합과 자리 각주 건수에 계속 잡힌다(`upsertStudentMark`가 빈 행을 지우는 이유와 같다).
 * ⚠️ 이어받은 값은 **지난 값**이다 — 바뀐 학생은 사람이 고쳐야 하므로 호출부가 몇 명 채웠는지 알린다
 *    (조용히 채우면 옛 레벨이 오늘 값처럼 굳는다).
 *
 * 순수 모듈 — IO는 [`server/carry-marks.ts`](../server/carry-marks.ts)가 맡고 규칙은 여기서 Vitest가 잠근다.
 */

/** 이어받는 칸 — JJ 폼의 자유 입력 두 칸([`roster-form.ts`](./roster-form.ts) `selfStudy`). */
export const CARRY_FIELDS = ["listeningLevel", "memorizedWords"] as const;
export type CarryField = (typeof CARRY_FIELDS)[number];

/** 그 칸의 화면 라벨 — 토스트 문구가 폼 머리와 **같은 낱말**을 쓰게(각자 적으면 갈린다). */
export const CARRY_FIELD_LABEL: Record<CarryField, string> = {
  listeningLevel: "듣기 레벨",
  memorizedWords: "누적 암기 단어수",
};

export type PastMarkRow = {
  studentId: string;
  /** YYYY-MM-DD */
  markDate: string;
  /** 같은 날 여러 교시가 있을 때의 순서 기준(HH:MM). 옛 기록은 null일 수 있다. */
  slotStart: string | null;
  listeningLevel: string | null;
  memorizedWords: string | null;
};

export type TargetMarkRow = {
  studentId: string;
  listeningLevel: string | null;
  memorizedWords: string | null;
};

export type CarryPatch = {
  studentId: string;
  /**
   * 저장할 값 — **채운 칸 + 이미 있던 칸을 함께** 담는다. 한 번의 upsert로 보내려면 모든 행의 키가
   * 같아야 하고(PostgREST 규약), 그때 안 채운 칸에 null을 넣으면 **남의 값이 지워진다**.
   */
  listeningLevel: string | null;
  memorizedWords: string | null;
  /** 이번에 실제로 채운 칸(빈 칸이었던 것만). */
  filled: CarryField[];
  /** 그 값을 가져온 지난 수업 날짜 — 칸마다 다를 수 있어 **가장 늦은 날**을 싣는다(안내 문구용). */
  sourceDate: string;
};

/** 공백만 있는 칸은 빈 칸이다 — 화면에서 지운 흔적(스페이스)이 "이미 쓴 칸"으로 오인되지 않게. */
function nonEmpty(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * 지난 기록 정렬 키 — (날짜, 교시) 내림차순. 🔑 "가장 최근 한 건"을 **정렬로 흉내 내지 않고**
 * 무엇이 최신인지 규칙으로 적는다([[#112]]: 최신순으로 대표 행을 집으면 하루에 여러 번 있는 축에서
 * 엉뚱한 행이 잡힌다). 같은 날 JJ가 두 교시면 **뒤 교시**가 더 최신이다.
 */
function laterFirst(a: PastMarkRow, b: PastMarkRow): number {
  if (a.markDate !== b.markDate) return a.markDate < b.markDate ? 1 : -1;
  const as = a.slotStart ?? "";
  const bs = b.slotStart ?? "";
  return as < bs ? 1 : as > bs ? -1 : 0;
}

/**
 * 채울 목록을 만든다 — 학생마다 **칸별로** 가장 최근의 비지 않은 값을 찾아, 대상 칸이 비어 있을 때만 채운다.
 *
 * 칸별로 따로 찾는 이유: 지난 수업에 듣기 레벨만 적고 단어수는 안 적는 일이 흔하다. 날짜 하나를 골라
 * 그 날의 두 칸을 함께 쓰면, 단어수가 비어 있던 날이 원본으로 잡혀 **아무것도 못 채운다**.
 */
export function planCarryMarks(args: {
  roster: readonly string[];
  past: readonly PastMarkRow[];
  target: readonly TargetMarkRow[];
}): CarryPatch[] {
  const roster = new Set(args.roster);
  const targetById = new Map(args.target.map((t) => [t.studentId, t]));
  const sorted = [...args.past].filter((r) => roster.has(r.studentId)).sort(laterFirst);

  // studentId → 칸별 최신값(+그 날짜)
  const latest = new Map<string, Partial<Record<CarryField, { value: string; date: string }>>>();
  for (const row of sorted) {
    const cur = latest.get(row.studentId) ?? {};
    for (const field of CARRY_FIELDS) {
      if (cur[field]) continue; // 이미 더 최신 값을 잡았다(sorted가 최신순)
      const v = nonEmpty(row[field]);
      if (v !== null) cur[field] = { value: v, date: row.markDate };
    }
    latest.set(row.studentId, cur);
  }

  const out: CarryPatch[] = [];
  for (const studentId of args.roster) {
    const found = latest.get(studentId);
    if (!found) continue;
    const target = targetById.get(studentId);
    const filled: CarryField[] = [];
    const value: Record<CarryField, string | null> = {
      listeningLevel: nonEmpty(target?.listeningLevel),
      memorizedWords: nonEmpty(target?.memorizedWords),
    };
    let sourceDate = "";
    for (const field of CARRY_FIELDS) {
      const carry = found[field];
      if (!carry) continue;
      if (value[field] !== null) continue; // 이미 쓴 칸 — 덮어쓰기 없음
      value[field] = carry.value;
      filled.push(field);
      if (carry.date > sourceDate) sourceDate = carry.date;
    }
    if (filled.length === 0) continue; // 채울 게 없으면 쓰기도 안 만든다(헛 upsert 금지)
    out.push({
      studentId,
      listeningLevel: value.listeningLevel,
      memorizedWords: value.memorizedWords,
      filled,
      sourceDate,
    });
  }
  return out;
}

/** 그날 그 칸의 출결(정정 접기를 **이미 거친** 유효 행). `slotStart: null` = 교시를 안 따진 옛 기록. */
export type DayAttendance = { studentId: string; slotStart: string | null; status: string };

/** 결석으로 보는 상태 — 지각·조퇴는 수업에 있었으므로 제외 대상이 아니다. */
const ABSENT_STATUS = new Set(["absent", "excused"]);

/**
 * 이어받기 **명단** — 수강 자격이 있는 학생(+그날 출결이 있는 보강생)에서 **그 칸에 결석으로 찍힌
 * 학생을 뺀다.**
 *
 * 🔑 왜 빼나: 이어받기는 "지난 값을 오늘 칸에 적는 것"이라, 오지 않은 아이 칸에 적으면 **수업에 있었던
 *    것처럼 읽히는 기록**이 생긴다. 손으로 적을 때 강사가 그 칸을 비워 두던 것과 같은 판단이다.
 * ⚠️ 출결을 **아직 안 찍은** 칸은 빼지 않는다(모름 ≠ 결석). 나중에 결석으로 바뀌면 강사가 지우면 된다.
 * ⚠️ 교시가 갈린 반은 **그 교시(또는 교시 없는 옛 기록)** 만 본다 — 4교시 결석이 6교시 칸을 막으면 안 된다.
 */
export function carryRoster(args: {
  eligible: readonly string[];
  attendance: readonly DayAttendance[];
  slotStart: string;
}): string[] {
  const base = new Set(args.eligible);
  // 보강(수업외) — 수강행은 없지만 그날 기록이 있으면 폼도 그 칸을 열어준다(upsertStudentMark와 같은 규칙).
  for (const a of args.attendance) base.add(a.studentId);
  for (const a of args.attendance) {
    if (a.slotStart !== null && a.slotStart !== args.slotStart) continue;
    if (ABSENT_STATUS.has(a.status)) base.delete(a.studentId);
  }
  return [...base];
}

/** 토스트 한 조각 — "듣기 레벨 4명 · 누적 암기 단어수 2명". 채운 칸이 없으면 빈 문자열. */
export function carrySummary(patches: readonly CarryPatch[]): string {
  const counts = CARRY_FIELDS.map((f) => ({
    label: CARRY_FIELD_LABEL[f],
    n: patches.filter((p) => p.filled.includes(f)).length,
  })).filter((c) => c.n > 0);
  return counts.map((c) => `${c.label} ${c.n}명`).join(" · ");
}
