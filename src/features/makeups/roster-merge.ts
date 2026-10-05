/** 예약·참여·추가 지도를 화면에서 구분한다. 영어 화면은 영어만 쓴다. */
export function rosterOriginLabel(origin: "reservation" | "native" | "additional", lang: "ko" | "en" = "ko"): string {
  if (lang === "en") {
    if (origin === "native") return "participation";
    if (origin === "additional") return "additional lesson";
    return "reservation";
  }
  if (origin === "native") return "보강 참여";
  if (origin === "additional") return "추가 지도";
  return "보강 예약";
}

/** 반이 없는 참여는 반 명단에 올리지 않는다. 이미 있는 학생·반은 한 번만 둔다. */

export function addedClassPairs(
  existing: ReadonlySet<string>,
  native: readonly { studentId: string; classId: string | null; status: string }[],
): { studentId: string; classId: string }[] {
  const seen = new Set(existing);
  const added: { studentId: string; classId: string }[] = [];
  for (const row of native) {
    if (!row.classId || row.status === "cancelled") continue;
    const key = `${row.studentId}|${row.classId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ studentId: row.studentId, classId: row.classId });
  }
  return added;
}

/**
 * 그 강사가 **맡은** 보강 회차의 참여(학생·출결 반). 출결 반이 그 강사의 담당 반이 아니어도 명단에 세울 근거다.
 * `teacherId` = 명단의 강사 축(다른 강사 뷰면 그 강사). 남이 맡은 회차·취소·반 없는 참여는 빠진다 —
 * 지점 전체 읽기 계정은 지점의 참여를 전부 받으므로, 이 거름이 없으면 관계없는 학생이 명단에 선다.
 */
export function conductedPairs(
  native: readonly { studentId: string; classId: string | null; status: string; teacherId: string | null }[],
  teacherId: string,
): { studentId: string; classId: string }[] {
  if (!teacherId) return [];
  const seen = new Set<string>();
  const pairs: { studentId: string; classId: string }[] = [];
  for (const row of native) {
    if (!row.classId || row.status === "cancelled" || row.teacherId !== teacherId) continue;
    const key = `${row.studentId}|${row.classId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ studentId: row.studentId, classId: row.classId });
  }
  return pairs;
}

/** 맡은 보강의 출결 반 가운데 담당 반이 아닌 것 — 이 반들만 이름·과목을 따로 읽는다(반 전체를 명단에 올리지 않는다). */
export function foreignClassIds(pairs: readonly { classId: string }[], ownClassIds: ReadonlySet<string>): string[] {
  return [...new Set(pairs.map((pair) => pair.classId).filter((id) => !ownClassIds.has(id)))];
}

/**
 * 명단에 세울 참여 = **내 담당 반의 참여**(종전 그대로) ∪ **내가 맡은 회차의 참여**. `foreign` = 출결 반이 내 담당 반이 아니다.
 * 🔴 남의 반은 이름을 알게 됐다고 그 반의 다른 참여까지 세우지 않는다 — 내가 맡은 그 학생만이다.
 */
export function rosterNativePairs(
  existing: ReadonlySet<string>,
  native: readonly { studentId: string; classId: string | null; status: string; teacherId: string | null }[],
  teacherId: string,
  ownClassIds: ReadonlySet<string>,
): { studentId: string; classId: string; foreign: boolean }[] {
  const mine = new Set(conductedPairs(native, teacherId).map((pair) => `${pair.studentId}|${pair.classId}`));
  return addedClassPairs(existing, native)
    .filter((pair) => ownClassIds.has(pair.classId) || mine.has(`${pair.studentId}|${pair.classId}`))
    .map((pair) => ({ ...pair, foreign: !ownClassIds.has(pair.classId) }));
}

export function nativeLessonDraft(row: {
  studentId: string;
  classId: string | null;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
}): { studentId: string; classId: string; date: string; start: string; end: string } | { studentId: string; classId: string; review: string } | null {
  if (!row.classId || row.status === "cancelled") return null;
  const start = row.startTime?.slice(0, 5) ?? "";
  const end = row.endTime?.slice(0, 5) ?? "";
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return { studentId: row.studentId, classId: row.classId, review: "보강 시작 시각을 확인해 주세요" };
  }
  return { studentId: row.studentId, classId: row.classId, date: row.sessionDate, start, end };
}
