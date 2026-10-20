import { stageOfCard, type StageInput } from "./board-stages";

/**
 * makeedu 예비상담 상세 주소 — `makeedu_id`(= makeedu counselSeq).
 * 들어온 건이든 우리가 보내고 받아 적은 건이든 같은 키라 같은 주소다(consult-origin 주석).
 * 클릭하면 makeedu 로그인이 필요할 수 있다.
 */
export function makeeduCounselUrl(makeeduId: string): string {
  return `https://school.makeedu.co.kr/counsel/counselList_detail.do?counselSeq=${encodeURIComponent(makeeduId)}`;
}

/**
 * 신규 콜&상담 목록·카드의 '메이크에듀 동기화 완료' 표식을 달지 — 달면 주소, 아니면 null.
 *
 * 🔑 원장 2026-10-20: *"메이크에듀로 동기화가 완료된건에 한해서 이중체크하지 않도록"* ·
 *    *"등록완료 단계인 학생들만 동기화 아이콘을 붙이는걸로"*. 그래서 조건은 둘이다:
 *    ① makeedu에 그 상담이 있다(`makeedu_id` — 들어왔거나 보내고 counselSeq를 받았다)
 *    ② 칸반 '등록 완료' 칸이다(`stageOfCard` — 반 배정 완료 카드도 이 칸이다)
 */
export function makeeduSyncedUrlOf(row: StageInput & { makeeduId: string | null }): string | null {
  if (!row.makeeduId) return null;
  if (stageOfCard(row) !== "enrolled") return null;
  return makeeduCounselUrl(row.makeeduId);
}
