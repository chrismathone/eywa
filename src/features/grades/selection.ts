/**
 * 주소(또는 폼)의 값 → **성적 화면이 고른 축 한 벌**. 순수 함수 — 화면·엑셀 라우트·저장 액션이
 * 같은 해석을 쓴다(한쪽만 규칙을 새로 적으면 내려받은 시트가 화면과 다른 칸을 가리킨다).
 *
 * 🔴 모르는 값은 **거절이 아니라 폴백**이다 — 주소 한 글자 때문에 성적 화면이 빈 화면이 되면 안 된다.
 *    대신 폴백한 값은 그대로 화면 드롭다운에 비치므로 사람이 바로 알아본다.
 */

import type { GradeSelection } from "./types";
import { GRADE_MAX_SCORE_DEFAULT, GRADE_MAX_SCORE_LIMIT } from "./types";
import { examSlotsFor, normalizeExamSlot } from "./exam-slots";
import { firstAxisOf, parseAxisValue } from "./subject-axis";
import { defaultExamDate, defaultTermOf, normalizeTerm, normalizeYear, termWindow } from "./term";

export type RawGradeParams = {
  year?: unknown;
  term?: unknown;
  /** 과목 축 값 — `math` · `english:eie` · `english:injaewon`. */
  subject?: unknown;
  class?: unknown;
  slot?: unknown;
  date?: unknown;
  max?: unknown;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 같은 이름의 주소 값이 두 번 오면 배열이 된다 — 문자열일 때만 읽는다(옆 화면들과 같은 규약). */
const one = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function resolveGradeSelection(
  raw: RawGradeParams,
  opts: {
    /** 학원설정 과목 옵션(`buildSubjectMaps(...).options`) — 단일 소스. */
    subjectOptions: readonly { value: string; label: string }[];
    todayIso: string;
  },
): GradeSelection | null {
  const fallbackAxis = firstAxisOf(opts.subjectOptions);
  if (!fallbackAxis) return null; // 등록된 과목이 없다 — 화면이 "과목을 먼저 등록" 안내를 낸다.

  const keys = opts.subjectOptions.map((o) => o.value);
  const axis = parseAxisValue(one(raw.subject), keys) ?? fallbackAxis;

  const today = defaultTermOf(opts.todayIso);
  const year = normalizeYear(one(raw.year), today.year);
  const term = normalizeTerm(one(raw.term), today.term);
  const slot = normalizeExamSlot(axis.subject, one(raw.slot));

  const classRaw = one(raw.class);
  const classId = UUID.test(classRaw) ? classRaw : null;

  const dateRaw = one(raw.date);
  const { start, end } = termWindow(year, term);
  // 🔴 시험일은 학기 밖으로 못 나간다 — 나가면 그 성적이 다른 학기 화면에서만 보인다(칸은 학기가 정하는데
  //    날짜는 딴 곳을 가리키는 어긋남). 형식이 틀리면 기본값(오늘을 학기 안으로 누른 날).
  const date =
    ISO_DATE.test(dateRaw) && dateRaw >= start && dateRaw <= end
      ? dateRaw
      : defaultExamDate(year, term, opts.todayIso);

  const maxRaw = Number(one(raw.max));
  const maxScore =
    Number.isFinite(maxRaw) && maxRaw > 0 && maxRaw <= GRADE_MAX_SCORE_LIMIT
      ? Math.round(maxRaw)
      : GRADE_MAX_SCORE_DEFAULT;

  return { year, term, subject: axis.subject, track: axis.track, classId, slot, date, maxScore };
}

/** 그 과목에 실제로 있는 시험 칸인지(액션이 폼 값을 다시 볼 때). */
export function selectionSlotIsValid(sel: GradeSelection): boolean {
  return examSlotsFor(sel.subject).includes(sel.slot);
}
