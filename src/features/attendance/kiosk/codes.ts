// 키오스크 출석번호 발급 — 순수함수. 실발송/DB 없음(테스트 강제 대상).
// 정책(사용자 확정): 학생 본인 휴대폰 뒷4자리 우선 → 없으면 학부모 휴대폰 뒷4자리.
// 같은 테넌트 내에서 충돌(형제 등 동일 뒷4자리)이면 뒤에 0~9를 붙여 5자리로 분기.
// 키오스크는 4자리/5자리가 공존하므로 자동제출 대신 '확인' 버튼으로 입력 확정(prefix 모호성 회피).

/** 전화번호 문자열에서 숫자만 남겨 뒤 4자리. 4자리 미만이면 null(미정규 `010-1234-5678`·`+82` 대비). */
export function last4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export type CodeAssignmentInput = {
  studentPhone?: string | null;
  parentPhone?: string | null;
  /** 같은 테넌트에서 이미 점유된 출석번호들(이 함수 호출 누적 포함). */
  takenCodes: Set<string>;
};

/**
 * 출석번호 배정.
 * - 전화번호(학생→학부모)로 base 4자리를 못 만들면 `null` (해당 학생은 발급 스킵).
 * - base가 비어 있으면 그대로 4자리.
 * - 충돌이면 base+`0`..`9` 중 첫 빈 자리(5자리).
 * - base와 base+0..9가 모두 점유되면 throw(동일 뒷4자리 11명+ — 운영상 거의 불가).
 *
 * 호출자는 반환값을 `takenCodes`에 넣어 다음 호출의 충돌 판정에 반영해야 한다.
 */
export function assignAttendanceCode(opts: CodeAssignmentInput): string | null {
  const base = last4(opts.studentPhone) ?? last4(opts.parentPhone);
  if (!base) return null;
  if (!opts.takenCodes.has(base)) return base;
  for (let i = 0; i <= 9; i++) {
    const candidate = `${base}${i}`;
    if (!opts.takenCodes.has(candidate)) return candidate;
  }
  throw new Error(`출석번호 공간 소진: 뒷4자리 ${base} 충돌 11건+`);
}

/** 키오스크 입력값 형식 검증(4 또는 5자리 숫자). */
export function isValidCodeInput(code: string): boolean {
  return /^\d{4,5}$/.test(code);
}
