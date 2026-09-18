/**
 * LAB **'따로 수업(*LAB)'** 표식 — 표시 규약 단일 소스(순수 · 서버·클라 공용).
 *
 * 원장 2026-09-17(반 수정 폼 교시별 담당 편집기 + 통합뷰 반 카드 캡처): *"랩실 옆에 토글키를 두고 토글하게 되면
 * LAB -> *LAB 밑줄 + 이탤릭체 + 가 되도록 변경해줘. (따로 수업듣는 학생들 분리하기위한 조치)"*.
 * 저장 = `class_schedules.lab_separate`(0271a). **1단계는 표시만** — 자리 출석부 명단·출결·시수는 이 표식을 안 본다.
 *
 * 🔴 **가상 `*LAB` 임시 칸(virtual-lab.ts)과 글자는 같고 모양이 다르다** — 그쪽은 교시 이동·고정 때문에 생긴
 *    **수업설정에 없는** 칸이라 바탕 없이 점선 테두리 + 이탤릭이고, 이쪽은 **수업설정에 있는** LAB 교시라
 *    LAB 칸 그대로(파란 바탕) + 이탤릭 + **밑줄**이다. 둘을 한 모양으로 합치지 말 것(무엇이 설정인지 사라진다).
 * ⚠️ 판정은 **LAB 자리일 때만**이다(`isLabSeparateSlot`) — JJ·강사 교시에 남은 값은 읽지 않는다.
 */
import { LAB_ROOM_LABEL, specialSlotLabel } from "./teacher-label";

export const LAB_SEPARATE_LABEL = "*LAB";

/**
 * 글자 모양 — 밑줄 + 이탤릭(바탕·글자색은 LAB 칸 그대로).
 * 🔴 `[font-synthesis:style]`을 빼지 말 것 — body가 `font-synthesis: none`(globals.css)이고 Pretendard엔 이탤릭 서체가
 *    없어서, 이것 없이는 `italic`이 **아무 일도 안 한다**(원장 2026-09-18 *"*LAB 밑줄 이탤릭체 적용"* — 9/17부터 곧게 섰다).
 */
export const LAB_SEPARATE_TEXT_CLASS = "italic [font-synthesis:style] underline underline-offset-2";

/** 칸 툴팁 — 가상 `*LAB`의 "임시" 설명과 갈라 둔다. */
export const LAB_SEPARATE_TIP = "LAB · 따로 수업(반 수정에서 켠 표식)";

/** 이 교시가 '따로 수업' LAB 칸으로 그려지는가 — 라벨이 LAB 자리이고 표식이 켜져 있을 때만. */
export function isLabSeparateSlot(slotTeacherLabel: string | null | undefined, labSeparate: boolean | null | undefined): boolean {
  return labSeparate === true && specialSlotLabel(slotTeacherLabel) === LAB_ROOM_LABEL;
}

/**
 * **\*LAB에 배정된 원생**(0271b `enrollments.lab_separate`)의 이름 서식 — LAB 칸과 같은 파랑 + 이탤릭.
 * 원장 2026-09-18 *"*LAB 이 켜진 학생은 이름 색을 lab 과 같은 색상으로 해주고 이탤릭체로"*.
 * 🔴 **이름 뒤 `/학교학년` 꼬리까지 함께** 파랗게 한다(원장 2026-09-18 캡처 *"전체를 파랑 및 이탤릭으로"* — 이름만 칠했더니
 *    `유희린`은 파랑인데 `/침산초3`은 검정이라 한 줄이 두 색으로 갈렸다). 꼬리 쪽은 [`labSeparateMetaClass`](#labSeparateMetaClass).
 * 🔑 **밑줄은 없다** — 밑줄까지 있는 파란 이탤릭은 랩실 **교시 고정**(`SEAT_PIN_MARK_CLASS`)이다. 둘 다면 고정이 이긴다
 *    (고정이 더 구체적인 사실 — 어느 교시로 옮겼는지까지 말한다).
 * 🔴 `[font-synthesis:style]`을 빼지 말 것 — body가 합성을 끄고 Pretendard엔 이탤릭 서체가 없다(`LAB_SEPARATE_TEXT_CLASS` 주석).
 * ⚠️ 줄(링크 엘리먼트)이 아니라 **안쪽 span**에 얹는다 — 줄엔 tone(신입 빨강·전입 초록·검색)이 붙어 있어 같은 축 유틸을
 *    이어 붙이면 승자를 CSS 순서가 정한다([[#116]]). 자식이면 상속을 확실히 이긴다.
 */
