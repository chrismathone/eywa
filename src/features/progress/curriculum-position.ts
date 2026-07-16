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

/**
 * 진도 추적 대상 학년 = 초·중만. 고등(공통수학·대수·미적분·확률과 통계·기하)은 피커(curriculum.ts)엔
 * 노출하되 여기 전역 타임라인에선 제외한다 — ① 과목 선택제라 gradeRank(초/중/고+숫자)에 안 맞고
 * ② 과목 간 차시명이 중복(미적분1·2의 "접선의 방정식"·"속도와 가속도" 등)이라 전역 유일 위치 매핑이 깨진다.
 * (positionOf가 고등 progress를 null로 두는 기존 계약도 그대로 유지 → ingest에서 skip.)
 */
const TRACKED_GRADES = CURRICULUM_GRADES.filter((g) => /^[초중]/.test(g));

/** MATH_CURRICULUM을 학년(TRACKED_GRADES: 초·중)순 → 단원순 → 차시순으로 flatten. position은 1-based. */
export const ALL_LESSONS: LessonPosition[] = (() => {
  const out: LessonPosition[] = [];
  let pos = 0;
  for (const grade of TRACKED_GRADES) {
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

/** 라벨 토큰을 앞에서 하나씩 벗기며 정확 조회(긴 것 우선). eywa 네이티브 "수학 <차시>"용. */
function lookupWithLabelStrip(text: string): LessonPosition | null {
  let s = text.trim();
  if (!s) return null;
  for (let i = 0; i < 5; i++) {
    const hit = LESSON_TO_POS.get(s);
    if (hit) return hit;
    const sp = s.indexOf(" ");
    if (sp < 0) break;
    s = s.slice(sp + 1).trim();
  }
  return null;
}

/**
 * edutrix 임포트 포맷 정규화 — 여러 줄이면 **마지막 항목**(그날 최종 진도), 앞 "N." 제거,
 * "대단원 총괄"은 특정 차시가 아니므로 제외(null). 예: "1.순서쌍…\n2.그래프의 이해" → "그래프의 이해".
 */
function normalizeLegacy(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1]!.replace(/^\d+\.\s*/, "").trim();
  if (!last || /대단원\s*총괄/.test(last)) return null;
  return last;
}

/**
 * 보고서 진도 텍스트 → 글로벌 위치. progress = "<과목라벨> <차시>"(eywa 네이티브, 정확 문자열).
 * 정확 미스 시 edutrix 임포트 포맷(번호·여러 줄·총괄)을 정규화해 재시도 — 초·중 실 데이터 백필용.
 * 고등·자유입력·총괄·오타는 전부 Map 미스 → null(ingest에서 skip). 학년 모호성 해소 불필요.
 */
export function positionOf(progressText: string | null | undefined): LessonPosition | null {
  if (!progressText) return null;
  const direct = lookupWithLabelStrip(progressText.trim());
  if (direct) return direct;
  const norm = normalizeLegacy(progressText);
  return norm ? lookupWithLabelStrip(norm) : null;
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
