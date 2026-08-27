// ECS(English Class Sheet) 수업계획 '구분' 영역 해석 — 단일 소스.
// 저장은 영문 slug(class_sheet_plan_lines.skill_area 등), 라벨은 학원설정(subjects[].skillAreas).
// english는 미설정이어도 기본 7영역을 프리필(구글시트 원본 어휘 + Shouting) — "설정 무시" 하드코딩이 아니라
// 설정이 비었을 때의 기본값이며, 원장이 skillAreas를 편집하면 그 값이 이긴다.
// ⚠️ ECS 진입 조건도 이 함수가 판정한다: resolveSkillAreas(subject).length > 0 인 과목만 ECS 대상.
import type { PillColor } from "@/components/atoms/pill";
import { SUBJECT_COLORS, type SkillAreaSetting, type SubjectSetting } from "./settings-types";

/**
 * english 과목 기본 7영역 — 구글시트 '구분' 어휘(Vocab/Listening/Reading/Grammar/Writing/Speaking)
 * + Shouting(원장 지시 2026-08-27, Speaking 아래).
 * 색은 "설정이 비었을 때의 기본값"이지 하드코딩 맵이 아니다 — 원장이 과목 운영 탭에서 바꾸면 그 값이 이긴다.
 * 서로 최대한 멀리(파랑·보라·초록·앰버·로즈·골드·네이비) 떨어뜨려 한눈에 갈리게 골랐다.
 */
export const DEFAULT_ENGLISH_SKILL_AREAS: readonly SkillAreaSetting[] = [
  { key: "vocab", label: "Vocab", color: "blue" },
  { key: "listening", label: "Listening", color: "purple" },
  { key: "reading", label: "Reading", color: "green" },
  { key: "grammar", label: "Grammar", color: "amber" },
  { key: "writing", label: "Writing", color: "rose" },
  { key: "speaking", label: "Speaking", color: "gold" },
  { key: "shouting", label: "Shouting", color: "primary" },
];

/** 색 미설정 영역에 돌려 쓰는 팔레트(neutral·danger 제외 — danger는 '결석' 의미와 겹친다). */
const ROTATION: readonly PillColor[] = ["blue", "purple", "green", "amber", "rose", "gold", "primary"];

/**
 * 과목의 ECS 영역 목록을 해석한다.
 * · 설정에 skillAreas가 있으면(비어있지 않으면) 그 값 그대로.
 * · english인데 미설정/빈 배열이면 기본 7영역 프리필.
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

/**
 * 영역의 표시 색 — 계획 화면(패널·계획 행)이 **같은 색을 쓰도록** 하는 단일 소스.
 *
 * 우선순위: ① 설정 색 → ② 기본 7영역의 내장 색(설정에 색만 비어 있을 때) → ③ 순번 회전 → ④ neutral.
 * ⚠️ 회전은 **설정 목록에서의 순번**이라, 영역을 지우거나 순서를 바꾸면 색이 따라 움직인다. 색을 고정하고
 *    싶으면 설정에서 색을 지정하면 된다(그게 ①). 미등록 key(설정에서 삭제된 옛 계획 행)는 neutral —
 *    살아있는 영역의 색을 빌려 쓰면 "지워진 영역"이 정상 영역처럼 보인다.
 */
export function skillAreaColorOf(areas: readonly SkillAreaSetting[], key: string): PillColor {
  const idx = areas.findIndex((a) => a.key === key);
  if (idx < 0) return "neutral";
  const stored = areas[idx]!.color;
  if (stored && (SUBJECT_COLORS as readonly string[]).includes(stored)) return stored;
  const builtin = DEFAULT_ENGLISH_SKILL_AREAS.find((a) => a.key === key)?.color;
  if (builtin) return builtin;
  return ROTATION[idx % ROTATION.length]!;
}
