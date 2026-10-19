/**
 * **한 칸에 같은 교재 차수가 둘 이상일 때 둘째부터를 어떻게 쓸까** — 순수(Vitest). IO는
 * [`applyCellLessons`](./server/apply-cell-lessons.ts).
 *
 * 원장 2026-10-19 *"차시마다 한줄씩 들어가야지 지금처럼 하나에 2개가 들어가는데 수업시간 25분 이렇게되어있어서
 * 제대로 안들어간걸로됌"*. 첫 차수는 지금까지처럼 RPC(`ecs_apply_textbook_lessons`)가 쓰고, RPC는 같은 교재
 * 줄이 이미 있으면 **빈 칸만 채우고 멈추므로** 둘째 차수부터는 여기서 정한다.
 *
 * 🔑 **이미 같은 내용의 줄이 있는 차수는 그 줄로 친다**, 나머지 차수는 남은 같은 교재 줄과 순서대로(줄 번호 순) —
 *    있으면 빈 칸만 채우고(덮어쓰지 않는다), 없으면 새 줄을 만든다. 여러 번 눌러도 줄이 늘지 않는다.
 * 🔑 **옛 `A / B` 한 줄**(2026-10-16~19에 가져온 칸)은 그 칸 계획을 이은 값과 **글자까지 같을 때만** 나눈다 —
 *    첫 줄을 첫 차수로 고치고 나머지를 새 줄로. 사람이 고쳐 쓴 줄은 이 조건에 안 걸려 그대로 남는다.
 */
import { joinLessonTexts } from "./plan-compare";
import type { CellLesson } from "./plan-expand";

export type CellBookLine = {
  id: string;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

export type LinePatch = Partial<Record<"textbook" | "page_range" | "progress" | "homework", string | null>>;

export type CellExtrasPlan = {
  /** 있는 줄 고치기(빈 칸 채우기 또는 옛 이은 줄 나누기). */
  updates: { id: string; patch: LinePatch }[];
  /** 새로 만들 줄(차수 순). */
  creates: CellLesson[];
};

const has = (v: string | null | undefined) => String(v ?? "").trim() !== "";
const same = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? "").trim() === String(b ?? "").trim();

/**
 * @param lessons 그 칸에 올 차수들(차수 순). 첫 차수는 이미 RPC가 썼다고 본다.
 * @param lines   **RPC를 부른 뒤** 그 칸의 같은 구분·같은 교재 줄(줄 번호 순).
 */
export function planCellExtras(input: {
  lessons: readonly CellLesson[];
  lines: readonly CellBookLine[];
  title: string;
  pageTime: string | null;
}): CellExtrasPlan {
  const { lessons, lines, title, pageTime } = input;
  const out: CellExtrasPlan = { updates: [], creates: [] };
  if (lessons.length <= 1) return out;

  const joinedProgress = joinLessonTexts(lessons.map((l) => l.progress));
  const joinedHomework = joinLessonTexts(lessons.map((l) => l.homework));
  const first = lessons[0]!;
  const legacy =
    lines.length === 1 &&
    same(lines[0]!.progress, joinedProgress) &&
    same(lines[0]!.homework, joinedHomework) &&
    // 이은 값이 첫 차수 그대로면(차수 문구가 같은 교재 — `10개`) 나눌 게 아니라 둘째 줄만 없는 것이다.
    !(same(joinedProgress, first.progress) && same(joinedHomework, first.homework));
  if (legacy) {
    out.updates.push({ id: lines[0]!.id, patch: { progress: first.progress, homework: first.homework } });
    out.creates.push(...lessons.slice(1));
    return out;
  }

  // ① 내용이 이미 같은 줄은 그 차수 자리로 친다 — 순서로만 짝지으면, 1차수 줄을 지운 칸을 다시 가져올 때
  //    2차수 줄이 '첫 줄'로 잡혀 2차수가 한 벌 더 생긴다(적대적 리뷰 2026-10-19).
  const used = new Set<number>();
  const pending: number[] = [];
  lessons.forEach((want, k) => {
    const i = lines.findIndex((l, j) => !used.has(j) && same(l.progress, want.progress) && same(l.homework, want.homework));
    if (i >= 0) used.add(i);
    else pending.push(k);
  });
  // ② 남은 차수는 남은 줄과 순서대로(빈 칸만 채운다 — RPC와 같은 규약, 고쳐 쓴 값은 덮지 않는다), 줄이 모자라면 새로.
  const free = lines.map((_, j) => j).filter((j) => !used.has(j));
  pending.forEach((k, n) => {
    const want = lessons[k]!;
    const line = free[n] === undefined ? undefined : lines[free[n]!];
    if (!line) {
      out.creates.push(want);
      return;
    }
    const patch: LinePatch = {};
    if (!has(line.textbook)) patch.textbook = title.trim();
    if (!has(line.pageRange) && has(pageTime)) patch.page_range = String(pageTime).trim();
    if (!has(line.progress) && has(want.progress)) patch.progress = want.progress;
    if (!has(line.homework) && has(want.homework)) patch.homework = want.homework;
    if (Object.keys(patch).length > 0) out.updates.push({ id: line.id, patch });
  });
  return out;
}
