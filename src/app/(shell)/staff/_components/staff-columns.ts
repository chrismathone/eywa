/**
 * 직원 목록 열 정의 — **무엇을 어떤 순서로 볼지**를 사용자가 고른다(원장 지시 2026-07-31).
 *
 * 기본 순서는 직원명부 시트(2026년직원명부) 그대로다. 주민번호·계좌는 여기 없다 —
 * 이력서(원장·관리자 게이트) 안에 있을 정보라 목록 열로 만들지 않는다.
 *
 * 설정은 **순서(order)와 숨김(hidden)을 따로** 저장한다. 하나로 합쳐 '보이는 열 배열'만 저장하면
 * 나중에 열이 추가됐을 때 "사용자가 끈 것"과 "아직 몰랐던 새 열"을 구분할 수 없다 —
 * 새 열은 보여야 하고, 끈 열은 계속 꺼져 있어야 한다.
 */

export type StaffColumnKey =
  | "department"
  | "name"
  | "jobTitle"
  | "employmentType"
  | "email"
  | "hireDate"
  | "phone"
  | "contract"
  | "contractTerms"
  | "contractEnd"
  | "subjects"
  | "role"
  | "classes"
  | "students"
  | "status";

export const STAFF_COLUMNS: { key: StaffColumnKey; label: string; align?: "right" }[] = [
  { key: "department", label: "소속부서" },
  { key: "name", label: "이름" },
  { key: "jobTitle", label: "직급" },
  { key: "employmentType", label: "계약구분" },
  { key: "email", label: "메일" },
  { key: "hireDate", label: "입사일" },
  { key: "phone", label: "전화번호" },
  { key: "contract", label: "현재 계약" },
  { key: "contractTerms", label: "계약조건" },
  { key: "contractEnd", label: "계약갱신일" },
  { key: "subjects", label: "과목" },
  { key: "role", label: "역할" },
  { key: "classes", label: "담당 반", align: "right" },
  { key: "students", label: "담당 학생", align: "right" },
  { key: "status", label: "상태" },
];

const ALL_KEYS = STAFF_COLUMNS.map((c) => c.key);
const KNOWN = new Set<string>(ALL_KEYS);
export const LABEL_OF: Record<StaffColumnKey, string> = Object.fromEntries(
  STAFF_COLUMNS.map((c) => [c.key, c.label]),
) as Record<StaffColumnKey, string>;

/** 저장된 순서를 지금 코드에 맞춤 — 모르는 키는 버리고, **새 열은 뒤에 붙인다**(조용히 사라지지 않게). */
export function normalizeOrder(saved: readonly string[] | undefined | null): StaffColumnKey[] {
  const kept = (saved ?? []).filter((k, i, a) => KNOWN.has(k) && a.indexOf(k) === i) as StaffColumnKey[];
  return [...kept, ...ALL_KEYS.filter((k) => !kept.includes(k))];
}

/** 실제로 그릴 열. 전부 숨겨 빈 표가 되는 것만 막는다(그 경우 기본 순서 전체). */
export function visibleColumns(
  order: readonly StaffColumnKey[],
  hidden: readonly string[],
): StaffColumnKey[] {
  const off = new Set(hidden);
  const shown = order.filter((k) => !off.has(k));
  return shown.length > 0 ? shown : [...ALL_KEYS];
}

/** 한 칸 위/아래로 옮긴 새 순서(끝에서 더 못 감). */
export function moveColumn(
  order: readonly StaffColumnKey[],
  key: StaffColumnKey,
  dir: -1 | 1,
): StaffColumnKey[] {
  const i = order.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
