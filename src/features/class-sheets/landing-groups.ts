/**
 * ECS 주간 랜딩 — **담임별 묶음**(원장 2026-08-11 *"열마다 담임 구분해서 놓자"*).
 *
 * 08-11 오전엔 반 이름순 한 줄 흐름이었다(그때는 "압축"이 요구였고, 담임으로 묶으면 *그 반이 어디 있나*를
 * 담임을 알아야 찾게 된다고 판단했다). 원장이 담임 필터에 이어 배치까지 담임 기준으로 요청 — 즉 이 화면을
 * 보는 실제 질문이 *"어느 반이 비었나"*가 아니라 **"누가 안 썼나"**라는 뜻이라, 묶음이 정답이 됐다.
 *
 * 🔴 **묶음 키는 이름이 아니라 id다.** 동명이인 담임이 있으면 이름으로 묶는 순간 두 사람의 반이 한 덩어리가
 *    되고, 화면은 그걸 알려줄 방법이 없다(라벨이 같으니까). 이름은 표시용으로만 쓴다.
 * ⚠️ 정렬은 **이름(ko)** 순, '담임 미지정'은 항상 맨 뒤 — 사람이 아니라 상태라 사람들 사이에 끼면 안 된다.
 *    담임 필터 드롭다운([landing-teacher.ts](./landing-teacher.ts))과 **같은 순서**여야 고른 이름을 목록에서
 *    같은 자리에서 찾는다.
 * ⚠️ 반 순서는 **서버가 준 그대로**(반 이름순) 유지 — 묶음 안에서 다시 정렬하지 않는다.
 */
import { summarizeLanding, type LandingSlotCount, type LandingSummary } from "./landing-summary";

export type TeacherGroupable = LandingSlotCount & {
  teacherId: string | null;
  teacherName: string | null;
};

export type LandingTeacherGroup<T extends TeacherGroupable> = {
  /** 묶음 식별자 — 담임 id, 담임이 없으면 `none`. */
  key: string;
  /** 화면 라벨. 담임 없는 묶음은 상태 표기. */
  label: string;
  /** 이 묶음이 '담임 미지정'인가 — 화면이 사람 이름과 다르게(진하지 않게) 그린다. */
  unassigned: boolean;
  cards: T[];
  /** 그 담임 몫의 작성 상황(반 수·교시 합·%) — 묶음 머리에 그대로 붙는다. */
  summary: LandingSummary;
};

export function groupLandingByTeacher<T extends TeacherGroupable>(
  cards: readonly T[],
): LandingTeacherGroup<T>[] {
  const byKey = new Map<string, T[]>();
  const labelOf = new Map<string, string>();
  for (const c of cards) {
    const key = c.teacherId ?? "none";
    const arr = byKey.get(key);
    if (arr) arr.push(c);
    else byKey.set(key, [c]);
    // 라벨은 **처음 본 이름**으로 고정 — 같은 id의 행마다 이름이 다를 일은 없지만, 있더라도
    // 묶음 제목이 카드마다 흔들리지 않게 한 번만 정한다.
    if (!labelOf.has(key)) labelOf.set(key, c.teacherName ?? "담임 미지정");
  }
  const groups: LandingTeacherGroup<T>[] = [];
  for (const [key, list] of byKey) {
    groups.push({
      key,
      label: labelOf.get(key) ?? "담임 미지정",
      unassigned: key === "none",
      cards: list,
      summary: summarizeLanding(list),
    });
  }
  groups.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return a.label.localeCompare(b.label, "ko");
  });
  return groups;
}
