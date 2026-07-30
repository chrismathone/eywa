// ECS(English Class Sheet) 수업계획 '구분' 영역 해석 — 단일 소스.
// 저장은 영문 slug(class_sheet_plan_lines.skill_area 등), 라벨은 학원설정(subjects[].skillAreas).
// english는 미설정이어도 기본 6영역을 프리필(구글시트 원본 어휘) — "설정 무시" 하드코딩이 아니라
// 설정이 비었을 때의 기본값이며, 원장이 skillAreas를 편집하면 그 값이 이긴다.
// ⚠️ ECS 진입 조건도 이 함수가 판정한다: resolveSkillAreas(subject).length > 0 인 과목만 ECS 대상.
import type { SkillAreaSetting, SubjectSetting } from "./settings-types";

/** english 과목 기본 6영역 — 구글시트 '구분' 어휘(Vocab/Listening/Reading/Grammar/Writing/Speaking). */
export const DEFAULT_ENGLISH_SKILL_AREAS: readonly SkillAreaSetting[] = [
  { key: "vocab", label: "Vocab" },
  { key: "listening", label: "Listening" },
  { key: "reading", label: "Reading" },
  { key: "grammar", label: "Grammar" },
  { key: "writing", label: "Writing" },
  { key: "speaking", label: "Speaking" },
];

/**
 * 과목의 ECS 영역 목록을 해석한다.
 * · 설정에 skillAreas가 있으면(비어있지 않으면) 그 값 그대로.
 * · english인데 미설정/빈 배열이면 기본 6영역 프리필.
 * · 그 외 과목 미설정 = 빈 목록(= ECS 대상 아님).
 */
export function resolveSkillAreas(
  subject: Pick<SubjectSetting, "key" | "skillAreas"> | undefined,
): SkillAreaSetting[] {
  if (!subject) return [];
  const stored = subject.skillAreas ?? [];
  if (stored.length > 0) return stored;
  if (subject.key === "english") return [...DEFAULT_ENGLISH_SKILL_AREAS];
  return [];
}

/**
 * 저장된 skill_area slug의 표시 라벨. 설정에서 삭제된 slug는 데이터 소실 없이 표시를 유지해야 하므로
 * "미등록 영역" 폴백 대신 slug 원문을 그대로 보여주지 않고 `(삭제된 영역)` 접두 없이 — 기존 저장 라벨을
 * 모르는 상태라 slug를 노출할 수밖에 없되, UI가 흐린 톤으로 구분한다(known=false).
 */
export function skillAreaLabelOf(
  areas: readonly SkillAreaSetting[],
  key: string,
): { label: string; known: boolean } {
  const hit = areas.find((a) => a.key === key);
  if (hit) return { label: hit.label, known: true };
  return { label: key, known: false };
}
