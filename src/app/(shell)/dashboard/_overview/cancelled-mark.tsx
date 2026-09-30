import { tipProps } from "@/components/hover-tip/tip";
import s from "./overview.module.css";

/** 취소 표식의 설명 카드 — 운영실 일정 카드·금일입테 팝업이 같은 문장을 쓴다. */
export const CANCELLED_EVENT_TIP = "취소된 일정입니다. 건수에서 빠지고 반·콜&상담 연결도 붙지 않습니다.";

/**
 * 취소된 일정 줄의 작은 '취소' 표식(원장 2026-09-30 *"목록에는 띄워놓고 취소바를 그어서 표시하자"*).
 * 톤은 의미색 캐논의 `inert`(종료·비활성 — "지나간 행을 죽일 때")라 무채색 배지(`kpiTagMuted`)를 쓴다.
 * 설명은 메모 카드(`data-tip`) — `title`을 같이 달지 않는다(디자인 규약).
 */
export function CancelledMark() {
  return (
    <span className={s.kpiTagMuted} {...tipProps(CANCELLED_EVENT_TIP)}>
      취소
    </span>
  );
}
