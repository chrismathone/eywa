/**
 * ECS 주간 랜딩 — **강사 본인 화면일 때의 묶음**(원장 2026-09-05 *"주간 시트에서 내 이름(강사)가 나오고
 * 하단에 '담임' '부담임' 목록으로 나오게 할 것. 현재는 그냥 담당 강사만 나옴. 심지어 내 화면인데도"*).
 *
 * 무엇이 문제였나: 목록은 [담임별로 묶는다](./landing-groups.ts)(2026-08-11 *"열마다 담임 구분해서 놓자"*).
 * 그건 **사무실 화면**의 질문("누가 안 썼나")에 맞는 축이다. 그런데 강사 본인이 열면 보이는 반이
 * 담임∪부담임∪위임인데 묶음 머리는 **남의 이름**(그 반 담임)이라, **내 화면인데 내 이름이 어디에도 없고**
 * 내가 담임인 반과 들어가기만 하는 반이 섞여 보인다(실측: 부담임 9반이 송지혜·추민아 두 묶음으로 떴다).
 *
 * 그래서 강사 화면에서는 축을 **"이 반에서 나는 무엇인가"**로 바꾼다 — 담임 / 부담임 두 갈래.
 *
 * 🔴 **판정은 `teacherId` 하나뿐**(이름 비교 금지 — 동명이인이면 남의 반이 내 담임 반이 된다).
 * 🔴 **부담임은 "담임이 아닌 나머지 전부"**다(비대칭). 슬롯 담당인지 위임인지는 여기서 가르지 않는다 —
 *    카드가 그 근거를 들고 있지 않고, 억지로 나누면 위임 반이 어느 쪽에도 못 서서 사라진다.
 *    (필터 칩의 EiE/인재원 비대칭과 같은 결: 모르는 것은 넓은 쪽에 둔다.)
 * ⚠️ 빈 갈래는 만들지 않는다 — 담임 반만 있는 강사에게 빈 '부담임' 머리가 서면 "내가 뭘 빠뜨렸나"가 된다.
 * ⚠️ 반 순서는 **서버가 준 그대로**(반 이름순) — 묶음 안에서 다시 정렬하지 않는다(담임별 묶음과 같은 규약).
 */
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import { summarizeLanding, type LandingSummary } from "./landing-summary";
import type { TeacherGroupable } from "./landing-groups";

export type MyRoleKey = "homeroom" | "assistant";

/**
 * 갈래 라벨 — **이미 있는 사전 키를 그대로 쓴다**(뜻 하나에 표 하나). 새 키를 만들면 같은 말이
 * 화면마다 다르게 번역될 수 있다.
 */
export const MY_ROLE_LABEL: Record<MyRoleKey, SheetDictKey> = {
  homeroom: "filter.homeroom", // 담임 / Homeroom
  assistant: "month.goal.assistant", // 부담임 / Assistant
};

export type LandingMyRoleGroup<T extends TeacherGroupable> = {
  key: MyRoleKey;
  cards: T[];
  summary: LandingSummary;
};

export function groupLandingByMyRole<T extends TeacherGroupable>(
  cards: readonly T[],
  viewerTeacherId: string,
): LandingMyRoleGroup<T>[] {
  const homeroom: T[] = [];
  const assistant: T[] = [];
  for (const c of cards) (c.teacherId === viewerTeacherId ? homeroom : assistant).push(c);
  const out: LandingMyRoleGroup<T>[] = [];
  // 담임이 먼저 — 내 반이 목록 맨 위에 있어야 한다(들어가기만 하는 반보다 책임이 크다).
  if (homeroom.length) out.push({ key: "homeroom", cards: homeroom, summary: summarizeLanding(homeroom) });
  if (assistant.length) out.push({ key: "assistant", cards: assistant, summary: summarizeLanding(assistant) });
  return out;
}
