/** 보강 명단은 보고서 저장 전에도 세션에 남긴다. 정규 반 키와 섞이지 않는 기존 makeup:: 키를 쓴다. */
export type MakeupSessionEntry = {
  subject: string;
  makeupClassId?: string | null;
  makeupClassName?: string | null;
  absentDate?: string | null;
  absentClassId?: string | null;
  units?: number;
};

export type SessionProgress = Record<string, Record<string, unknown>>;

/**
 * 🔴 **명단 등록은 등록 문만** — `registerMakeupEntries`('+ 보강 학생 추가'·'따로 보내기')가 `addMakeupSessionEntries`로 세운다.
 * 자동저장이 보내는 `makeup::과목` 칸은 **내용 보관**(진도·멘트 — 새로고침 복원)일 뿐이라 `draftOnly`로 적고 명단으로 읽지 않는다.
 * 원장 2026-10-27 박지호 건: 보강 **예약**에서 선 '(보강)' 줄을 자동저장이 반 없는 등록으로 적어, 새로고침 때 예약 줄보다 먼저
 * '반 미정' 보강 줄이 섰다 — '정규에 합치기'가 "다른 반에 기록돼 있어"로 막혔고, 예약을 정규 반 '함께'로 옮긴 뒤에도 그 줄이 남았다.
 * 예약·출석부 보강 칸·보강 보고서에서 선 줄은 그 원천이 다시 세운다(원천이 사라지면 줄도 사라져야 한다 — 남으면 취소된 보강이 시수로 선다).
 * 옛 칸(`draftOnly` 없음)은 그대로 명단이다.
 */
function isRegisteredEntry(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as Record<string, unknown>).makeup === true && (value as Record<string, unknown>).draftOnly !== true;
}

export function makeupSessionEntries(progress: unknown): MakeupSessionEntry[] {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return [];
  return Object.entries(progress).flatMap(([key, value]) => {
    if (!key.startsWith("makeup::") || !key.slice(8).trim() || !value || typeof value !== "object" || !isRegisteredEntry(value)) return [];
    return [{
      subject: key.slice(8),
      makeupClassId: typeof value.makeupClassId === "string" ? value.makeupClassId : null,
      makeupClassName: typeof value.makeupClassName === "string" ? value.makeupClassName : null,
      absentDate: typeof value.absentDate === "string" ? value.absentDate : null,
      absentClassId: typeof value.absentClassId === "string" ? value.absentClassId : null,
      ...(typeof value.units === "number" ? { units: value.units } : {}),
    }];
  });
}

/** 그 과목이 이미 명단에 있나 — 내용 보관 칸(`draftOnly`)은 등록이 아니다. */
export function hasMakeupSessionEntry(progress: SessionProgress, subject: string): boolean {
  return isRegisteredEntry(progress[`makeup::${subject}`]);
}

export function addMakeupSessionEntries(progress: SessionProgress, entries: MakeupSessionEntry[]): SessionProgress {
  const next = { ...progress };
  for (const { subject, ...entry } of entries) {
    const key = `makeup::${subject}`;
    // 재시도·중복 클릭은 입력해 둔 내용이나 최초 결석분 연결을 덮지 않는다.
    if (isRegisteredEntry(next[key])) continue;
    // 내용 보관 칸(`draftOnly`)은 등록이 아니다 — 새 등록으로 갈아 끼운다. 합친 뒤 '따로 보내기'로 다시 세운 줄에 옛 보강 줄 글이
    // 되살아나면 정규 줄에 이어 붙인 글과 두 번 나간다('보강 빼기' 표시 위에 등록할 때와 같은 빈 줄).
    next[key] = next[key]?.draftOnly === true ? { ...entry, makeup: true } : { ...next[key], ...entry, makeup: true };
  }
  return next;
}

/**
 * 다른 창의 자동저장이 아직 모르는 보강 명단을 지우지 않는다. 삭제는 명시적인 '보강 빼기'에서만.
 * 자동저장이 처음 보내는 `makeup::` 칸(명단에 없던 과목)은 내용 보관 칸(`draftOnly`)으로만 남긴다 — 위 `isRegisteredEntry` 주석.
 */
export function preserveMakeupSessionEntries(existing: SessionProgress, incoming: SessionProgress): SessionProgress {
  const next = { ...incoming };
  for (const [key, entry] of Object.entries(incoming)) {
    if (key.startsWith("makeup::") && entry?.makeup === true && !isRegisteredEntry(existing[key])) next[key] = { ...entry, draftOnly: true };
  }
  for (const [key, entry] of Object.entries(existing)) {
    if (key.startsWith("makeup::") && entry?.makeup === false) next[key] = { makeup: false };
  }
  for (const { subject } of makeupSessionEntries(existing)) {
    const key = `makeup::${subject}`;
    next[key] = { ...existing[key], ...incoming[key], makeup: true };
  }
  return next;
}
