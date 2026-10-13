import type { LedgerRound, RoundOwners } from "./rounds";
import type { VideoArrival } from "./types";

/**
 * 반려할 영상 = **지금 그 숙제 칸에 붙어 있는 영상 전부**(원장 2026-10-13 *"그 숙제에 붙은 영상 전부"*) — 순수 함수(`reject-videos.ts`가 쓴다).
 *  · 그 숙제를 골라(또는 손으로) 붙인 영상 — 칸의 대표가 아니어도(고른 영상은 반려한 칸에도 다시 붙는다).
 *  · 장부가 **그 칸만으로** 세고 있는 영상(`RoundOwners` — 장부와 같은 `buildLedgerRounds`가 채운다): 대표 영상, ②로 함께 가져간 같은 날 영상,
 *    고른 영상 뒤에 접힌 영상 · 같은 파일 사본. 남겨 두면 반려 뒤 접힘이 풀려 **다른 숙제 칸을 채운다**(적대적 리뷰 2026-10-13).
 * 🔴 다른 칸도 접어 두고 있는 영상은 넣지 않는다 — 이 칸이 빠져도 그 칸이 계속 접어 둔다.
 * 🔴 칸을 날짜로 다시 짜 맞추지 말 것 — 같은 날이라도 다른 칸이 받은 영상이 있고(반려한 칸이 반려 뒤 영상만 가져간 날),
 *    기간 밖 칸이 받은 영상도 있다(재리뷰 2026-10-13: 앞선 숙제의 영상이 끌려와 휴지통으로 갔다). 판정은 장부가 칸에 붙인 그대로 읽는다.
 * 다시 차는 것은 반려 표시가 막는다(`rounds.ts` `takeFrom`).
 */
export function rejectTargets(rounds: readonly LedgerRound[], owners: RoundOwners, videos: readonly VideoArrival[], classId: string, homeworkDate: string): string[] {
  const round = rounds.find((r) => r.homeworkDate === homeworkDate);
  const targets = new Set(videos.filter((v) => v.classId === classId && v.playback !== null && v.homeworkDate === homeworkDate).map((v) => v.id));
  if (round) for (const [id, held] of owners) if (held.size === 1 && held.has(round)) targets.add(id);
  return [...targets];
}
