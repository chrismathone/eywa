import { stageOfCard, type StageInput } from "./board-stages";

/**
 * makeedu 예비상담 상세 주소 — `makeedu_id`(= makeedu counselSeq).
 * 들어온 건이든 우리가 보내고 받아 적은 건이든 같은 키라 같은 주소다(consult-origin 주석).
 * 클릭하면 makeedu 로그인이 필요할 수 있다.
 */
export function makeeduCounselUrl(makeeduId: string): string {
  return `https://school.makeedu.co.kr/counsel/counselList_detail.do?counselSeq=${encodeURIComponent(makeeduId)}`;
}

export type MakeeduSync = {
  /** 누르면 열 makeedu 예비상담 주소 — 상담이 makeedu에 없으면 null(눌러도 갈 곳이 없다). */
  url: string | null;
  /** 연결 학생이 makeedu 원생으로 전환까지 됐다 → 표식 테두리 이중. */
  converted: boolean;
};

/**
 * 신규 콜&상담 목록·카드의 '메이크에듀 동기화' 표식 — 달지 않으면 null.
 *
 * 🔑 원장 2026-10-20: *"메이크에듀로 동기화가 완료된건에 한해서 이중체크하지 않도록"* ·
 *    *"등록완료 단계인 학생들만"* · *"상담만 연동되었는지, 실제로 학생이 원생으로 메이크에듀에 전환되어있는지.
 *    전환까지 된 경우 테두리 이중으로"*. 조건:
 *    ① 칸반 '등록 완료' 칸(`stageOfCard` — 반 배정 완료 카드도 이 칸이다)
 *    ② makeedu에 그 상담이 있다(`makeedu_id`) **또는** 연결 학생이 makeedu 원생이다(`studentInMakeedu`)
 *    상담이 없고 원생만 있으면 표식은 달되 누를 곳이 없다(makeedu 원생 상세 주소는 알 수 없다).
 */
export function makeeduSyncOf(
  row: StageInput & { makeeduId: string | null; studentInMakeedu: boolean },
): MakeeduSync | null {
  if (stageOfCard(row) !== "enrolled") return null;
  if (!row.makeeduId && !row.studentInMakeedu) return null;
  return { url: row.makeeduId ? makeeduCounselUrl(row.makeeduId) : null, converted: row.studentInMakeedu };
}