export const LAB_SEPARATE_STUDENT_CLASS = "text-blue italic [font-synthesis:style]";

/**
 * 이름 뒤 **`/학교학년` 꼬리**에 이어 붙일 서식 — 세 뷰(기본·통합·강사)가 같은 판정을 쓰라고 함수로 둔다.
 *
 * 🔴 **교시 고정이 걸린 줄엔 안 붙인다** — 고정 표식은 밑줄까지 있어서 꼬리까지 끌면 `유희린/침산초3` 전체에 밑줄이 그어진다
 *    (그 표식이 말하는 것은 *이 아이가 어느 교시에 고정됐나*지 학교가 아니다). 그 줄은 종전대로 이름만.
 * ⚠️ 돌려주는 값은 **앞 공백 없는 클래스 문자열 또는 빈 문자열**이다 — 호출부가 `${base}${x ? ` ${x}` : ""}`로 잇는다.
 */
export function labSeparateMetaClass(labSeparate?: boolean, pinNote?: string | null): string {
  return labSeparate === true && !pinNote ? LAB_SEPARATE_STUDENT_CLASS : "";
}

/** 이 모듈이 학생 줄에서 읽는 것 전부. */
type LabStudentLike = { enrollmentId?: string; status?: string; labSeparate?: true };
type LabSlotLike<S> = { classId: string; labSeparate?: true; students: S[] };

/**
 * 그 주 시간표 슬롯의 명단에 **\*LAB 배정 표식**을 얹는다 — 서버에서 한 번, 세 뷰(기본·통합·강사)가 함께 쓴다.
 *
 * 🔴 **그 주에 \*LAB 교시가 있는 반에만** — 교시 표식을 끈 뒤 남은 배정은 뜻을 잃었다(지난 사실을 현재로 읽히게 하지 않는다).
 * 🔴 **퇴원 줄엔 안 붙인다** — 나간 원생이 파랗게 서면 "지금 다니는 아이"로 읽힌다.
 * 🔴 명단에서 빼거나 더하지 않는다 — 바뀌는 것은 이름의 글꼴과 색뿐(인원·검색·드래그·엑셀 불변).
 * 🔑 명단 배열의 **참조 공유**를 지킨다(한 반의 슬롯들이 같은 `students` 인스턴스를 나눠 갖는다 — RSC 페이로드,
 *    `applySeatPinMarks`와 같은 규약). 켠 수강이 없으면 입력을 그대로 돌려준다.
 */
export function applyLabSeparateMarks<S extends LabStudentLike, T extends LabSlotLike<S>>(
  slots: readonly T[],
  enrollmentIds: ReadonlySet<string> | null,
): T[] {
  if (!enrollmentIds || enrollmentIds.size === 0) return slots as T[];
  const classesWithSep = new Set(slots.filter((s) => s.labSeparate === true).map((s) => s.classId));
  if (classesWithSep.size === 0) return slots as T[];

  const cache = new Map<S[], S[]>();
  return slots.map((slot) => {
    if (!classesWithSep.has(slot.classId)) return slot;
    let next = cache.get(slot.students);
    if (!next) {
      let changed = false;
      const mapped = slot.students.map((st) => {
        if (st.status === "withdrawn" || !st.enrollmentId || !enrollmentIds.has(st.enrollmentId)) return st;
        changed = true;
        // 제네릭 스프레드라 TS가 `S`로 좁히지 못한다 — 필드 하나를 더할 뿐이라 여기서 단언한다.
        return { ...st, labSeparate: true as const } as S;
      });
      next = changed ? mapped : slot.students;
      cache.set(slot.students, next);
    }
    return next === slot.students ? slot : { ...slot, students: next };
  });
}
