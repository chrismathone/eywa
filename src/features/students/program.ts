/**
 * 재원생 **프로그램** 구분 — 단일 규칙(순수 · Vitest). 운영실 KPI '재원생' 팝업·원생목록 `program=` 필터·
 * '동시 수강'·'학년별 재원생'·운영실 '퇴원생'(마지막 수강 반)·'오늘첫수업'의 새 과목 판정이 전부 이 함수를 지난다.
 *
 * 원장 2026-09-11: 재원생을 **EiE / 인재원 영어 / 수학** 셋으로 본다. 수학은 **수학(심화) 포함**.
 *
 * 🔑 판정 재료는 **반**(수강 한 줄의 반 과목 + 영어 반 프로그램 구분)이다.
 *   · 영어 묶음 = 과목 키 `english` **또는 학원설정 라벨에 "영어"가 들어간 과목**.
 *     그 안에서 EiE / 인재원 영어는 `english_track`으로만 가른다 — EiE는 정확히 eie, 인재원 영어는
 *     **EiE가 아닌 전부**(미분류 null 포함, [english-track.ts]의 비대칭 그대로).
 *   · 수학 묶음 = 과목 키 `math` **또는 라벨에 "수학"이 들어간 과목**(수학(심화)=subject_1 등).
 * 🔴 수학(심화) 키(`subject_1` 등)를 코드에 적지 말 것 — 학원설정이 단일 소스다(운영 enum 하드코딩 금지).
 *    레거시 폴백 라벨(`highmath`)도 설정에 없으면 수학으로 치지 않는다(설정이 진실).
 * ⚠️ 라벨로 묶는 한계: 학원설정에서 과목 **이름**을 바꾸면 묶음이 따라 바뀐다(예: '수학(심화)'를 'Advanced'로 고치면
 *    수학에서 빠진다). 라벨에 '수학'과 '영어'가 함께 들어 있으면 수학으로 본다.
 */
import { ENGLISH_TRACK_LABEL, readEnglishTrack } from "@/features/classes/english-track";

export type Program = "eie" | "injaewon" | "math";

/** 화면 순서(EiE → 인재원 영어 → 수학). */
export const PROGRAMS: readonly Program[] = ["eie", "injaewon", "math"];

/** 학원설정 과목 한 줄 — `operations.subjects`의 key·label만 본다. */
export type ProgramSubject = { key: string; label: string };

/** 영어 반 과목 키 — `english_track`(0176a)은 이 과목의 반에만 붙는다(normalizeEnglishTrack와 같은 규약). */
const ENGLISH_KEY = "english";
/** 수학 표준 키(KNOWN_SUBJECT_KEYS "수학" → math). */
const MATH_KEY = "math";

/**
 * 수강 한 줄(반)의 프로그램. 세 프로그램 어디에도 안 들면 null(국어·과학·미상 과목).
 * @param subjects 학원설정 `operations.subjects` — 레거시 폴백 라벨이 섞인 표(subjectLabelRecord)를 넘기지 말 것.
 */
export function programOf(
  klass: {
    subject: string | null | undefined;
    englishTrack?: string | null;
    english_track?: string | null;
  },
  subjects: readonly ProgramSubject[],
): Program | null {
  const subject = klass.subject?.trim();
  if (!subject) return null;
  const english = (): Program => (readEnglishTrack(klass) === "eie" ? "eie" : "injaewon");
  if (subject === ENGLISH_KEY) return english();
  if (subject === MATH_KEY) return "math";
  const label = subjects.find((s) => s.key === subject)?.label ?? "";
  if (label.includes("수학")) return "math";
  if (label.includes("영어")) return english();
  return null;
}

/**
 * 과목 **묶음** — programOf와 **같은 판정**: 영어(EiE·인재원 영어) = "english", 수학(수학(심화) 포함) = "math",
 * 그 밖은 과목 키 그대로. '오늘첫수업'의 새 과목 판정용(인재원 영어 → EiE, 수학 → 수학(심화)는 새 과목이 아니다).
 */
export function subjectGroupOf(
  subject: string | null | undefined,
  subjects: readonly ProgramSubject[],
): string | null {
  const key = subject?.trim();
  if (!key) return null;
  const program = programOf({ subject: key }, subjects);
  if (program === "math") return "math";
  if (program === "eie" || program === "injaewon") return "english";
  return key;
}

/** URL 값 정규화 — 모르는 값은 null(필터 없음). */
export function parseProgram(raw: unknown): Program | null {
  return raw === "eie" || raw === "injaewon" || raw === "math" ? raw : null;
}

/** 표시 라벨 — raw 코드('eie') 노출 금지. 수학은 학원설정의 `math` 라벨을 따른다. */
export function programLabel(program: Program, subjects: readonly ProgramSubject[]): string {
  if (program === "math") return subjects.find((s) => s.key === MATH_KEY)?.label ?? "수학";
  return ENGLISH_TRACK_LABEL[program];
}

/** 클라에 내려온 `key → 라벨` 표를 ProgramSubject 목록으로(라벨 조회용). */
export function programSubjectsOf(record: Readonly<Record<string, string>>): ProgramSubject[] {
  return Object.entries(record).map(([key, label]) => ({ key, label }));
}
