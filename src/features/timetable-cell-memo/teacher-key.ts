import { resolveTeacherLabel, specialSlotLabel, type TeacherLabelMap } from "@/features/timetable/lib/teacher-label";

/**
 * 칸 메모의 **강사 열쇠** — 화면 열 라벨(이름 글자)이 아니라 오래 가는 값으로 저장한다.
 *
 * 🔴 왜: 강사뷰 열은 `slotTeacherLabel ?? teacherName`(글자)로 갈린다. 메모를 그 글자에 묶으면 이름·닉네임
 *    표기를 바꾸는 날 메모가 고아가 된다. 그래서 저장은 이 순서로 고른다.
 *    · `u:<users.id>` — 열 라벨이 직원 **한 사람**으로 풀릴 때(재직자 우선 · 둘 이상이면 고르지 않는다)
 *    · `s:LAB` / `s:JJ` — 자리(사람이 아니라 방, teacher-label.ts 🔴 — 직원으로 풀지 않는다)
 *    · `l:<라벨>` — 그 밖(퇴사자 닉네임·동명이인 등) — 글자 그대로
 * 읽을 때는 거꾸로 지금 열 라벨로 푼다 — 같은 해석기(`resolveTeacherLabel`)라 열과 어긋나지 않는다.
 */

export type TeacherKeyUser = { id: string; displayName: string | null; active: boolean };

export type TeacherKeyResolver = {
  /** 화면 열 라벨 → 저장 열쇠. */
  keyOf(label: string): string;
  /** 저장 열쇠 → 지금 화면 열 라벨. 직원이 사라졌으면 저장해 둔 라벨(`fallback`)로. */
  labelOf(key: string, fallback?: string | null): string | null;
};

export function teacherKeyResolver(users: readonly TeacherKeyUser[], labelMap: TeacherLabelMap): TeacherKeyResolver {
  const byLabel = new Map<string, TeacherKeyUser[]>();
  const labelById = new Map<string, string>();
  for (const u of users) {
    const name = u.displayName?.trim();
    if (!name) continue;
    const label = resolveTeacherLabel(name, labelMap);
    if (!label || specialSlotLabel(label)) continue;
    labelById.set(u.id, label);
    (byLabel.get(label) ?? byLabel.set(label, []).get(label)!).push(u);
  }
  return {
    keyOf(label) {
      const raw = label.trim();
      const seat = specialSlotLabel(raw);
      if (seat) return `s:${seat}`;
      const cands = byLabel.get(raw) ?? [];
      const pool = cands.some((c) => c.active) ? cands.filter((c) => c.active) : cands;
      return pool.length === 1 ? `u:${pool[0]!.id}` : `l:${raw}`;
    },
    labelOf(key, fallback) {
      if (key.startsWith("u:")) return labelById.get(key.slice(2)) ?? fallback?.trim() ?? null;
      if (key.startsWith("s:") || key.startsWith("l:")) return key.slice(2) || null;
      return null;
    },
  };
}
