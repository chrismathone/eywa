import { normalizeEditValue } from "./consultation-edit";

/**
 * 신규 콜&상담 수정 = **이 사람이 바꾼 칸만 저장**(원장 2026-10-26 *"권장으로 진행"* — 동시 수정에서 나중 저장이 앞 저장을 덮던 것).
 * 실제로 있었던 일: 정유진 님이 먼저 열어 둔 화면으로 저장해 박소선 님이 막 저장한 상담자 칸을 빈칸으로 덮었다(김재윤 상담, 10-26 16:02).
 *
 * 화면이 **수정 화면을 연 때의 폼 값**(`editBase`)을 함께 보내고, 서버는 같은 변환(`buildConsultationRow`)을 거친 두 행을 견줘
 * 달라진 칸만 쓴다. 달라지지 않은 칸은 DB의 지금 값(그사이 다른 사람이 저장한 값)을 그대로 둔다.
 *  · 같은 칸을 둘 다 고쳤으면 나중 저장이 이긴다(종전과 같다).
 *  · 과목 상담(`subject_details`)은 과목·칸 단위로 합친다 — 한 사람은 영어 점수, 다른 사람은 수학 메모를 넣어도 둘 다 남는다.
 *  · `editBase`가 없거나 읽을 수 없으면(배포 전에 열린 화면) 종전처럼 전체를 쓴다.
 * 순수 함수 — 서버 액션이 부른다.
 */

type Row = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(normalizeEditValue(a)) === JSON.stringify(normalizeEditValue(b));

/** 화면을 연 때(base)와 지금(mine) — 달라진 칸 이름. `subject_details`는 따로 합친다(`mergeSubjectDetails`). */
export function changedColumns(mine: Row, base: Row): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(mine)) {
    if (key === "subject_details") continue;
    if (!same(mine[key], base[key])) out.add(key);
  }
  return out;
}

type Details = Record<string, Record<string, unknown>>;
const isDetails = (v: unknown): v is Details =>
  !!v && typeof v === "object" && !Array.isArray(v)
  && Object.values(v).every((s) => !!s && typeof s === "object" && !Array.isArray(s));

/**
 * 과목 상담 합치기 — DB의 지금 값(current) 위에 **이 사람이 바꾼 과목·칸만** 얹는다.
 * @returns 바꾼 칸이 없으면 `changed: false`(그 칸을 쓰지 않는다). 모양을 모르면 종전처럼 이 사람 값을 통째로.
 */
export function mergeSubjectDetails(current: unknown, base: unknown, mine: unknown): { changed: false } | { changed: true; value: unknown } {
  if (same(mine, base)) return { changed: false };
  const b = base ?? {};
  const m = mine ?? {};
  if (!isDetails(b) || !isDetails(m)) return { changed: true, value: mine };
  const out: Details = {};
  if (isDetails(current)) for (const [subject, fields] of Object.entries(current)) out[subject] = { ...fields };
  for (const subject of new Set([...Object.keys(b), ...Object.keys(m)])) {
    const bf = b[subject] ?? {};
    const mf = m[subject] ?? {};
    for (const field of new Set([...Object.keys(bf), ...Object.keys(mf)])) {
      if (same(mf[field], bf[field])) continue;
      const next = { ...(out[subject] ?? {}) };
      if (field in mf) next[field] = mf[field];
      else delete next[field];
      out[subject] = next;
    }
  }
  return { changed: true, value: out };
}

/**
 * 후속 조치 판정에 넣을 값 — 이 사람이 **건드리지 않은** 상태·날짜는 DB의 지금 값을 따른다.
 *  · 날짜를 안 바꿨으면 DB의 지금 날짜(그사이 다른 사람이 옮겼을 수 있다 — 옛 날짜로 '지났다'에 막히지 않게)
 *  · 후속 조치를 안 바꿨는데 그사이 상태 칸이 달라졌으면 고르지 않은 것으로(다른 사람이 정한 상태를 되돌리지 않는다)
 */
export function effectiveFollowUp<R extends string>(input: {
  mineResult: R | null;
  baseResult: R | null;
  mineDate: string | null;
  baseDate: string | null;
  storedDate: string | null;
  /** DB 지금 상태의 칸(상담 전·상담 완료·미등록·등록 완료). */
  storedStage: string;
}): { result: R | null; followUpDate: string | null } {
  const followUpDate = input.mineDate === input.baseDate ? input.storedDate : input.mineDate;
  const untouched = input.mineResult === input.baseResult;
  const result = untouched && input.baseResult !== null && input.baseResult !== input.storedStage ? null : input.mineResult;
  return { result, followUpDate };
}

/** 화면이 보낸 `editBase`(JSON 객체, 값은 글자) — 못 읽으면 null(종전처럼 전체 저장). */
export function parseEditBase(raw: FormDataEntryValue | null): Record<string, string> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (typeof val === "string") out[k] = val;
    return out;
  } catch {
    return null;
  }
}
