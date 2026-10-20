// 직원관리 '과목 범위' — 이 사람에게는 직원관리를 열되 **그 과목 선생님만** 보이게 한다
// (원장 지시 2026-09-23: *"정유진에게 직원관리 메뉴를 오픈하고 영어 관련 선생님만 목록에 보이도록.
//  허은진에게 직원관리 메뉴를 오픈하고 수학 관련 선생님만 목록에 보이도록."*).
//
// 🔑 범위는 학원 설정 '역할·권한'의 개인별 기능 권한에서 지정한다(`permissions.specialAccess.staffSubjectScopes` —
//    원장 2026-10-06 *"개인 역할은 전부다 편집기"*). 전에는 이 파일이 계정 둘을 들고 있었다.
//    🔴 여기에 계정 명단을 다시 만들지 말 것(가드: subject-scope.test.ts).
// 🔑 메뉴를 여는 것은 메뉴 권한(역할 칸·개인별 메뉴 권한)이고, 여기는 **연 뒤에 무엇이 보이는가**만 정한다. 두 축을 섞지 말 것.
// 🔴 게이트는 목록 하나가 아니다([[#77]]) — 직원 상세·근무 설정·이력서·계정 관리·계약 액션이 전부
//    `server/subject-scope.ts`의 판정을 지난다. 새 직원 표면을 만들면 그 판정을 함께 걸 것.
// 🔴 운영 계정은 자동 통과(원장 2026-08-13) — 서버 쪽에서 처리.
// ⚠️ 과목이 비어 있는 직원(원장·데스크 등)은 어느 범위에도 안 든다 — 범위가 걸린 사람에겐 안 보인다.
// ⚠️ 범위의 과목이 학원 설정에서 없어지면(삭제·다른 과목에 흡수) 그 키는 아무와도 안 맞는다 — **좁은 쪽으로** 남고,
//    설정 화면이 '(없어진 과목)'으로 보여 준다(역할·권한은 원장만 저장하므로 과목 흡수가 이 값을 대신 고치지 않는다).

/** 저장된 범위 한 줄 — 그 사람(userId)이 볼 수 있는 과목 키(학원설정 `operations.subjects[].key`). */
export type StaffSubjectScope = { userId: string; subjects: readonly string[] };

/**
 * 이 계정에 걸린 과목 범위. null = 범위 없음(전체). 순수 판정 — 운영 계정 통과는 서버 게이트가 붙인다.
 * 🔴 저장값은 스키마를 거치지 않고 읽힌다 — 그 사람의 줄이 있는데 과목 칸이 깨져 있으면 **빈 범위**(아무도 안 보임)로 본다.
 *    '범위 없음'으로 읽으면 깨진 값 하나에 전 직원이 열린다.
 */
export function staffSubjectScopeOf(userId: string, scopes: unknown): readonly string[] | null {
  if (!Array.isArray(scopes)) return null;
  const row = scopes.find((r): r is { userId: string; subjects?: unknown } =>
    typeof r === "object" && r !== null && (r as { userId?: unknown }).userId === userId);
  if (!row) return null;
  return Array.isArray(row.subjects) ? row.subjects.filter((s): s is string => typeof s === "string") : [];
}

/** 범위 안인가 — 대상 직원의 담당 과목(`users.subjects`) 중 하나라도 범위에 들면 통과. */
export function isStaffInSubjectScope(
  scope: readonly string[] | null,
  subjects: readonly string[] | null | undefined,
): boolean {
  if (!scope) return true;
  return (subjects ?? []).some((s) => scope.includes(s));
}
