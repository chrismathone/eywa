/**
 * 원생 형제 판정 — 순수(IO 없음 · Vitest). 원장 2026-10-19 *"학생에게 학부모 이름 또는 전화번호가 일치하는 다른 학생이 있으면
 * 형제로 표시"* · *"수동 배정도 가능하게 해주고. (수동 이전에 매핑되는 학생 있으면 자동 추천 및 입력)"*.
 * 쓰는 곳: 학생 상세 '프로필'의 형제 줄 · 학생 수정 화면의 형제 칸(자동 추천을 미리 채움) · 저장(0376a `student_siblings`).
 *
 * 자동 판정(저장하지 않고 볼 때마다):
 *  · 학부모 휴대폰이 같다 → 형제(숫자만 · +82→0 · 휴대폰만 — `phoneKeyOf`, 콜&상담 같은 학생 판정과 같은 열쇠).
 *    보호자2 휴대폰(s2_0024)도 같은 근거다 — 두 원생의 보호자1·보호자2 번호 중 하나라도 겹치면 형제(한 집의 엄마·아빠 번호가 갈려 적힌다).
 *  · 학부모 이름이 같고 연락처가 부딪히지 않는다(한쪽이라도 보호자 휴대폰이 하나도 없다) → 형제
 *  · 🔴 학부모 이름만 같고 휴대폰이 서로 다르면 형제로 치지 않는다 — 수정 화면에 '확인 후보'로만 띄운다.
 *    2026-10-19 침산 실측: 이름만 같은 17쌍이 전부 휴대폰이 6~8자리 달랐고 아이 성도 대부분 달랐다(다른 집 학부모의 같은 이름).
 *  · 학생 이름이 같으면(접미사 A·B 무시) 형제가 아니다 — 같은 아이의 중복 기록이다(실측 8쌍).
 * 사람이 정한 것(표의 linked)이 자동 판정보다 앞선다: true = 형제 · false = 자동 판정을 끈 짝.
 */
import { personName, phoneKeyOf } from "@/features/enrollment/same-person";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";
import type { SheetLang } from "@/features/teacher-view/i18n";
import { studentStatusLabel } from "./status/status-labels";

export type SiblingPerson = {
  id: string;
  name: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  /** 보호자2 연락처(s2_0024) — 없으면 보호자1 번호만 본다(종전과 같다). */
  parent2_phone?: string | null;
};

/** 한 원생의 보호자 휴대폰 열쇠(보호자1·보호자2) — 일반전화·빈 값은 빠진다. */
export function guardianPhoneKeys(p: Pick<SiblingPerson, "parent_phone" | "parent2_phone">): Set<string> {
  return new Set([phoneKeyOf(p.parent_phone), phoneKeyOf(p.parent2_phone)].filter((k): k is string => !!k));
}

/** 수정 화면 형제 칸의 한 줄(고르기 목록 · 미리 넣은 형제 · 확인 후보). `auto` = 자동 판정으로 미리 넣은 원생. */
export type SiblingOption = { value: string; label: string; hint: string; auto?: boolean };

/** 자동 판정 결과 — phone·name = 형제 · conflict = 학부모 이름만 같고 휴대폰이 다름(확인 후보). */
export type SiblingBasis = "phone" | "name" | "conflict";

/** 학생 이름에서 동명이인 접미사(한글 뒤 라틴 1~2자)를 뗀 비교값 — 영문 이름은 그대로 둔다. */
function childKey(name: string | null | undefined): string {
  return personName(name).replace(/^(.*[가-힣])[a-z]{1,2}$/, "$1");
}

export function siblingBasis(me: SiblingPerson, other: SiblingPerson): SiblingBasis | null {
  if (me.id === other.id) return null;
  const mine = childKey(me.name);
  if (mine && mine === childKey(other.name)) return null;
  const pa = guardianPhoneKeys(me);
  const pb = guardianPhoneKeys(other);
  if ([...pa].some((k) => pb.has(k))) return "phone";
  const na = personName(me.parent_name);
  if (na.length >= 2 && na === personName(other.parent_name)) return pa.size > 0 && pb.size > 0 ? "conflict" : "name";
  return null;
}

/** 짝의 저장 순서(0376a `student_a < student_b`) — uuid는 소문자 16진 글자 순 = DB 순서. */
export function siblingPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** 화면에 형제로 보일 원생 = (자동 판정 ∪ 사람이 형제로 지정) − 사람이 뺀 짝. */
export function resolveSiblingIds(auto: Iterable<string>, links: ReadonlyMap<string, boolean>): string[] {
  const out = new Set<string>();
  for (const id of auto) if (links.get(id) !== false) out.add(id);
  for (const [id, linked] of links) if (linked) out.add(id);
  return [...out];
}

/**
 * 수정 화면 저장 → 표에 쓸 것 — 🔴 **화면에서 바꾼 것만** 쓴다(손대지 않은 칩은 쓰지 않는다).
 * `final` = 저장할 때 화면에 남은 형제 · `initial` = 그 화면을 열 때 있던 형제 · `auto` = 열 때 자동 판정이 형제라 한 원생.
 *  · 더한 원생(final − initial) → '형제로 지정'
 *  · 뺀 원생(initial − final) → 자동 판정이면 '형제 아님'(다시 안 들어오게) · 아니면(지정이었다) 줄 삭제
 * 손대지 않은 자동 추천은 저장하지 않고 계속 자동 판정으로 보인다 — 연락처를 고치면 따라 바뀐다(잘못된 번호로 묶인 짝이 굳지 않는다).
 * 열어 둔 사이 다른 원생 화면에서 바꾼 짝도 덮지 않는다(그 칩을 이 화면에서 건드리지 않았으면).
 */
export function planSiblingSave(
  final: Iterable<string>,
  initial: Iterable<string>,
  auto: Iterable<string>,
): { set: { other: string; linked: boolean }[]; remove: string[] } {
  const keep = new Set(final);
  const before = new Set(initial);
  const autoSet = new Set(auto);
  const set: { other: string; linked: boolean }[] = [];
  const remove: string[] = [];
  for (const id of keep) if (!before.has(id)) set.push({ other: id, linked: true });
  for (const id of before) {
    if (keep.has(id)) continue;
    if (autoSet.has(id)) set.push({ other: id, linked: false });
    else remove.push(id);
  }
  return { set, remove };
}

/** 형제 이름 옆 꼬리 — "칠성초4" · 재원이 아니면 상태("칠성초4 · 퇴원"). 상세 프로필·수정 화면이 같은 표기(강사 영어 화면은 영어). */
export function siblingHint(s: { school: string | null; grade: string | null; status: string }, lang: SheetLang = "ko"): string {
  return [sheetSchoolGrade(s.school, s.grade, lang) || null, s.status !== "enrolled" ? studentStatusLabel(s.status, lang) : null]
    .filter(Boolean)
    .join(" · ");
}
