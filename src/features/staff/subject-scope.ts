// 직원관리 '과목 범위' — 이 사람에게는 직원관리를 열되 **그 과목 선생님만** 보이게 한다
// (원장 지시 2026-09-23: *"정유진에게 직원관리 메뉴를 오픈하고 영어 관련 선생님만 목록에 보이도록.
//  허은진에게 직원관리 메뉴를 오픈하고 수학 관련 선생님만 목록에 보이도록."*).
//
// 🔑 메뉴를 여는 것은 개인 예외(`permissions.userOverrides` — scripts/staff-access/narrow-staff-menu.mjs)이고,
//    여기는 **연 뒤에 무엇이 보이는가**만 정한다. 두 축을 섞지 말 것.
// 🔑 이름이 아니라 **user id**로 잠근다(급여명세서 명단 payslip-access.ts와 같은 규약 — 동명이인·개명에 안 흔들린다).
// 🔴 게이트는 목록 하나가 아니다([[#77]]) — 직원 상세·근무 설정·이력서·계정 관리·계약 액션이 전부
//    `server/subject-scope.ts`의 판정을 지난다. 새 직원 표면을 만들면 그 판정을 함께 걸 것.
// 🔴 super_admin은 자동 통과(원장 2026-08-13 *"superadmin은 앞으로 뭘 안해도 그냥 넣고봐"*) — 서버 쪽에서 처리.
// ⚠️ 과목이 비어 있는 직원(원장·데스크 등)은 어느 범위에도 안 든다 — 범위가 걸린 사람에겐 안 보인다.

/** 범위가 걸린 계정 → 볼 수 있는 과목 키(학원설정 `operations.subjects[].key`). */
export const STAFF_SUBJECT_SCOPES: Readonly<Record<string, readonly string[]>> = {
  "d3e9bcd1-f30e-4f5b-9e78-2ad509f1d06b": ["english"], // 정유진 (admin · 부원장 · 영어)
  // 수학(심화)는 학원 고유 과목 키 subject_1(2026-06-19 highmath → subject_1) — '수학 관련'에 함께 넣는다.
  "deff8b0b-29cf-461e-8eea-a6196dc2a126": ["math", "subject_1"], // 허은진 (admin · 부원장 · 수학)
};

/** 이 계정에 걸린 과목 범위. null = 범위 없음(전체). 순수 판정 — super_admin 통과는 서버 게이트가 붙인다. */
export function staffSubjectScopeOf(userId: string): readonly string[] | null {
  return STAFF_SUBJECT_SCOPES[userId] ?? null;
}

/** 범위 안인가 — 대상 직원의 담당 과목(`users.subjects`) 중 하나라도 범위에 들면 통과. */
export function isStaffInSubjectScope(
  scope: readonly string[] | null,
  subjects: readonly string[] | null | undefined,
): boolean {
  if (!scope) return true;
  return (subjects ?? []).some((s) => scope.includes(s));
}
