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
