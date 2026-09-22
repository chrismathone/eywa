/**
 * 성적 화면의 **과목 축** — 고르는 자리에서만 영어를 둘로 가른다(원장 2026-09-22:
 * *"영어도 인재원 영어 EIE로 나눌꺼임. 여기서 수강과목에서만 분리하고 전체데이터 볼때는 영어 하나로"*).
 *
 * 🔴 **저장되는 과목은 언제나 `english` 하나다** — 트랙은 *반을 고르는 필터*일 뿐 성적 행에 안 들어간다.
 *    학교 시험 성적은 학생·과목·학기당 한 벌이라, 한 학생이 인재원 영어와 EiE를 같이 들어도 영어 성적은
 *    하나다(어느 쪽에서 적어도 같은 칸). 트랙을 행에 실으면 같은 시험이 두 벌로 갈리고 학생 상세·추이·
 *    급락 감지가 서로 다른 것을 본다.
 * 🔴 **비대칭 필터**는 반 목록 쪽 규약 그대로([[english-track.ts]]): `eie`는 정확히 일치,
 *    `injaewon`은 "EiE가 아닌 전부"(미분류 포함). 양쪽을 정확히 일치로 거르면 미분류 영어 반이
 *    두 선택지 모두에서 사라진다.
 * ⚠️ 과목 **라벨**은 학원설정이 단일 소스다 — 이 파일은 `수학`·`영어` 같은 글자를 적지 않고
 *    `labelOf`가 준 라벨에 트랙 이름만 붙인다(하드코딩 금지).
 */

import { ENGLISH_TRACK_LABEL, type EnglishTrack } from "@/features/classes/english-track";

export const ENGLISH_SUBJECT_KEY = "english";

/** 화면이 고른 과목. `track`은 영어일 때만 값이 있다(그 외는 항상 null). */
export type GradeAxis = { subject: string; track: EnglishTrack | null };

/** 주소에 싣는 한 덩어리 값 — `math` · `english:eie` · `english:injaewon`. */
export function axisValueOf(axis: GradeAxis): string {
  return axis.subject === ENGLISH_SUBJECT_KEY && axis.track
    ? `${axis.subject}:${axis.track}`
    : axis.subject;
}

/**
 * 주소 값 → 과목 축. 모르는 과목은 **null**(호출부가 첫 과목으로 떨어뜨린다).
 * 영어인데 트랙이 없거나 모르는 값이면 기본 트랙(인재원 = 미분류가 보이는 쪽)으로.
 */
export function parseAxisValue(raw: unknown, subjectKeys: readonly string[]): GradeAxis | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  const [subject, track] = text.split(":");
  if (!subject || !subjectKeys.includes(subject)) return null;
  if (subject !== ENGLISH_SUBJECT_KEY) return { subject, track: null };
  return { subject, track: track === "eie" ? "eie" : "injaewon" };
}

/**
 * 과목 드롭다운 항목 — 설정 순서 그대로, 영어만 두 줄(EiE 먼저: 반 목록 규약과 같은 순서).
 * `options`는 `buildSubjectMaps(...).options`(학원설정 단일 소스)를 그대로 받는다.
 */
export function axisOptionsFrom(
  options: readonly { value: string; label: string }[],
): { value: string; label: string }[] {
  return options.flatMap((o) =>
    o.value === ENGLISH_SUBJECT_KEY
      ? [
          { value: `${o.value}:eie`, label: `${o.label} (${ENGLISH_TRACK_LABEL.eie})` },
          { value: `${o.value}:injaewon`, label: `${o.label} (${ENGLISH_TRACK_LABEL.injaewon})` },
        ]
      : [{ value: o.value, label: o.label }],
  );
}

/** 화면·엑셀에 적는 이름. 과목 라벨은 호출부(학원설정)가 준다. */
export function axisLabelFor(axis: GradeAxis, labelOf: (key: string) => string): string {
  const base = labelOf(axis.subject);
  return axis.track ? `${base} (${ENGLISH_TRACK_LABEL[axis.track]})` : base;
}

/** 첫 과목으로 떨어뜨릴 때 쓰는 기본 축(설정이 비면 null). */
export function firstAxisOf(options: readonly { value: string; label: string }[]): GradeAxis | null {
  const first = options[0];
  if (!first) return null;
  return parseAxisValue(axisOptionsFrom([first])[0]!.value, [first.value]);
}
