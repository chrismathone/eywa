// 영어 레벨 파싱 + 레벨업/레벨다운 — 순수 함수. ijw `englishUtils.ts`에서 이식.
// 레벨은 반이름 문자열에만 인코딩된다(예 "DP3", "RTT6a"): 약어 + 숫자 + 선택 접미사.
// eywa는 별도 레벨 컬럼 없이 className으로만 판정 → 레벨업 = className UPDATE 1건.

export interface ParsedClassName {
  levelAbbr: string;
  number: number;
  suffix: string;
}

// 레벨 순서 — english_levels 테이블의 (abbreviation, sort_order) 또는 이 기본값.
export interface LevelDef {
  abbreviation: string;
  fullName: string;
}

export const DEFAULT_ENGLISH_LEVELS: LevelDef[] = [
  { abbreviation: "DP", fullName: "Dr. Phonics" },
  { abbreviation: "PL", fullName: "Pre Let's" },
  { abbreviation: "RTT", fullName: "Ready To Talk" },
  { abbreviation: "LT", fullName: "Let's Talk" },
  { abbreviation: "RTS", fullName: "Ready To Speak" },
  { abbreviation: "LS", fullName: "Let's Speak" },
  { abbreviation: "LE", fullName: "Let's Express" },
  { abbreviation: "KW", fullName: "Kopi Wang" },
  { abbreviation: "PJ", fullName: "Pre Junior" },
  { abbreviation: "JP", fullName: "Junior Plus" },
  { abbreviation: "SP", fullName: "Senior Plus" },
  { abbreviation: "MEC", fullName: "Middle School English Course" },
];

const CLASS_NAME_RE = /^([A-Z]+)(\d+)([a-z]?)$/;

/** "DP3" → {levelAbbr:"DP", number:3, suffix:""}. 레벨 규칙명이 아니면 null. */
export function parseClassName(name: string): ParsedClassName | null {
  if (!name) return null;
  const m = name.trim().match(CLASS_NAME_RE);
  if (!m) return null;
  return { levelAbbr: m[1], number: parseInt(m[2], 10), suffix: m[3] || "" };
}

/** {levelAbbr:"DP", number:4, suffix:""} → "DP4". */
export function buildClassName(p: ParsedClassName): string {
  return `${p.levelAbbr}${p.number}${p.suffix}`;
}

function levelIndex(abbr: string, order: LevelDef[]): number {
  const up = abbr.toUpperCase();
  return order.findIndex((l) => l.abbreviation.toUpperCase() === up);
}

/** 레벨 규칙 반이름인지(약어가 레벨 목록에 있는지). */
export function isLevelClassName(name: string, order: LevelDef[] = DEFAULT_ENGLISH_LEVELS): boolean {
  const p = parseClassName(name);
  return !!p && levelIndex(p.levelAbbr, order) !== -1;
}

/** 숫자 레벨업: DP3 → DP4 (접미사 보존). 규칙명 아니면 null. */
export function numberLevelUp(name: string): string | null {
  const p = parseClassName(name);
  if (!p) return null;
  return buildClassName({ ...p, number: p.number + 1 });
}

/** 숫자 레벨다운: DP4 → DP3. 1이면 null. */
export function numberLevelDown(name: string): string | null {
  const p = parseClassName(name);
  if (!p || p.number <= 1) return null;
  return buildClassName({ ...p, number: p.number - 1 });
}

/** 클래스 레벨업: DP3 → PL1 (다음 레벨, 숫자 1 리셋, 접미사 보존). 마지막 레벨이면 null. */
export function classLevelUp(name: string, order: LevelDef[] = DEFAULT_ENGLISH_LEVELS): string | null {
  const p = parseClassName(name);
  if (!p) return null;
  const i = levelIndex(p.levelAbbr, order);
  if (i === -1 || i >= order.length - 1) return null;
  return buildClassName({ levelAbbr: order[i + 1].abbreviation, number: 1, suffix: p.suffix });
}

/** 클래스 레벨다운: PL1 → DP1. 첫 레벨이면 null. */
export function classLevelDown(name: string, order: LevelDef[] = DEFAULT_ENGLISH_LEVELS): string | null {
  const p = parseClassName(name);
  if (!p) return null;
  const i = levelIndex(p.levelAbbr, order);
  if (i <= 0) return null;
  return buildClassName({ levelAbbr: order[i - 1].abbreviation, number: 1, suffix: p.suffix });
}

export function isMaxLevel(name: string, order: LevelDef[] = DEFAULT_ENGLISH_LEVELS): boolean {
  const p = parseClassName(name);
  return !!p && levelIndex(p.levelAbbr, order) === order.length - 1;
}

export function isMinLevel(name: string, order: LevelDef[] = DEFAULT_ENGLISH_LEVELS): boolean {
  const p = parseClassName(name);
  return !!p && levelIndex(p.levelAbbr, order) === 0;
}

export type LevelChange = "number-up" | "number-down" | "class-up" | "class-down";

/** 레벨 변경 4종 통합 진입점. 불가하면 null. */
export function applyLevelChange(
  name: string,
  change: LevelChange,
  order: LevelDef[] = DEFAULT_ENGLISH_LEVELS,
): string | null {
  switch (change) {
    case "number-up":
      return numberLevelUp(name);
    case "number-down":
      return numberLevelDown(name);
    case "class-up":
      return classLevelUp(name, order);
    case "class-down":
      return classLevelDown(name, order);
  }
}
