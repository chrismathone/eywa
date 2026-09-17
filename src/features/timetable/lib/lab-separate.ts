/**
 * LAB **'따로 수업(*LAB)'** 표식 — 표시 규약 단일 소스(순수 · 서버·클라 공용).
 *
 * 원장 2026-09-17(반 수정 폼 교시별 담당 편집기 + 통합뷰 반 카드 캡처): *"랩실 옆에 토글키를 두고 토글하게 되면
 * LAB -> *LAB 밑줄 + 이탤릭체 + 가 되도록 변경해줘. (따로 수업듣는 학생들 분리하기위한 조치)"*.
 * 저장 = `class_schedules.lab_separate`(0270a). **1단계는 표시만** — 자리 출석부 명단·출결·시수는 이 표식을 안 본다.
 *
 * 🔴 **가상 `*LAB` 임시 칸(virtual-lab.ts)과 글자는 같고 모양이 다르다** — 그쪽은 교시 이동·고정 때문에 생긴
 *    **수업설정에 없는** 칸이라 바탕 없이 점선 테두리 + 이탤릭이고, 이쪽은 **수업설정에 있는** LAB 교시라
 *    LAB 칸 그대로(파란 바탕) + 이탤릭 + **밑줄**이다. 둘을 한 모양으로 합치지 말 것(무엇이 설정인지 사라진다).
 * ⚠️ 판정은 **LAB 자리일 때만**이다(`isLabSeparateSlot`) — JJ·강사 교시에 남은 값은 읽지 않는다.
 */
import { LAB_ROOM_LABEL, specialSlotLabel } from "./teacher-label";

export const LAB_SEPARATE_LABEL = "*LAB";

/** 글자 모양 — 밑줄 + 이탤릭(바탕·글자색은 LAB 칸 그대로). */
export const LAB_SEPARATE_TEXT_CLASS = "italic underline underline-offset-2";

/** 칸 툴팁 — 가상 `*LAB`의 "임시" 설명과 갈라 둔다. */
export const LAB_SEPARATE_TIP = "LAB · 따로 수업(반 수정에서 켠 표식)";

/** 이 교시가 '따로 수업' LAB 칸으로 그려지는가 — 라벨이 LAB 자리이고 표식이 켜져 있을 때만. */
export function isLabSeparateSlot(slotTeacherLabel: string | null | undefined, labSeparate: boolean | null | undefined): boolean {
  return labSeparate === true && specialSlotLabel(slotTeacherLabel) === LAB_ROOM_LABEL;
}
