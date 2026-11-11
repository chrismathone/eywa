/**
 * 신규생 **과목 기본 담당** — 순수 규칙(IO 없음 · Vitest). 띠 · '기본 담당 설정' 대화상자 · 저장 액션 · 감사로그가 같은 판정을 쓴다.
 *
 * 과목 기본 담당 = 학생·과목마다 따로 지정하지 않은 신규생 전체의 관리 담당(30·60·90일 콜 책임자) —
 * 표 `student_onboarding_manager_defaults`(지점 × 과목 한 줄 · s2_0062). 2026-11-11까지는 고치는 화면이 없어 DB에 직접 넣었다.
 *
 * 🔴 줄이 서는 과목 = **지금 과목**(학원 설정 `operations.subjects` 차례) + **EiE**(아래). 과목 목록에서 지운 과목의 줄은 표에 남아도
 *    화면에 서지 않고 저장도 받지 않는다 — 같은 키의 과목을 다시 만들면 그 줄이 다시 선다(결정 로그 enrollment-journey.md).
 * 🔴 EiE = 과목 목록에 없는 영어 프로그램 이름(`classes.english_track`)이다. 운영 DB에 `eie` 줄이 있고 종전 띠가 'EiE'로 보여 왔다 —
 *    그 줄이 **이미 있고 EiE 기능이 켜진 지점에서만** 줄로 세운다(새로 만들지 않는다). 신규생 관리의 과목 축은 반의 과목(`classes.subject`)이라
 *    EiE 반 학생은 '영어' 줄을 따른다 — `eie` 줄은 지금 어느 학생에게도 적용되지 않는다(대화상자가 그 줄에 밝힌다 · 가드 manager-defaults.test.ts).
 */
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import type { Person } from "./followup-model";

/** EiE 줄의 과목 키 — 반의 영어 프로그램 값(`english_track`)과 같은 글자. */
export const EIE_DEFAULT_SUBJECT = "eie";
/** EiE 반 학생이 실제로 따르는 줄(반의 과목 키). */
const ENGLISH_SUBJECT = "english";

/**
 * 기본 담당이 될 수 있는 역할 — DB 검증 트리거(`validate_onboarding_subject_manager` · s2_0062)와 같은 넷.
 * 서버 액션이 먼저 같은 조건으로 확인해 한글 사유를 내고, 트리거가 한 번 더 막는다(가드가 SQL의 목록과 맞춘다).
 */
export const NEWCOMER_MANAGER_ROLES = ["master", "admin", "manager", "counselor"] as const;

/** 화면에 내려보내는 기본 담당 한 줄 — `manager`가 null이면 지정했던 사람이 지금은 담당할 수 없다(퇴사·역할 변경). */
export type ManagerDefaultView = { subject: string; manager: Person | null; updatedAt: string };

/** 대화상자의 한 줄 — `updatedAt`이 null이면 아직 줄이 없다(저장 = 새 줄). */
export type ManagerDefaultRow = {
  subject: string;
  label: string;
  manager: Person | null;
  /** 표에 줄이 있다 — 있는데 `manager`가 null이면 '재지정 필요'. */
  assigned: boolean;
  updatedAt: string | null;
  /** 이 줄에만 붙는 사실 안내(EiE). */
  note?: string;
};

/** 과목 이름 — 과목 목록에 있으면 그 이름, EiE 줄은 프로그램 이름('EiE'). 모르는 키는 `labelOf`가 돌려준 그대로(지어내지 않는다). */
export function managerDefaultSubjectLabel(subject: string, labelOf: (key: string) => string): string {
  const label = labelOf(subject);
  return subject === EIE_DEFAULT_SUBJECT && label === subject ? ENGLISH_TRACK_LABEL.eie : label;
}

/**
 * 기본 담당 줄이 설 수 있는 과목 키(차례 = 학원 설정의 과목 차례 → EiE).
 * @param subjectKeys 학원 설정의 과목 키 · @param storedSubjects 표에 줄이 있는 과목 키 · @param eieOn EiE 기능이 켜진 지점인가
 */
export function managerDefaultSubjects(subjectKeys: readonly string[], storedSubjects: readonly string[], eieOn: boolean): string[] {
  const keys = [...new Set(subjectKeys)];
  const eie = eieOn && storedSubjects.includes(EIE_DEFAULT_SUBJECT) && !keys.includes(EIE_DEFAULT_SUBJECT);
  return eie ? [...keys, EIE_DEFAULT_SUBJECT] : keys;
}

/**
 * 대화상자의 줄 — 지금 과목마다 한 줄(기본 담당이 없으면 '지정 없음') + 서버가 내려준 줄 가운데 과목 목록에 없는 것(EiE).
 * `defaults`는 서버가 `managerDefaultSubjects`로 이미 거른 값이다(지운 과목의 줄은 오지 않는다).
 */
export function managerDefaultRows(
  options: readonly { value: string; label: string }[],
  defaults: readonly ManagerDefaultView[],
  labelOf: (key: string) => string,
): ManagerDefaultRow[] {
  const stored = new Map(defaults.map((d) => [d.subject, d]));
  const row = (subject: string, label: string): ManagerDefaultRow => {
    const d = stored.get(subject);
    return { subject, label, manager: d?.manager ?? null, assigned: !!d, updatedAt: d?.updatedAt ?? null };
  };
  const listed = new Set(options.map((o) => o.value));
  return [
    ...options.map((o) => row(o.value, o.label)),
    ...defaults.filter((d) => !listed.has(d.subject)).map((d) => ({
      ...row(d.subject, managerDefaultSubjectLabel(d.subject, labelOf)),
      ...(d.subject === EIE_DEFAULT_SUBJECT
        ? { note: `EiE 반 학생은 ‘${labelOf(ENGLISH_SUBJECT)}’ 기본 담당을 따릅니다 — 이 줄은 지금 어느 학생에게도 적용되지 않습니다.` }
        : {}),
    })),
  ];
}
