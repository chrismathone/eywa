import type { Access } from "@/lib/permissions";

/**
 * 반 레코드 **쓰기 스코프** — "강사(scoped)는 자기 담임 반만 고친다".
 *
 * 🔴 왜 필요한가: `classes` 메뉴는 강사가 `scoped`라, **접근 수준만 보면 남의 반까지 통과한다.**
 *    수준은 "반을 고칠 수 있는 사람인가"만 말하지 "이 반이 내 반인가"는 말하지 않는다. 그래서
 *    2026-09-04까지 `updateClass`·인수인계 3종은 반 id만 바꿔 보내면 **아무 반이나** 저장됐다
 *    (반 이름·과목·담임·시간표까지). 목록·시간표는 이미 담임으로 좁혀 있어 화면엔 안 보였을 뿐이라
 *    "화면에서만 잠갔다"의 전형([[#77]])이었다.
 *
 * 이 판정을 **순수 함수 한 벌**로 둔 이유: 같은 모양의 검사가 이미 세 곳(반 임시 위임 게이트·
 * 영어 레벨 변경 액션·반 상세의 위임 버튼 노출)에 손으로 복사돼 있었다. 네 번째를 또 적으면
 * 반드시 갈라진다 — 화면과 서버가 다른 말을 하면 "버튼은 보이는데 누르면 거절"이 된다.
 *
 * 규칙:
 *  · `full`(원장·부원장·실장, 겸직 관리자의 강사뷰 포함) = 학원 전체 반. 뷰 전환은 권한을 안 바꾼다.
 *  · `scoped`(강사) = **담임인 반만**(`classes.teacher_id`).
 *  · `readonly`(회계·뷰어·'다른 강사 뷰') · `none` = 쓰기 없음.
 *
 * ⚠️ **읽기 스코프와 일부러 다르다.** 상세 열람은 담임 ∪ 교시 담당 ∪ 임시 위임 **세 갈래**로 넓다
 *    (ECS 게이트·학생 상세 열람과 같은 세 갈래 — [`server/class-scope.ts`](./server/class-scope.ts)).
 *    부담임·대체 강사는 그 반 화면을 봐야 하지만 **반의 구조를 바꿀 사람은 아니다**. 넓은 쪽을 쓰기에
 *    끌어다 쓰지 말 것.
 * ⚠️ 담임이 `null`인 반은 **아무 강사도 못 고친다**(사무실이 담임을 정한 뒤에 열린다) — 비어 있는
 *    값을 "누구나"로 읽으면 신설 반이 전 강사에게 열린다.
 */
export const CLASS_NOT_MINE_ERROR =
  "담당 반만 수정할 수 있습니다 — 다른 반은 원장·실장에게 요청해주세요";

/** 위임 쓰기 거절 문구 — 판정은 같고 **하는 일이 달라** 문장만 다르다(0173a 때부터 쓰던 말 그대로). */
export const CLASS_NOT_MINE_DELEGATE_ERROR =
  "담당 반만 위임할 수 있습니다 — 다른 반은 원장·실장에게 요청해주세요";

export function canWriteClassRecord(input: {
  /** `accessLevelTenant(role, "classes")` 결과. */
  level: Access;
  /** 이 반의 담임(`classes.teacher_id`). 모르면 null — 그땐 scoped는 통과 못 한다. */
  classTeacherId: string | null;
  /**
   * 화면 주인의 id — `getCurrentUser({ teacherView: true })`(강사뷰면 검증된 대상 강사, 아니면 실제 계정).
   * ⚠️ 실제 계정 id를 넘기면 안 된다: 수준(level)은 이미 대상 강사의 것이라, id만 실제 계정이면 대상의
   *    담임 반이 '남의 반'으로 판정된다(열람 전용 시절의 규칙이 남아 있었다 — 2026-11-05 강사뷰 신원 점검).
   */
  userId: string;
}): boolean {
  if (input.level === "full") return true;
  if (input.level !== "scoped") return false;
  return !!input.classTeacherId && input.classTeacherId === input.userId;
}
