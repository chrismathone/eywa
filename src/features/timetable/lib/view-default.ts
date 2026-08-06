// 시간표 '처음 보이는 뷰'(과목별) 해석 — 순수 함수(Vitest로 잠근다).
// ⚠️ `import "server-only"` 금지 — 설정 편집기(클라)도 타입을 쓴다([[#61]]).
//
// 배경: 과목마다 주로 보는 뷰가 다르다(원장 2026-08-06 *"영어는 기본뷰를 잘 안 쓴다"*). 과목 키를
// 코드에 박지 않고 학원설정 `subjects[].defaultView`에서 읽는다(운영 enum 하드코딩 금지 규칙).

import { SUBJECT_DEFAULT_VIEWS, type SubjectDefaultView } from "@/features/owner/settings-types";

/** 시간표 뷰 전체(교실뷰 포함). 교실뷰는 전 과목 지도라 **과목의 기본 뷰가 될 수 없다**. */
export type TimetableView = "basic" | "integrated" | "teacher" | "rooms";

/** 설정이 없던 시절의 동작 = 기본뷰. 모르는 값도 여기로 떨어뜨린다(손편집된 jsonb 방어). */
export const FALLBACK_VIEW: SubjectDefaultView = "basic";

/**
 * 그 과목을 열 때 처음 보이는 뷰.
 * ⚠️ 저장값을 **믿지 않고 허용 목록으로 좁힌다** — jsonb를 손으로 고쳐 `"rooms"`가 들어오면
 * 페이지가 교실뷰로 가는데 그 뷰의 데이터(강의실 목록)는 파라미터 기준으로만 미리 받으므로
 * 빈 지도가 그려진다. 모르는 값 = 기본뷰.
 */
export function subjectDefaultView(
  subjects: readonly { key: string; defaultView?: string }[] | undefined,
  subjectKey: string,
): SubjectDefaultView {
  const raw = subjects?.find((s) => s.key === subjectKey)?.defaultView;
  return (SUBJECT_DEFAULT_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as SubjectDefaultView)
    : FALLBACK_VIEW;
}

/**
 * 링크 URL에 `view`를 실을지 — 그 링크가 가리키는 **과목의 기본 뷰와 다를 때만**.
 *
 * 🔴 예전처럼 "basic이면 생략"으로 두면, 영어의 기본 뷰가 통합뷰가 되는 순간 '기본뷰' 칩이
 * 파라미터 없는 URL이 되어 다시 통합뷰로 되돌아온다 = **기본뷰를 영영 못 고른다.**
 * (과목 칩이 `defaultSubject`를 생략하는 것과 같은 규약 — "기본값이면 생략".)
 */
export function shouldSerializeView(view: TimetableView, defaultView: TimetableView): boolean {
  return view !== defaultView;
}

/**
 * 과목을 바꿀 때 실어 나를 뷰.
 * 지금 그 과목의 기본 뷰를 **그대로 보고 있었다면** 새 과목의 기본 뷰를 따른다(그게 이 설정의 뜻이다:
 * "영어를 열면 통합뷰"). **일부러 다른 뷰로 바꿔 보던 중**이면 그 선택을 존중해 실어 나른다.
 */
export function viewForSubjectSwitch(
  current: TimetableView,
  currentDefault: TimetableView,
  targetDefault: TimetableView,
): TimetableView {
  return current === currentDefault ? targetDefault : current;
}
