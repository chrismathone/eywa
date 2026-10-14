/**
 * 보고서 저장이 영상 숙제 마감(`lesson_reports.video_homework_due`, due.ts)을 어떻게 적나 — 순수(테스트로 잠근다). 원스크린 저장 관문
 * (`saveLessonReport`)이 이 판정만 쓴다. `resolveNext`는 '다음 수업'을 시간표로 찾을 때만 부른다(그 밖엔 조회 0).
 *
 *  · 마감의 주인 = 영상 과제 값과 같다(그 줄을 처음 쓴 선생님 — report-owner.ts). 남이 처음 쓴 줄이면 적지 않고, 화면이 고른 값이 저장값과
 *    다르면 저장값을 돌려준다(`kept` — 화면을 저장값으로 맞추고 그 줄을 잠근다, 적대 리뷰 L1). 영상 과제 값을 둔 저장(keptVideoHw)도 적지 않는다.
 *  · 영상 과제를 끄면 마감을 지운다(남은 마감이 나중에 다시 켠 과제에 붙지 않게 — 화면이 마감을 안 보내도).
 *  · 7일 = 지운다(null). 다음 수업 = 이미 정한 날짜가 있으면 **그대로 둔다**(다시 계산하지 않는다 — 학생에게 이미 보인 날짜가 휴원·퇴원
 *    예약으로 바뀌지 않게, L2). 없으면 시간표로 찾는다:
 *      - 14일 안에 없음 → 7일로 적고 알린다(`fellBack: "none"`).
 *      - 찾은 날이 이미 지났다(늦게 쓴 보고서) → 7일로 적고 알린다(`fellBack: "past"` — 지난 날로 고정하면 사이트에 뜨지도 않고 바로 미제출, M1).
 *      - 시간표를 못 읽음 → 적지 않고 알린다(`fellBack: "error"` — 화면은 7일로 돌아가고 발송은 멈춘다, M2).
 * `fellBack`·`kept`가 실린 저장은 발송하지 않는다(saveAndQueueClassnote) — 멘트·미리보기가 말한 마감과 학부모 카드의 마감이 갈린 채 나가지 않게.
 */
import { isCustomDue, type SavedVideoHomeworkDue, type VideoHomeworkDueMode } from "./due";

export type VideoHomeworkDueDecision = {
  /** upsert에 실을 값 — 없으면 마감 칸을 건드리지 않는다. */
  write?: { video_homework_due: string | null };
  /** 화면에 돌려줄 저장 결과 — 없으면 화면은 그대로. */
  saved?: SavedVideoHomeworkDue;
};

export async function decideVideoHomeworkDue(input: {
  /** 마감 칸과 영상 과제 칸이 둘 다 있다(#95). */
  ready: boolean;
  /** 이번 저장이 적는 영상 과제 값(안 보냈으면 undefined — 판정 안 함). */
  videoHomework: boolean | undefined;
  /** 화면이 고른 마감(안 보냈으면 undefined). */
  mode: VideoHomeworkDueMode | undefined;
  /** 영상 과제 값을 작성 선생님 것으로 둔 저장인가(report-owner.ts). */
  keptVideoHw: boolean;
  /** 반이 있는 줄인가(보강 행은 반이 없다 — 마감도 없다). */
  hasClass: boolean;
  /** 이 줄의 마감을 바꿀 수 있나 — 새 줄 · 작성 계정이 빔 · 내가 작성자. */
  owner: boolean;
  /** 저장돼 있던 마감(없으면 null). */
  priorDue: string | null;
  reportDate: string;
  today: string;
  resolveNext: () => Promise<string | null>;
}): Promise<VideoHomeworkDueDecision> {
  const { reportDate } = input;
  if (!input.ready || typeof input.videoHomework !== "boolean" || input.keptVideoHw || !input.hasClass) return {};
  const stored = isCustomDue(reportDate, input.priorDue) ? input.priorDue : null;
  if (!input.owner) {
    if (input.mode === undefined || (input.mode === "next") === (stored !== null)) return {};
    return { saved: { mode: stored ? "next" : "week", date: stored, kept: true } };
  }
  if (!input.videoHomework) return { write: { video_homework_due: null } };
  if (input.mode === "week") return { write: { video_homework_due: null }, saved: { mode: "week", date: null } };
  if (input.mode !== "next") return {};
  if (stored) return { saved: { mode: "next", date: stored } };
  let next: string | null;
  try {
    next = await input.resolveNext();
  } catch {
    return { saved: { mode: "week", date: null, fellBack: "error" } };
  }
  if (!next) return { write: { video_homework_due: null }, saved: { mode: "week", date: null, fellBack: "none" } };
  if (next < input.today) return { write: { video_homework_due: null }, saved: { mode: "week", date: null, fellBack: "past", missed: next } };
  return { write: { video_homework_due: next }, saved: { mode: "next", date: next } };
}
