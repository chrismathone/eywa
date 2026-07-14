// 학생 이름 중복 방지 — 같은 이름이 이미 있으면 다음 빈 알파벳 접미사(A·B·C…)를 강제 부여.
// ijw/makeedu 규약: 첫 번째는 plain, 두 번째부터 접미사(예: 학원이 → 학원이, 학원이A / 박서준 → 박서준, 박서준B, 박서준C).
// 순수 함수(Vitest). taken = 테넌트 전체 학생 이름(trim), 상태 무관(퇴원 포함) — 표시 이름을 절대 유일하게.

const SUFFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** 끝의 라틴 대문자 1개(접미사)를 떼어낸 base. 한글 이름 + A/B/C 규약 전제(한글은 [A-Z]로 안 끝남). */
export function baseNameOf(name: string): string {
  return name.trim().replace(/[A-Z]$/, "");
}

/**
 * 겹치지 않는 학생 이름 확정.
 * - 빈 이름이거나 taken에 없으면 입력 그대로(첫 번째 = plain, 또는 자유 입력).
 * - 이미 있으면 base + 다음 빈 알파벳(A→Z), A~Z 소진 시 base+숫자(2,3…) 폴백.
 */
export function resolveUniqueStudentName(
  desired: string,
  taken: ReadonlySet<string>,
): { name: string; suffixed: boolean } {
  const d = desired.trim();
  if (!d || !taken.has(d)) return { name: d, suffixed: false };
  const base = baseNameOf(d);
  for (const s of SUFFIXES) {
    if (!taken.has(base + s)) return { name: base + s, suffixed: true };
  }
  let n = 2;
  while (taken.has(base + String(n))) n++;
  return { name: base + String(n), suffixed: true };
}
