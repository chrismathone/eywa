/**
 * 과목 관리자 카드의 **과목별 값(slice)** — 원장 2026-10-14 2단계 *"과목별로 나눠서(해당 과목 관리자일 경우)"*.
 *
 * 서버는 한 영역을 **한 번만** 조회하고, 받은 행을 담당 과목으로 걸러 **같은 집계 함수를 한 번 더** 돌린다(`addSliced`).
 * 학원 전체 값과 과목별 값이 같은 함수에서 나오므로 두 숫자의 뜻이 갈리지 않는다.
 *
 * 판정(원장 결정 2026-10-14):
 *  · 과목을 모르는 기록(과목 안 고른 상담 · 반 배정 전 학생 · 반 이름으로 못 가른 청구 항목) = **모든 과목 관리자에게** 보인다.
 *  · 두 과목을 듣는 학생 = **양쪽 모두에** 든다(영어 관리자도, 수학 관리자도 그 학생을 센다).
 *  · 한 관리자가 두 과목을 맡으면 그 합집합 — 학생은 한 번만 센다(집계를 합집합 행으로 다시 돌리므로 더하지 않는다).
 *
 * 순수 모듈 — 서버·편집기 미리보기 공용(#61).
 */
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import type { Area, OverviewData } from "@/features/dashboard/overview/model";
import type { GroupOf } from "./narrow";

/** 과목 묶음 집합 → 값 표의 키("english" · "math" · "english+math"). */
export function sliceKey(groups: readonly string[]): string {
  return [...new Set(groups)].sort().join("+");
}

/** 이 과목(키)의 기록이 담당 묶음에 드는가 — 과목을 모르면(빈 값·설정에 없는 키) 든다. */
export type SlicePredicate = (subject: string | null | undefined) => boolean;

/** 기록 하나의 과목 칸 → 묶음 목록. 빈 목록 = '모름'. */
export type GroupsOf = (subject: string | null | undefined) => string[];

export function slicePredicate(groups: readonly string[], groupsOf: GroupsOf): SlicePredicate {
  const set = new Set(groups);
  return (subject) => {
    const gs = groupsOf(subject);
    return gs.length === 0 || gs.some((g) => set.has(g));
  };
}

const SEPARATOR = /[\s,+/·&()[\]]/;

/**
 * 과목 이름이 아닌 **프로그램 이름** → 묶음(원장 2026-10-14 *"매쓰몽 수학"*). 학원 설정에 과목 별칭 칸이 없어 여기 둔다 —
 * 그 묶음이 학원 설정에 있을 때만 쓴다(수학이 없는 지점엔 아무 일도 안 한다). 설정에 별칭 칸이 생기면 그리로 옮길 것.
 */
const PROGRAM_NAMES: Readonly<Record<string, string>> = { 매쓰몽: "math" };

/** 과목 이름표 — 키·이름(학원 설정에 **있는** 과목만) + 영어 갈래 이름(EiE·인재원 영어 — `english_track`, 코드 고정 개념) + 프로그램 이름(`PROGRAM_NAMES`). 긴 이름 먼저. */
function subjectNames(subjects: readonly { key: string; label: string }[], groupOf: GroupOf): [name: string, group: string][] {
  const names: [string, string][] = [];
  for (const s of subjects) {
    const g = groupOf(s.key);
    if (!g) continue;
    names.push([s.key.trim().toLowerCase(), g]);
    if (s.label.trim()) names.push([s.label.trim().toLowerCase(), g]);
  }
  if (names.some(([, g]) => g === "english")) for (const label of Object.values(ENGLISH_TRACK_LABEL)) names.push([label.toLowerCase(), "english"]);
  for (const [name, g] of Object.entries(PROGRAM_NAMES)) if (names.some(([, k]) => k === g)) names.push([name, g]);
  // 긴 이름 먼저 — 'subject_10'을 'subject_1'로, '수학(심화)'를 '수학'으로 잘못 끊지 않게.
  return names.filter(([name]) => name).sort((a, b) => b[0].length - a[0].length);
}

/**
 * 과목별 값을 가를 때 쓰는 묶음 판정. `subjects`엔 **학원 설정의 과목만** 넘긴다(옛 표시용 라벨 '예술·사회·기타'를 섞으면
 * 자유 입력 '기타'가 설정에 있는 과목이 되어 아무에게도 안 보인다 — 재리뷰 2026-10-14).
 * 콜&상담의 과목 칸은 **자유 입력**이라(옛 기록 실측: 'EIE' 195 · '영어 수학' 148 · 'EiE' 132 · '영어, 수학' 75 …) 칸을 앞에서부터
 * 읽는다 — 구분자(띄어쓰기·쉼표·+·/·괄호)는 건너뛰고, 그 자리에서 시작하는 가장 긴 과목 이름을 읽는다('영어수학' · 'EIE, 수학'
 * → 영어+수학, 영문은 대소문자 무시 · '매쓰몽' = 수학). **못 읽는 낱말이 하나라도 남으면 칸 전체가 '모름'**(빈 목록 = 모든 과목
 * 관리자에게) — 'EiE 고등특강'을 영어로만 읽으면 특강이 수학일 때 수학 관리자에게서 사라진다(재리뷰 2026-10-14). '중국어'·'과학고'·
 * '수학 특강'도 모름이다(숨는 쪽보다 더 보이는 쪽이 낫다 — 원장 결정 1).
 * 두 묶음이 읽히면 양쪽 관리자 모두에게 든다(원장 결정 4). 원장 2026-10-14 *"EiE와 영어가 왜 과목 이름이 맞지 않지? 영어 아닌가"*.
 * 🔴 읽는 방법일 뿐 — 카드의 조회 기간(오늘·60일·두 달)은 그대로다. 옛 기록까지 연결하지 않는다(원장 *"너무 과거건까지 연결하지말것"*).
 */
