/**
 * 인재원 학생 ↔ eywa 학생 **짝 제안** — 순수 함수(Vitest로 잠금).
 *
 * 🔴 **자동으로 잇지 않는다** — 인재원엔 생년월일·학교가 없어 동명이인을 가를 수 없다(설명서 ④).
 *    여기서는 "이 사람일 것 같다"를 **제안**만 하고, 잇는 것은 관리자가 누른다(makeedu_id 선례).
 * 🔑 후보 근거는 셋이고 화면에 그대로 밝힌다(누르기 전에 무엇을 믿는지 알게):
 *    ① 이름이 같음 ② 아이디 머리글자 + 인재원 반 이름이 eywa 영어 반과 같음 ③ 아이디 머리글자만.
 *    인재원 영어 학생은 대부분 이름 = 로그인 아이디(`ijwgsy`)라 ②③이 주로 쓰인다(romanize.ts).
 * 🔴 "한 번에 연결"은 **이름이 양쪽 모두 유일할 때만**이고, 유일은 **보이는 후보가 아니라 전체**로 센다
 *    (적대 리뷰 2026-09-10): 후보 모집단은 '지금 영어 반을 다니는 짝 없는 학생'이라, 8월에 그만둔 김민준의
 *    인재원 계정과 9월에 온 다른 김민준이 둘 다 "하나뿐"으로 보여 새 아이가 옛 아이 기록에 이어졌다.
 *    그래서 ① eywa는 **학원 전체 학생(퇴원생 포함)**, ② 인재원은 **짝이 이미 걸린 계정까지 포함한 전체 명단**으로 세고,
 *    ③ 동명이인 접미(`박서연B`)가 붙은 이름은 그 자체로 동명이인이 있다는 증거라 한 번에 잇지 않는다.
 */
import { ijwIdCore, romanInitialSets } from "./romanize";

export type LinkableIjwStudent = { ijwId: string; name: string; className: string | null };
export type LinkableEywaStudent = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 이미 걸린 짝(students.ijw_student_id). */
  ijwId: string | null;
  /** 지금 다니는 영어 반 이름들(후보 근거·표시용). */
  classNames?: readonly string[];
};

export type LinkReason = "name" | "id-class" | "id";
export type LinkCandidate = LinkableEywaStudent & { reason: LinkReason };

export type LinkSuggestion = {
  ijw: LinkableIjwStudent;
  /** 후보(근거가 강한 순, 최대 CANDIDATE_MAX명) — 아직 짝이 없는 eywa 학생만. */
  candidates: LinkCandidate[];
  /** 이름이 양쪽 **전체**에서 유일하면 그 한 명 — '한 번에 연결' 대상. 아니면 null(사람이 고른다). */
  unique: LinkableEywaStudent | null;
};

/** '한 번에 연결'의 유일성 판정 재료 — 없으면 한 번에 잇지 않는다(fail-closed). */
export type UniqueGuard = {
  /** 이 학원 **전체** 학생(상태 불문 — 퇴원생 포함)의 이름 키별 인원(`countNameKeys`). */
  eywaNameCounts: ReadonlyMap<string, number>;
};

const CANDIDATE_MAX = 6;
const REASON_RANK: Record<LinkReason, number> = { name: 0, "id-class": 1, id: 2 };

/**
 * 동명이인 접미 — 한글 이름 끝의 대문자 한 자(`박서연C`), A~Z를 다 쓴 뒤엔 숫자(`학원이2`,
 * students/name-suffix.ts `resolveUniqueStudentName`과 같은 규약).
 */
const HOMONYM_SUFFIX_RE = /([가-힣])(?:[A-Z]|\d+)$/;

/**
 * 비교용 이름 — 공백과 동명이인 접미를 뗀다.
 * ⚠️ 로마자 이름(`Kevin`)을 통째로 지우지 않는다 — 비교 키가 빈 문자열이 되면 후보가 사라진다.
 */
export function linkNameKey(name: string): string {
  return name.replace(/\s+/g, "").replace(HOMONYM_SUFFIX_RE, "$1");
}

/** 동명이인 접미가 붙은 이름인가(`박서연B`·`학원이2`) — 이 학원이 동명이인을 가를 때 붙이는 표식이다. */
export function hasHomonymSuffix(name: string): boolean {
  return HOMONYM_SUFFIX_RE.test(name.replace(/\s+/g, ""));
}

/** 이름 키별 인원(빈 키는 세지 않는다). */
export function countNameKeys(names: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of names) {
    const k = linkNameKey(n ?? "");
    if (k) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * 아직 짝이 없는 인재원 학생마다 후보를 모은다. 이미 짝이 있는 쪽(인재원 id가 어떤 eywa 학생에 걸려 있거나
 * eywa 학생에 짝이 있으면)은 후보에서 뺀다 — 한 사람을 두 번 잇지 않게.
 * `guard`가 없으면 `unique`는 언제나 null이다(유일성을 전체로 확인하지 못하면 한 번에 잇지 않는다).
 */
export function suggestLinks(
  ijwStudents: readonly LinkableIjwStudent[],
  eywaStudents: readonly LinkableEywaStudent[],
  guard?: UniqueGuard,
): LinkSuggestion[] {
  const linkedIjw = new Set(eywaStudents.map((s) => s.ijwId).filter((v): v is string => !!v));
  const free = eywaStudents.filter((s) => !s.ijwId);
  const eywaByKey = new Map<string, LinkableEywaStudent[]>();
  const initialsOf = new Map<string, ReadonlySet<string>>();
  for (const s of free) {
    const k = linkNameKey(s.name);
    if (k) eywaByKey.set(k, [...(eywaByKey.get(k) ?? []), s]);
    initialsOf.set(s.id, new Set(romanInitialSets(linkNameKey(s.name))));
  }
  // 🔴 인재원 쪽은 **전체 명단**(짝이 이미 걸린 계정 포함)으로 센다 — 짝 있는 동명 계정이 있으면 유일이 아니다.
  const ijwKeyCount = countNameKeys(ijwStudents.map((s) => s.name || s.ijwId));
  const pending = ijwStudents.filter((s) => !linkedIjw.has(s.ijwId));
  return pending
    .map((ijw) => {
      const key = linkNameKey(ijw.name || ijw.ijwId);
      const byName = key ? (eywaByKey.get(key) ?? []) : [];
      const core = ijwIdCore(ijw.ijwId);
      const byId =
        core.length >= 2
          ? free.filter((s) => !byName.includes(s) && initialsOf.get(s.id)?.has(core))
          : [];
      const candidates: LinkCandidate[] = [
        ...byName.map((s) => ({ ...s, reason: "name" as const })),
        ...byId.map((s) => ({
          ...s,
          reason: (ijw.className && s.classNames?.includes(ijw.className) ? "id-class" : "id") as LinkReason,
        })),
      ]
        .sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || a.name.localeCompare(b.name, "ko"))
        .slice(0, CANDIDATE_MAX);
      const only = byName.length === 1 ? byName[0]! : null;
      const unique =
        guard &&
        only &&
        ijwKeyCount.get(key) === 1 &&
        guard.eywaNameCounts.get(key) === 1 &&
        !hasHomonymSuffix(only.name) &&
        !hasHomonymSuffix(ijw.name)
          ? only
          : null;
      return { ijw, candidates, unique };
    })
    .sort(
      (a, b) =>
        Number(b.candidates.length > 0) - Number(a.candidates.length > 0) ||
        (a.ijw.className ?? "").localeCompare(b.ijw.className ?? "", "ko") ||
        a.ijw.name.localeCompare(b.ijw.name, "ko"),
    );
}
