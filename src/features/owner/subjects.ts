// 과목 설정(operations.subjects) 단일 소스 헬퍼 — 순수 함수(서버/클라 무관).
// 서버 컴포넌트/액션이 getTenantSettings()로 subjects를 읽어 이 헬퍼로 라벨·색·옵션을 만든 뒤,
// client 컴포넌트에는 직렬화 가능한 맵/배열을 prop으로 전달한다.
import type { PillColor } from "@/components/atoms/pill";
import type { SubjectSetting } from "./settings-types";

// DEFAULT_SETTINGS.subjects엔 없지만 기존 코드/DB에 존재하던 레거시 과목 key의 폴백 라벨·색.
// (영문 key 노출 방지 + 사이트별 하드코딩 맵과의 동등성 유지.)
const LEGACY_LABELS: Record<string, string> = {
  arts: "예술",
  social: "사회",
  other: "기타",
  etc: "기타",
  // highmath는 subject_1로 폐기(2026-06-19)됐으나 ijw 베이스 복원 시 잔존할 수 있어 표시 폴백만 유지한다
  // (선택지 options/filters엔 안 섞임 — subject_1 "수학(심화)"와 동일 라벨·색). 정석 정리는 migrate-highmath-to-subject1.cjs.
  highmath: "수학(심화)",
};
const LEGACY_COLORS: Record<string, PillColor> = {
  arts: "amber",
  social: "neutral",
  other: "neutral",
  etc: "neutral",
  highmath: "primary",
};

// 흔한 한글 과목명 → 표준 내부 키. 운영 과목 추가 시 이 이름을 입력하면 표준 키를 부여해
// 코드 특수동작(영어 10교시·수학/영어 세부점수 등)을 상속한다. 사전에 없으면 subject_N 폴백.
// ⚠️ 키는 화면에 안 보이는 내부 식별자라 값 자체는 무의미 — 특수동작이 붙는 math/english만 정확하면 된다.
export const KNOWN_SUBJECT_KEYS: Record<string, string> = {
  "수학": "math",
  "영어": "english",
  "국어": "korean",
  "과학": "science",
  "사회": "social",
  "역사": "history",
  "한국사": "history",
  "미술": "art",
  "음악": "music",
  "체육": "pe",
  "논술": "essay",
  "독서": "reading",
  "물리": "physics",
  "화학": "chemistry",
  "생물": "biology",
  "지구과학": "earth",
  "코딩": "coding",
  "컴퓨터": "coding",
};

export type SubjectMaps = {
  /** key→한글 라벨. 설정 → 레거시 폴백 → raw key. */
  labelOf: (key: string) => string;
  /** key→Pill 색. 설정 → 레거시 폴백 → neutral. */
  colorOf: (key: string) => PillColor;
  /** 드롭다운 옵션 [{value,label}] (설정 순서). */
  options: { value: string; label: string }[];
  /** 필터칩 [{all,전체}, …설정]. */
  filters: { value: string; label: string }[];
};

export function buildSubjectMaps(subjects: SubjectSetting[]): SubjectMaps {
  const labelMap = new Map(subjects.map((s) => [s.key, s.label]));
  const colorMap = new Map(subjects.map((s) => [s.key, s.color]));
  return {
    labelOf: (key) => labelMap.get(key) ?? LEGACY_LABELS[key] ?? key,
    colorOf: (key) => colorMap.get(key) ?? LEGACY_COLORS[key] ?? "neutral",
    options: subjects.map((s) => ({ value: s.key, label: s.label })),
    filters: [{ value: "all", label: "전체" }, ...subjects.map((s) => ({ value: s.key, label: s.label }))],
  };
}

/** key→라벨 단순 맵(직렬화해 client로 넘길 때). 레거시 폴백 포함. */
export function subjectLabelRecord(subjects: SubjectSetting[]): Record<string, string> {
  return { ...LEGACY_LABELS, ...Object.fromEntries(subjects.map((s) => [s.key, s.label])) };
}

// PillColor → Tailwind 클래스 — 과목 색의 여러 표현(soft 배지 / 솔리드 막대 / 보더카드 / 아이콘칩).
// Pill 컴포넌트(atoms/pill)와 동일 토큰. client로 색만 넘기고 클래스는 여기서 해석.
export const SUBJECT_SOFT: Record<PillColor, string> = {
  primary: "bg-primary-soft text-primary",
  green: "bg-green-soft text-green",
  gold: "bg-gold-soft text-gold",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-bg-soft text-text-dim",
};

export const SUBJECT_SOLID: Record<PillColor, string> = {
  primary: "bg-primary",
  green: "bg-green",
  gold: "bg-gold",
  blue: "bg-blue",
  purple: "bg-purple",
  rose: "bg-rose",
  amber: "bg-amber",
  danger: "bg-danger",
  neutral: "bg-neutral-fill",
};

export const SUBJECT_BORDER: Record<PillColor, string> = {
  primary: "border-primary bg-primary-softer",
  green: "border-green bg-green-soft",
  gold: "border-gold bg-gold-soft",
  blue: "border-blue bg-blue-soft",
  purple: "border-purple bg-purple-soft",
  rose: "border-rose bg-rose-soft",
  amber: "border-amber bg-amber-soft",
  danger: "border-danger bg-danger-soft",
  neutral: "border-line bg-bg-soft",
};

export const SUBJECT_ICON_BG: Record<PillColor, string> = {
  primary: "bg-primary-soft text-primary",
  green: "bg-green-soft text-green",
  gold: "bg-gold-soft text-gold",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-bg-soft text-text-dim",
};
