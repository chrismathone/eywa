import type { SubjectSetting } from "@/features/owner/settings-types";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { intakeGroupsOf } from "./intake-groups";

/**
 * 신규 콜&상담 **"이 상담이 그 과목 반에 배정됐나"의 과목 판정** — 한 벌(원장 2026-10-23 *"수학, 영어 과목별 재원생수가 제대로 체크되지 않는다"*).
 *
 * 상담 과목 칸은 자유 글자다(8월 옛 시트 이관: '수학' 504 · '영어' 380 · 'EIE' 195 · '영어 수학' 148 · '영수' 29 · '매쓰몽' 26 …).
 * 예전엔 네 곳(칸반 배지 · 상세 '배정된 반' · 운영실 '상담 진행' · '전일 / 이달 신규')이 그 글자를 **반 과목 키와 글자 그대로** 견줘
 * '수학' 상담이 수학 반을 다녀도 '배정 없음'이었다. 이제 전부 이 함수가 돌려준 **반 과목 키 목록**으로 견준다.
 *
 * · 빈칸 → `null` = 과목을 모른다 → 전 과목 수강으로 판정(종전 폴백 그대로)
 * · 읽힌다 → 그 묶음들의 반 과목 키 전부(묶음 판정 = 신규 문의 추이·관리현황과 같은 `intakeGroupsOf` — 'EIE' = 영어 · '영어 수학' = 둘 다)
 * · 못 읽는다 → `[]` = **배정 없음**(종전과 같은 보수적 동작 — '영수'·'고등특강'·'설명회 문의'를 아무 과목으로 추정해 다른 과목 수강으로
 *   '배정 완료'를 만들지 않는다)
 *
 * 🔴 묶음 판정을 새로 만들지 말 것 — 상담 글자는 `intakeGroupsOf`, 반 과목 키는 `subjectGroupOf`(원생목록 프로그램 판정과 같은 묶음).
 * 순수 모듈 — 서버·클라 공용(`server-only` 금지, #61).
 */
export type ConsultClassKeys = readonly string[] | null;

/**
 * 묶음들 → 그 묶음에 드는 반 과목 키(학원 설정 과목 키 + 묶음 키 자신 — 수학 묶음 `math`·영어 묶음 `english`는 설정 이름과 무관하게
 * 그 과목 반이다(`programOf`) · 그 밖의 묶음은 과목 키 그대로). 묶음 판정은 `intakeGroupsOf`와 같은 표(옛 표시 라벨 포함)로 한다.
 */
export function classKeysOfGroups(groups: readonly string[], subjects: readonly SubjectSetting[]): string[] {
  if (groups.length === 0) return [];
  const want = new Set(groups);
  const programSubjects = programSubjectsOf(subjectLabelRecord([...subjects]));
  const keys = new Set<string>();
  for (const key of [...subjects.map((s) => s.key), ...groups]) {
    const group = subjectGroupOf(key, programSubjects);
    if (group && want.has(group)) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * 상담 과목 글자 → 이 상담이 볼 반 과목 키 목록(같은 학원 설정으로 여러 번 부를 때 — 글자마다 한 번만 계산한다).
 * @returns 함수: 빈칸 `null` · 못 읽음 `[]` · 그 밖은 키 목록.
 */
export function consultClassKeysOf(subjects: readonly SubjectSetting[]): (subject: string | null | undefined) => ConsultClassKeys {
  const groupsOf = intakeGroupsOf(subjects);
  const memo = new Map<string, string[]>();
  return (subject) => {
    const text = subject?.trim();
    if (!text) return null;
    let keys = memo.get(text);
    if (!keys) {
      keys = classKeysOfGroups(groupsOf(text), subjects);
      memo.set(text, keys);
    }
    return keys;
  };
}

/** 한 번만 볼 때 — `consultClassKeysOf(subjects)(subject)`. */
export function consultClassKeys(subject: string | null | undefined, subjects: readonly SubjectSetting[]): ConsultClassKeys {
  return consultClassKeysOf(subjects)(subject);
}

/** 이 반 과목이 상담이 보는 반인가 — `null`(과목 모름)은 모든 반 · `[]`(못 읽음)은 어떤 반도 아니다. 메모리에서 거르는 세 곳이 이 판정을 쓴다. */
export function inConsultClasses(keys: ConsultClassKeys, classSubject: string | null | undefined): boolean {
  if (keys === null) return true;
  return !!classSubject && keys.includes(classSubject);
}
