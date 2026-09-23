import { GRADE_MARK_KEYS, type GradeMarkKey } from "./types";

/**
 * **이 칸을 DB에 남길 것인가** — 점수도 표식도 '시험없음'도 없으면 행이 존재할 이유가 없어 지운다.
 *
 * 🔴 판정은 **저장 뒤의 최종 상태**로 한다. 저장이 보내는 표식은 *바뀐 키만* 실린 부분 패치라,
 *    패치만 보고 지우면 **이 저장이 건드리지도 않은 표식이 함께 사라진다**:
 *    · 월말평가는 2차상담·성적확인 열을 감추므로 그 값은 아예 패치에 안 온다(원장 2026-09-23).
 *    · 감추지 않는 화면에서도 "켜져 있던 표식은 안 싣는다"(`*_by`가 저장한 사람으로 덮이는 것을 막으려고)
 *      → `점수 80 + 2차상담 켜짐`에서 점수만 지우면 패치가 `{score:null}`뿐이라 2차상담이 통째로 날아갔다
 *      (적대적 리뷰 2026-09-23에서 잡은 **기존** 결함 — 월말평가 이전부터 있었다).
 * 🔴 `otherMarks`는 **삭제 판정에만** 쓰고 절대 쓰지 않는다(쓰면 남의 `*_by`를 덮는다).
 */
export type GradeKeepInput = {
  score: number | null;
  /** 이번 저장이 바꾸는 표식만(키가 없으면 '안 건드림'). 값은 시각 또는 null(끔). */
  marks?: Partial<Record<GradeMarkKey, string | null>>;
  noExam?: boolean;
  /** 이 저장이 **안 건드리는데 이미 켜져 있는** 표식이 있는가(호출부가 방금 읽은 DB 값). */
  otherMarks?: boolean;
};

export function gradeCellKeeps(r: GradeKeepInput): boolean {
  if (r.score != null) return true;
  if (r.noExam === true) return true;
  if (GRADE_MARK_KEYS.some((k) => !!r.marks?.[k])) return true;
  return r.otherMarks === true;
}

/**
 * 이번 패치가 안 건드리는데 DB엔 켜져 있는 표식이 있는가 — `otherMarks`에 넣을 값.
 * @param dbMarks 방금 읽은 DB 상태(켜짐 여부)
 * @param patch 이번에 실을 표식 패치(없으면 전부 '안 건드림')
 */
export function hasUntouchedMark(
  dbMarks: Partial<Record<GradeMarkKey, unknown>>,
  patch: Partial<Record<GradeMarkKey, string | null>> | undefined,
): boolean {
  return GRADE_MARK_KEYS.some((k) => !!dbMarks[k] && patch?.[k] === undefined);
}
