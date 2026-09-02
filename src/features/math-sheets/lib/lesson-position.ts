/**
 * 진도 문자열 → 커리큘럼 위치 — MCS 레일의 **재료를 숫자로 접는** 자리(순수, Vitest).
 *
 * ⚠️ 이 모듈은 커리큘럼(초1~중3 전 차시, `onescreen/curriculum.ts`)을 끌어온다 — **서버에서만** import할 것.
 *    클라 컴포넌트가 물면 그 표가 번들에 통째로 실린다(B5). 화면은 `goal-rail.ts`(숫자만)를 읽는다.
 *
 * 🔴 **한 칸에 차시가 여럿이면 가장 뒤 차시가 그날 위치다** — 원스크린은 다중 선택이라 한 날에
 *    `2-1-3 … \n 2-1-2 … \n 2-1-1 …`처럼 **역순**으로도 들어온다(실측 2026-08-31). 진도 컨테이너의
 *    `positionOf`는 마지막 줄만 읽어 그런 날을 뒤로 잡는다 — 여기선 줄마다 풀어 최댓값을 취한다.
 * 🔴 **트랙(현행·선행)은 학생 학년과 차시 학년으로 가른다**(`classifyTrack` — 컨테이너와 같은 규칙).
 *    학년을 모르면 `current`로 둔다(가르지 못하는 것을 두 줄로 쪼개 보여 줄 이유가 없다).
 * ⚠️ 고등·프린트·시험 상태(`모의고사` 등)는 커리큘럼 밖이라 null — 그런 날은 레일에 점을 찍지 않는다.
 */
import { splitLessons } from "@/features/onescreen/curriculum";
import { classifyTrack, positionOf } from "@/features/progress/curriculum-position";
import type { RailTrack } from "./goal-rail";

export type LessonPoint = {
  position: number;
  grade: string;
  lesson: string;
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

/** 그날의 대표 위치 — 트랙별로 **가장 뒤 차시**. 아무 줄도 안 맞으면 빈 맵. */
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
 * 목표 문자열(`math_month_goals.target_progress`, ProgressSelector 합본) → 트랙별 **목표 끝 위치**.
 * 여러 차시를 골랐으면 가장 뒤 차시가 End다("여기까지"라는 뜻). 못 맞추면 빈 맵(=목표 위치 미상).
 */
export function goalEndsOf(
  targetProgress: string | null | undefined,
  studentGrade: string | null,
): Partial<Record<RailTrack, LessonPoint>> {
  return dayPositionsOf(targetProgress, studentGrade);
}
