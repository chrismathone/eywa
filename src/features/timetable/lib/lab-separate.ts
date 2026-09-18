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
// 🔑 가르는 규칙은 자리 출석부와 **한 벌**이다 — 순수 모듈이라 서버·클라 어디서 불러도 된다.
import { labSplitSlotShows } from "@/features/attendance/seat/lab-split";

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
type LabStudentLike = {
  enrollmentId?: string;
  status?: string;
  labSeparate?: true;
  /** 자리 **교시 고정**(0255a) 문구 — 있으면 가르기에서 뺀다(사람이 정한 그 날의 자리가 배정을 이긴다). */
  seatPinNote?: string;
};
type LabSlotLike<S> = {
  classId: string;
  /** "mon"~"sun" — 가르기는 **그 날 그 반** 기준이라 요일이 필요하다(월요일엔 *LAB이 없을 수 있다). */
  dayOfWeek: string;
  /** 자리(LAB·JJ) 판정용 — 강사 교시는 가르지 않는다. */
  slotTeacherLabel: string | null;
  labSeparate?: true;
  /** 셀 머리 인원 — 명단을 가르면 이 숫자도 함께 줄인다(숫자와 명단이 갈리면 둘 다 못 믿는다). */
  studentCount?: number;
  students: S[];
};

/** 그 줄이 \*LAB에 배정됐는가 — 퇴원 줄은 언제나 아니다(나간 원생을 \*LAB 교시에 세우지 않는다). */
function isFlagged(st: LabStudentLike, ids: ReadonlySet<string>): boolean {
  return st.status !== "withdrawn" && !!st.enrollmentId && ids.has(st.enrollmentId);
}

/**
 * 그 주 시간표 슬롯에 **\*LAB 배정**을 반영한다 — 서버에서 한 번, 세 뷰(기본·통합·강사)가 함께 쓴다. 하는 일 둘:
 *
 * ① **자리(LAB) 칸 명단을 가른다**(원장 2026-09-18 *"*lab 체크가 안된 학생은 *lab이 스케줄에 나오면 안됨.
 *    *lab은 *lab이 체크된 학생만 떠야함"*) — 판정은 자리 출석부와 **같은 함수**
 *    [`labSplitSlotShows`](../../attendance/seat/lab-split.ts)다(화면마다 답이 다르면 "출석부엔 있는데 시간표엔 없다"가 된다).
 *    · \*LAB 칸 = 켠 원생만 · 같은 날 일반 LAB 칸 = 끈 원생만 · 그 날 \*LAB이 없는 반은 그대로.
 *    🔴 **강사 교시는 한 줄도 안 건드린다** — 배정은 자리를 가르는 것이지 수업에서 빼는 게 아니다.
 * ② **이름 표식** — 그 주 \*LAB 교시가 있는 반의 켠 원생 이름을 LAB 파랑 + 이탤릭으로(`LAB_SEPARATE_STUDENT_CLASS`).
 *    🔴 퇴원 줄엔 안 붙인다(나간 원생이 파랗게 서면 "지금 다니는 아이"로 읽힌다).
 *
 * 🔴 **재료를 모르면(null) 아무것도 안 한다** — 조회 실패를 "아무도 안 켰다"로 읽으면 멀쩡한 LAB 명단이 통째로 갈린다.
 *    반대로 **빈 Set은 사실이다**(아무도 안 켰다 → \*LAB 칸은 빈다).
 * 🔑 명단 배열의 **참조 공유**를 지킨다(한 반의 슬롯들이 같은 `students` 인스턴스를 나눠 갖는다 — RSC 페이로드,
 *    `applySeatPinMarks`와 같은 규약). 바뀐 것이 없으면 입력을 그대로 돌려준다.
 */
export function applyLabSeparateMarks<S extends LabStudentLike, T extends LabSlotLike<S>>(
  slots: readonly T[],
  enrollmentIds: ReadonlySet<string> | null,
): T[] {
  if (!enrollmentIds) return slots as T[];
  const classesWithSep = new Set(slots.filter((s) => s.labSeparate === true).map((s) => s.classId));
  if (classesWithSep.size === 0) return slots as T[];

  // (반|요일) → 그 날 그 반의 자리(LAB) 교시 구성. 가르기는 이 날짜 축으로만 한다.
  const dayKey = (s: T) => `${s.classId}|${s.dayOfWeek}`;
  const days = new Map<string, { sep: boolean; normal: boolean }>();
  for (const s of slots) {
    if (specialSlotLabel(s.slotTeacherLabel) !== LAB_ROOM_LABEL) continue;
    const cur = days.get(dayKey(s)) ?? { sep: false, normal: false };
    if (s.labSeparate === true) cur.sep = true;
    else cur.normal = true;
    days.set(dayKey(s), cur);
  }

  // 같은 명단 배열 × 같은 처리(표식만 / *LAB 칸 / 일반 LAB 칸)는 한 번만 만든다.
  type Derived = { list: S[]; removedActive: number };
  const cache = new Map<S[], Map<string, Derived>>();
  const derive = (students: S[], mode: "mark" | "sep" | "normal", dayHasNormal: boolean): Derived => {
    const key = `${mode}|${dayHasNormal ? 1 : 0}`;
    const per = cache.get(students) ?? new Map<string, Derived>();
    if (!cache.has(students)) cache.set(students, per);
    const hit = per.get(key);
    if (hit) return hit;
    let changed = false;
    let removedActive = 0;
    const out: S[] = [];
    for (const st of students) {
      const flagged = isFlagged(st, enrollmentIds);
      // 🔴 교시 고정은 배정을 이긴다(자리 출석부 `seatShowsAtPeriod`의 순서와 같다 — 선택 > 배정).
      if (
        mode !== "mark" &&
        !st.seatPinNote &&
        !labSplitSlotShows({ slotSeparate: mode === "sep", flagged, dayHasSeparate: true, dayHasNormal })
      ) {
        changed = true;
        // 셀 머리 인원(재원 기준)에서 뺄 수 — 대기·퇴원 줄은 원래 안 세니 함께 빼지 않는다.
        if (st.status === undefined || st.status === "active") removedActive += 1;
        continue;
      }
      if (flagged) {
        changed = true;
        // 제네릭 스프레드라 TS가 `S`로 좁히지 못한다 — 필드 하나를 더할 뿐이라 여기서 단언한다.
        out.push({ ...st, labSeparate: true as const } as S);
      } else out.push(st);
    }
    const derived: Derived = { list: changed ? out : students, removedActive };
    per.set(key, derived);
    return derived;
  };

  return slots.map((slot) => {
    if (!classesWithSep.has(slot.classId)) return slot;
    const day = specialSlotLabel(slot.slotTeacherLabel) === LAB_ROOM_LABEL ? days.get(dayKey(slot)) : undefined;
    const split = day?.sep === true;
    const { list, removedActive } = derive(
      slot.students,
      split ? (slot.labSeparate === true ? "sep" : "normal") : "mark",
      day?.normal === true,
    );
    if (list === slot.students) return slot;
    return {
      ...slot,
      students: list,
      ...(removedActive > 0 && typeof slot.studentCount === "number"
        ? { studentCount: Math.max(0, slot.studentCount - removedActive) }
        : {}),
    };
  });
}