export function sliceGroupsOf(subjects: readonly { key: string; label: string }[], groupOf: GroupOf): GroupsOf {
  const names = subjectNames(subjects, groupOf);
  return (subject) => {
    const text = subject?.trim().toLowerCase();
    if (!text) return [];
    const found = new Set<string>();
    for (let i = 0; i < text.length; ) {
      if (SEPARATOR.test(text[i]!)) {
        i++;
        continue;
      }
      const hit = names.find(([name]) => text.startsWith(name, i));
      if (!hit) return [];
      found.add(hit[1]);
      i += hit[0].length;
    }
    return [...found];
  };
}

/** 한 묶음만 읽히면 그 묶음, 여럿이거나 모르면 null — 행 좁히기(`narrow.ts`)·과목 키 고르기처럼 한 값이 필요한 곳. */
export function sliceGroupOf(subjects: readonly { key: string; label: string }[], groupOf: GroupOf): GroupOf {
  const groupsOf = sliceGroupsOf(subjects, groupOf);
  return (subject) => {
    const gs = groupsOf(subject);
    return gs.length === 1 ? gs[0]! : null;
  };
}

/** 여러 과목에 걸친 한 사람(학생) — 하나라도 담당 묶음이거나, 과목을 하나도 모르면 든다. */
export function inSliceAny(pred: SlicePredicate, subjects: readonly (string | null | undefined)[]): boolean {
  return subjects.length === 0 || subjects.some(pred);
}

const HANGUL = /[가-힣]/;
const LATIN = /[a-z0-9]/i;

/** 이 자리의 이름이 낱말로 서 있나 — 영문 이름은 앞뒤에 영문·숫자가 없을 때('EiE입테'는 된다), 한글 이름은 앞에 한글이 없고
 *  바로 뒤가 '고'(학교 — '과학고')가 아닐 때('중국어'의 '국어'는 안 되고 붙여 쓴 '수학입테'는 된다). */
function standsAlone(text: string, name: string, at: number): boolean {
  const before = text[at - 1] ?? "";
  const after = text[at + name.length] ?? "";
  if (LATIN.test(name[0]!)) return !LATIN.test(before) && !LATIN.test(after);
  return !HANGUL.test(before) && after !== "고";
}

/**
 * 글(일정 제목·태그)에 적힌 과목 이름 목록(소문자) — 이름표는 `sliceGroupsOf`와 같다(설정 과목의 키·이름 + EiE·인재원 영어)라
 * 돌려준 이름을 과목 판정(`slicePredicate`)이 그대로 읽는다.
 * 문장이라 칸 전체를 읽지 않고 **낱말로 선 이름만** 찾는다(`standsAlone`) — '중국어'의 '국어', '○○과학고'의 '과학'을 과목으로
 * 읽으면 그 일정이 영어·수학 관리자에게서 사라진다(적대 리뷰 2026-10-14). 'EiE 입테'는 영어로 읽는다(재리뷰 — 콜&상담과 같은 이름표).
 */
export function subjectsNamedIn(text: string, subjects: readonly { key: string; label: string }[], groupOf: GroupOf): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [name] of subjectNames(subjects, groupOf)) {
    if (name.includes("_")) continue; // 내부 키('subject_1')는 제목에 안 적힌다
    for (let at = lower.indexOf(name); at !== -1; at = lower.indexOf(name, at + 1)) {
      if (standsAlone(lower, name, at)) {
        found.push(name);
        break;
      }
    }
  }
  return found;
}

/** 영역마다 과목별 값 표. 서버 안에서만 쓰고, 편집기 미리보기 원본(`full`)에만 실린다. */
export type SliceTable = { [K in Area]?: Record<string, OverviewData[K]> };

/** 과목별 값이 있는 영역 — 과목 관리자 화면에선 학원 전체 값 대신 이것을 싣는다. */
export function applySlices<S extends { [K in Area]?: { data: OverviewData[K] | null } }>(sections: S, slices: SliceTable | undefined, key: string): S {
  if (!slices || !key) return sections;
  const out = { ...sections };
  for (const area of Object.keys(slices) as Area[]) {
    const value = slices[area]?.[key];
    const section = out[area];
    if (value === undefined || !section || section.data === null) continue;
    Object.assign(out, { [area]: { ...section, data: value } });
  }
  return out;
}
