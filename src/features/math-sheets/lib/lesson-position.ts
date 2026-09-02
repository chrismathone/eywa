/**
 * 진도 문자열 → 커리큘럼 위치 — MCS 레일의 **재료를 숫자로 접는** 자리(순수, Vitest).
 *
 * ⚠️ 이 모듈은 커리큘럼(초1~중3 전 차시, `onescreen/curriculum.ts`)을 끌어온다 — 레일 재료는 **서버에서** 접어
 *    숫자·차시명만 내려보낸다(화면은 `goal-rail.ts`(숫자만)를 읽는다). 커리큘럼 자체는 목표 선택기(ProgressSelector)가
 *    이미 클라에서도 쓰므로 "번들에 못 싣는다"는 뜻이 아니라, **같은 판정을 두 곳에서 하지 않는다**는 뜻이다.
 *
 * 🔴 **한 칸에 차시가 여럿이면 가장 뒤 차시가 그날 위치다** — 원스크린은 다중 선택이라 한 날에
 *    `2-1-3 … \n 2-1-2 … \n 2-1-1 …`처럼 **역순**으로도 들어온다(실측 2026-08-31). 진도 컨테이너의
 *    `positionOf`는 마지막 줄만 읽어 그런 날을 뒤로 잡는다 — 여기선 줄마다 풀어 최댓값을 취한다.
 * 🔴 **레일은 트랙(현행·선행)을 가르지 않는다** — 위치는 학년을 관통하는 글로벌 값이라 "중2 마지막 단원 → 중3 첫 단원"
 *    목표도 한 줄로 성립한다. 종전엔 트랙마다 레일을 세웠는데, 담임이 목표 칸의 학년 토글로 **다음 학년** 목표를 적으면
 *    기록이 있는 트랙엔 목표가 없고 목표가 있는 트랙엔 기록이 없어 화면이 **"목표 없음"이라고 거짓말**했다
 *    (적대적 리뷰 2026-09-02). 트랙은 이제 차시의 학년 표시(`grade`)로만 남는다.
 * ⚠️ 고등·프린트·시험 상태(`모의고사` 등)는 커리큘럼 밖이라 null — 그런 날은 레일에 점을 찍지 않는다.
 */
import { splitLessons } from "@/features/onescreen/curriculum";
import { classifyTrack, positionOf } from "@/features/progress/curriculum-position";
import type { RailTrack } from "./goal-rail";

export type LessonPoint = {
  position: number;
  grade: string;
  lesson: string;
  /** 학생 학년 대비 현행/선행 — 표시용(레일 판정엔 안 쓴다). */
  track: RailTrack;
};

/** 진도 문자열(합본) 안의 차시들 → 위치. 커리큘럼에 없는 줄은 건너뛴다. */
export function lessonPointsOf(progress: string | null | undefined, studentGrade: string | null): LessonPoint[] {
  const out: LessonPoint[] = [];
  const lines = splitLessons(progress);
  // 한 줄짜리는 `positionOf`가 라벨("수학 ")을 벗겨 준다. 여러 줄이면 첫 줄만 라벨을 달고 들어온다.
  for (const line of lines.length > 0 ? lines : [progress ?? ""]) {
    const hit = positionOf(line);
    if (!hit) continue;
    out.push({
      position: hit.position,
      grade: hit.grade,
      lesson: hit.lesson,
      track: classifyTrack(studentGrade, hit.grade) ?? "current",
    });
  }
  return out;
}

/** 그날의 대표 위치 — **가장 뒤 차시** 하나(트랙 불문). 아무 줄도 안 맞으면 null. */
export function dayPositionOf(progress: string | null | undefined, studentGrade: string | null): LessonPoint | null {
  let best: LessonPoint | null = null;
  for (const p of lessonPointsOf(progress, studentGrade)) {
    if (!best || p.position > best.position) best = p;
  }
  return best;
}

/** 그날의 대표 위치를 트랙별로 — 학년 표시가 필요한 곳용. 아무 줄도 안 맞으면 빈 맵. */
export function dayPositionsOf(
  progress: string | null | undefined,
  studentGrade: string | null,
): Partial<Record<RailTrack, LessonPoint>> {
  const out: Partial<Record<RailTrack, LessonPoint>> = {};
  for (const p of lessonPointsOf(progress, studentGrade)) {
    const cur = out[p.track];
    if (!cur || p.position > cur.position) out[p.track] = p;
  }
  return out;
}

/**
 * 목표 문자열(`math_month_goals.target_progress`, ProgressSelector 합본) → **목표 끝 위치** 하나.
 * 여러 차시를 골랐으면 가장 뒤 차시가 End다("여기까지"라는 뜻). 못 맞추면 null(=목표 위치 미상).
 */
export function goalEndOf(targetProgress: string | null | undefined, studentGrade: string | null): LessonPoint | null {
  return dayPositionOf(targetProgress, studentGrade);
}
