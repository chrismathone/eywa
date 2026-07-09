/**
 * 진도 컨테이너 — 커리큘럼 글로벌 위치 매핑 (edutrix lib/progress.ts 이식, 단순화).
 *
 * edutrix는 진도 텍스트를 fuzzy 매칭(학년 모호성 해소 4단계)했지만, eywa 원스크린은 진도를
 * **커리큘럼 드롭다운의 정확한 차시 문자열**로 저장한다(lesson_reports.progress = "수학 <차시>").
 * 그래서 글로벌 위치 = MATH_CURRICULUM을 학년순으로 flatten한 배열의 인덱스(1-based) + Map 조회로 끝난다.
 * 커리큘럼 데이터는 features/onescreen/curriculum.ts를 재사용(중복 정의 금지).
 */
import { MATH_CURRICULUM, CURRICULUM_GRADES } from "@/features/onescreen/curriculum";

export type LessonPosition = {
  position: number; // 1-based 글로벌 위치(커리큘럼 전체 관통 단조증가 타임라인)
  grade: string; // "초3" ~ "중3"
  unit: string; // 대단원/단원명
  lesson: string; // 차시 문자열(원본)
};

/** MATH_CURRICULUM을 학년(CURRICULUM_GRADES)순 → 단원순 → 차시순으로 flatten. position은 1-based. */
export const ALL_LESSONS: LessonPosition[] = (() => {
  const out: LessonPosition[] = [];
  let pos = 0;
  for (const grade of CURRICULUM_GRADES) {
    const units = MATH_CURRICULUM[grade] ?? [];
    for (const u of units) {
      for (const lesson of u.lessons) {
        pos += 1;
        out.push({ position: pos, grade, unit: u.unit, lesson });
      }
    }
  }
  return out;
})();

export const TOTAL_LESSONS = ALL_LESSONS.length;

/** 차시 문자열 → 위치. 차시 문자열은 커리큘럼 전체에서 유일(초등=코드 prefix, 중등=고유명) → 첫 등장 채택. */
export const LESSON_TO_POS: Map<string, LessonPosition> = (() => {
  const m = new Map<string, LessonPosition>();
  for (const l of ALL_LESSONS) if (!m.has(l.lesson)) m.set(l.lesson, l);
  return m;
})();

/**
 * 보고서 진도 텍스트 → 글로벌 위치. progress = "<과목라벨> <차시>" 형태(차시는 커리큘럼 정확 문자열).
 * 과목 라벨이 여러 단어("수학 (상)")여도 대응 — 전체→앞 토큰 제거를 반복하며 정확 조회(긴 것 우선).
 * 비수학·자유입력·오타는 전부 Map 미스 → null(ingest에서 skip). 학년 모호성 해소 불필요.
 */
export function positionOf(progressText: string | null | undefined): LessonPosition | null {
  if (!progressText) return null;
  let s = progressText.trim();
  if (!s) return null;
  // 전체 → 첫 공백 뒤 → 둘째 공백 뒤 … (라벨 토큰 최대 4개까지). 첫 정확 일치 채택.
  for (let i = 0; i < 5; i++) {
    const hit = LESSON_TO_POS.get(s);
    if (hit) return hit;
    const sp = s.indexOf(" ");
    if (sp < 0) break;
    s = s.slice(sp + 1).trim();
  }
  return null;
}

/** 글로벌 위치 → 커리큘럼 항목(학년/단원/차시). 범위 밖이면 null. */
export function describePosition(position: number): LessonPosition | null {
  if (!Number.isFinite(position) || position < 1 || position > TOTAL_LESSONS) return null;
  return ALL_LESSONS[position - 1] ?? null;
}

/** 글로벌 위치의 학년("초3"~"중3"). 범위 밖이면 null. */
export function gradeOfPosition(position: number): string | null {
  return describePosition(position)?.grade ?? null;
}

/** 학년 랭크 — 초=0/중=10/고=20 base + 학년 숫자. 파싱 실패면 null. (eywa 학년: 초1~고3) */
export function gradeRank(grade: string | null | undefined): number | null {
  if (!grade) return null;
  const m = /^(초|중|고)\s*(\d)/.exec(grade.trim());
  if (!m) return null;
  const base = m[1] === "초" ? 0 : m[1] === "중" ? 10 : 20;
  return base + Number(m[2]);
}

export type Track = "current" | "ahead";

/**
 * 현행/선행 분류 — 진도 차시의 학년 vs 학생 실제 학년.
 * 진도학년 > 학생학년 → ahead(선행), 그 외(같거나 낮음=복습) → current. **후행 개념 없음**(edutrix 동형).
 * 어느 한쪽 학년 파싱 실패 → null(ingest에서 skip).
 */
export function classifyTrack(studentGrade: string | null | undefined, lessonGrade: string | null | undefined): Track | null {
  const s = gradeRank(studentGrade);
  const p = gradeRank(lessonGrade);
  if (s == null || p == null) return null;
  return p > s ? "ahead" : "current";
}
