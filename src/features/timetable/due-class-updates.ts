// 예약 적용이 **미뤄 둔 담임·기본 강의실**을 그날 재생하는 규칙 — 순수 함수.
//
// 배경(원장 2026-08-28 *"담임도 미래에 바뀌도록 해야겠는데"*): 배치는 `valid_from`으로 시간 축이 있지만
// 담임(`classes.teacher_id`)은 반 단위 단일 값이라 축이 없다. 그래서 예약 적용(0234a)은 담임을 **안 건드리고**
// 스냅샷 payload에만 남겨 두고, 그날 cron이 이 규칙으로 재생한다.
//
// 🔴 인수인계(`pending_teacher_*`)에 얹지 않았다 — `applyHandover`가 담임 교체와 함께 슬롯 담당까지
//    옛 담임 → 새 담임으로 옮기는데, 영어는 요일·교시마다 담당이 달라 시트대로 넣어 둔 슬롯을 뭉갠다.
//    여기서는 **담임 필드만** 바꾼다(슬롯은 이미 정확하다).

/** 스냅샷 payload의 `apply.classUpdates` 한 건. */
export type ClassUpdate = {
  classId: string;
  /** 적용할 값. null = 그 필드는 변경 대상이 아니었다. */
  teacherId: string | null;
  classroomId: string | null;
  /** 예약 시점의 값 — 그 사이 사람이 바꿨는지 판별하는 기준. */
  prevTeacherId: string | null;
  prevClassroomId: string | null;
  /**
   * 반 이름(원장 2026-08-28 *"반이름 변경도 9/1에 예약되도록 시스템화"*). 컷오버 스크립트 `--rename`만 채운다.
   * ⚠️ **옛 스냅샷엔 없다** — 선택 필드로 두어야 그대로 읽힌다(있는 것처럼 다루면 전 스냅샷이 깨진다).
   */
  className?: string | null;
  prevClassName?: string | null;
};

export type SnapshotClassUpdates = {
  snapshotId: string;
  effectiveDate: string;
  updates: ClassUpdate[];
};

/**
 * 이 기능이 생기기 전 스냅샷은 **담임을 이미 즉시 반영**했다. 그 옛 스냅샷을 지금 재생하면 7월 담임이
 * 되살아난다 — 아래 `shouldApplyTeacher` 가드가 대부분 걸러 주지만(현재값 ≠ 예약시점값), 그 사이
 * 사람이 원래대로 되돌려 놓았다면 통과해 버린다. 그래서 **날짜 바닥**을 둔다.
 * 🔴 예약 적용이 처음 가능해진 날 이후의 스냅샷만 본다.
 */
export const SCHEDULED_CLASS_UPDATE_FLOOR = "2026-08-28";

/** 오늘 재생해야 하는 스냅샷 — 기한이 됐고(<= 오늘) 바닥 이후이며 적용할 항목이 있는 것. */
export function dueClassUpdates(
  rows: readonly SnapshotClassUpdates[],
  today: string,
): SnapshotClassUpdates[] {
  return rows
    .filter(
      (r) =>
        r.effectiveDate > SCHEDULED_CLASS_UPDATE_FLOOR &&
        r.effectiveDate <= today &&
        r.updates.length > 0,
    )
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

/**
 * 담임을 지금 바꿔도 되는가 — **현재 값이 아직 예약 시점 그대로일 때만**.
 * ⚠️ 그 사이 사람이 손으로 바꿨으면 그 판단이 최신이다. 예약이 사람을 덮어쓰면 안 된다.
 * ⚠️ 이미 반영된 건(현재 == 적용값)도 여기서 자연히 false가 되어 두 번 돌아도 안전하다
 *    — 단 적용값과 예약시점값이 같은 경우(변경 없음)는 그냥 통과시켜도 결과가 같다.
 */
export function shouldApplyTeacher(u: ClassUpdate, currentTeacherId: string | null): boolean {
  if (u.teacherId === null) return false; // 이 필드는 변경 대상이 아니었다
  return currentTeacherId === u.prevTeacherId;
}

/**
 * 반 이름을 지금 바꿔도 되는가 — 담임과 **같은 규칙**(현재 값이 아직 예약 시점 그대로일 때만).
 *
 * 🔴 이름은 시트 매칭 키라 더 조심한다: 그 사이 사람이 이름을 손봤다면 그 이름으로 시트가 매칭되고
 *    있을 수 있다. 예약이 그걸 덮으면 다음 가져오기가 그 반을 못 찾아 **신설 후보로 떨어진다**.
 * ⚠️ `className`이 없는 옛 스냅샷은 항상 false — 이름 변경 대상이 아니었다는 뜻이다.
 */
export function shouldApplyName(u: ClassUpdate, currentClassName: string | null): boolean {
  const next = u.className ?? null;
  if (!next) return false; // 이 필드는 변경 대상이 아니었다(옛 스냅샷 포함)
  return currentClassName === (u.prevClassName ?? null);
}

/** 강의실도 같은 규칙(필드 독립 — 한쪽만 바뀐 반의 다른 쪽을 덮어쓰지 않는다). */
export function shouldApplyClassroom(u: ClassUpdate, currentClassroomId: string | null): boolean {
  if (u.classroomId === null) return false;
  return currentClassroomId === u.prevClassroomId;
}

/** 이 스냅샷의 담임 재생이 끝났음을 남기는 로그 종류 — 같은 걸 두 번 재생하지 않기 위한 표식. */
export const CLASS_UPDATES_APPLIED_KIND = "class_updates_applied";
