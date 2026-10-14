/**
 * 콜&상담 '소개한 사람'(0361a) — 원생 하나 또는 직원 하나. 화면·서버가 같이 쓰는 순수 모듈(server-only 아님 — [[#61]]).
 *
 * 원장 2026-10-13(강사평가 결정 7): *"누구 소개로 왔다"가 인정된 경우에만* — 상담 경로('지인 소개')만으로는 누가
 * 소개했는지 모른다. 고르는 칸으로 잇고, 글에 적힌 이름은 **후보로만** 띄운다(자동 확정 안 함 — 침산 실측: 글에 붙은
 * 이름 201건 중 실제 원생·직원과 맞는 것 18건).
 * 폼 값 = 숨은 칸 `referrer` 하나(`s:<원생 id>` · `u:<직원 id>` · 빈 값) + 글로 받은 이름 `referrerName`(QR 신청서).
 */

export type ReferrerOption = {
  /** `s:<id>` 원생 · `u:<id>` 직원. */
  value: string;
  /** 고르기 칸에 보이는 이름(원생 = 이름, 직원 = 이름). */
  label: string;
  /** 이름 옆 부가 정보(원생 = 학교·학년, 직원 = '직원'). */
  hint: string;
};

const VALUE = /^(s|u):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const NAME_MAX = 40;

export const referrerValueOf = (kind: "student" | "staff", id: string) => `${kind === "student" ? "s" : "u"}:${id}`;

export function parseReferrerValue(value: string | null | undefined): { studentId: string | null; staffId: string | null } | null {
  const v = (value ?? "").trim();
  if (!v) return { studentId: null, staffId: null };
  const m = VALUE.exec(v);
  if (!m) return null;
  return m[1] === "s" ? { studentId: m[2]!, staffId: null } : { studentId: null, staffId: m[2]! };
}

export type ReferrerColumns = { referrer_student_id: string | null; referrer_staff_id: string | null; referrer_name: string | null };

/**
 * 폼 → DB 칸. 🔴 폼에 `referrer` 칸이 **없으면 손대지 않는다**(빈 객체) — 배포 직후 열려 있던 옛 화면이나 다른 저장 경로가
 * 소개 연결을 null로 지우지 않게. 같은 학원 사람인지는 DB 트리거(0361a)가 막는다.
 */
export function referrerColumns(formData: FormData): { cols: Partial<ReferrerColumns> } | { error: string } {
  if (!formData.has("referrer")) return { cols: {} };
  const parsed = parseReferrerValue(String(formData.get("referrer") ?? ""));
  if (!parsed) return { error: "소개한 사람을 다시 골라 주세요" };
  const name = String(formData.get("referrerName") ?? "").trim().slice(0, NAME_MAX);
  return { cols: { referrer_student_id: parsed.studentId, referrer_staff_id: parsed.staffId, referrer_name: name || null } };
}

/** 저장 전 ↔ 이번 저장 — 연결(원생·직원)이 바뀌었는지(감사로그 '소개한 사람'). 신청서 이름은 화면에서 못 고치니 보지 않는다. */
export function referrerChanged(before: Partial<ReferrerColumns>, after: Partial<ReferrerColumns>): boolean {
  return (before.referrer_student_id ?? null) !== (after.referrer_student_id ?? null)
    || (before.referrer_staff_id ?? null) !== (after.referrer_staff_id ?? null);
}

/** 글로 받은 소개자 이름 정리(QR 신청서) — 앞뒤 공백 · 길이 상한. */
export const cleanReferrerName = (raw: unknown): string | null => {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return s || null;
};

/**
 * 글 칸(신청서에 적은 소개자 이름 · 상담 경로 · 상담 내용 …)에 **이름 전체가 그대로** 나오는 원생·직원 — 후보로만 띄운다.
 * 두 글자 이상만 본다(한 글자 이름은 아무 글에나 걸린다). 같은 이름이 여럿이면(동명이인) 모두 후보로 — 사람이 고른다.
 */
export function findReferrerCandidates(
  texts: readonly (string | null | undefined)[], options: readonly ReferrerOption[], limit = 5,
): ReferrerOption[] {
  const text = texts.filter(Boolean).join(" \n ");
  if (!text.trim()) return [];
  const out: ReferrerOption[] = [];
  // 긴 이름부터 — 두 글자 이름이 아무 글에나 걸려 진짜 후보를 밀어내지 않게(상위 N 자르기, [[#84]]).
  for (const o of [...options].sort((a, b) => b.label.trim().length - a.label.trim().length)) {
    const name = o.label.trim();
    if (name.length < 2 || !text.includes(name)) continue;
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}
