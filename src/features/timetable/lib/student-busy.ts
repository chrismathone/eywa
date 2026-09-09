/**
 * 학생 한 명을 다른 반으로 끌 때 **못 가는 반**을 가리는 순수 판정 (원장 2026-09-09:
 * *"영어를 듣는 학생이면 영어 스케줄 때문에 이동이 불가능한 곳은 [빗금] 이런느낌으로 차단시켜"*).
 *
 * 반 블록 이동([`class-move.ts`](./class-move.ts))이 "그 반 학생 **전원**"을 보는 것과 축이 다르다 —
 * 이쪽은 **끌고 있는 그 학생 한 명**의 다른 과목 일정이다. 그래서 재료도 다르다: 저쪽은 화면에 뜬 반들의
 * 집계를 서버가 미리 접어 내려보내고, 이쪽은 집는 순간 그 학생의 창만 받아 온다(한 명분이라 가볍다).
 *
 * 🔴 **모르면 막지 않는다(fail-open)** — 이 표식은 도움이지 게이트가 아니다. 조회가 실패하거나 창이 비면
 *    빗금이 하나도 안 서고 종전과 똑같이 동작한다. 거짓 차단은 "옮길 수 있는데 못 옮긴다"가 되어
 *    빗금이 없는 것보다 나쁘다.
 * 🔴 **떠나는 반은 창에서 빠진다** — 학생은 그 반을 나가면서 옮기는 것이라, 안 빼면 자기 시간과 부딪혀
 *    모든 칸이 막힌다(서버가 `excludeClassId`로 뺀다).
 * ⚠️ 겹침 판정은 앱 단일 소스 [`timeRangesOverlap`](@/features/classes/overlap)(경계 접촉은 겹침 아님).
 */
import { timeRangesOverlap } from "@/features/classes/overlap";

/** 그 학생이 이미 잡혀 있는 칸 하나. */
export type StudentBusyWindow = {
  classId: string;
  className: string;
  /** `mon`… */
  day: string;
  /** `HH:MM` (초는 잘라서 온다). */
  start: string;
  end: string;
};

/** 화면에 그려진 반 칸 하나(격자에서 읽는다). */
export type ClassCellCoord = {
  classId: string;
  className: string;
  day: string;
  start: string;
  end: string;
};

/**
 * 못 가는 반 → 이유 한 줄.
 *
 * 🔴 판정 단위는 **칸이 아니라 반**이다 — 학생은 교시 하나가 아니라 그 반에 들어간다. 한 칸이라도
 *    부딪히면 그 반 전체가 막히고, 그래서 그 반의 **모든 칸**에 빗금이 선다(한 칸만 치면 "다른 칸엔
 *    놓을 수 있나?"로 읽힌다).
 * ⚠️ 같은 반의 창은 자기 자신과 비교하지 않는다 — 이미 다니는 반이면 서버가 창을 보내 주므로 그대로
 *    막히는 게 맞지만, 그 이유는 "시간이 겹쳐서"가 아니라 "이미 그 반"이라 문구를 따로 만든다.
 */
export function blockedClassesForStudent(
  cells: readonly ClassCellCoord[],
  windows: readonly StudentBusyWindow[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (windows.length === 0 || cells.length === 0) return out;
  // 요일로 먼저 나눈다 — 칸이 수백 개라 칸마다 전 창을 훑으면 그 곱이 곧 픽업 렉이다(class-move.ts와 같은 수법).
  const byDay = new Map<string, StudentBusyWindow[]>();
  for (const w of windows) {
    const arr = byDay.get(w.day);
    if (arr) arr.push(w);
    else byDay.set(w.day, [w]);
  }
  for (const c of cells) {
    if (out.has(c.classId)) continue; // 그 반은 이미 막혔다 — 이유는 처음 걸린 것 하나면 된다
    if (windows.some((w) => w.classId === c.classId)) {
      out.set(c.classId, "이미 다니는 반입니다");
      continue;
    }
    const hit = (byDay.get(c.day) ?? []).find((w) => timeRangesOverlap(c.start, c.end, w.start, w.end));
    if (hit) out.set(c.classId, `${hit.className} 수업과 시간이 겹칩니다`);
  }
  return out;
}
