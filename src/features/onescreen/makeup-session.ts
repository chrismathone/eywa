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

export function makeupSessionEntries(progress: unknown): MakeupSessionEntry[] {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return [];
  return Object.entries(progress).flatMap(([key, value]) => {
    if (!key.startsWith("makeup::") || !key.slice(8).trim() || !value || typeof value !== "object" || value.makeup !== true) return [];
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

export function addMakeupSessionEntries(progress: SessionProgress, entries: MakeupSessionEntry[]): SessionProgress {
  const next = { ...progress };
  for (const { subject, ...entry } of entries) {
    const key = `makeup::${subject}`;
    // 재시도·중복 클릭은 입력해 둔 내용이나 최초 결석분 연결을 덮지 않는다.
    if (next[key]?.makeup === true) continue;
    next[key] = { ...next[key], ...entry, makeup: true };
  }
  return next;
}

/** 다른 창의 자동저장이 아직 모르는 보강 명단을 지우지 않는다. 삭제는 명시적인 '보강 빼기'에서만. */
export function preserveMakeupSessionEntries(existing: SessionProgress, incoming: SessionProgress): SessionProgress {
  const next = { ...incoming };
  for (const [key, entry] of Object.entries(existing)) {
    if (key.startsWith("makeup::") && entry?.makeup === false) next[key] = { makeup: false };
  }
  for (const { subject } of makeupSessionEntries(existing)) {
    const key = `makeup::${subject}`;
    next[key] = { ...existing[key], ...incoming[key], makeup: true };
  }
  return next;
}
