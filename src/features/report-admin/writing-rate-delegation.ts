import { isDelegationActiveOn } from "@/features/classes/delegation-window";

/**
 * 작성률의 **귀속 이동** — 임시 위임(0173a)된 (반, 날짜)의 대상(분모)을 대체 강사에게 넘긴다. 순수함수.
 *
 * 🔴 왜 필요한가: 작성률은 목표를 **담임 이름**으로, 작성 기록을 `lesson_reports.teacher_name`
 * (=**실제 작성자**)으로 잡는다. 위임한 날엔 두 축이 서로 다른 사람을 가리켜서,
 *  · 결근한 담임 = 대상은 그대로인데 작성 0 → **빨간 0%**(그 반은 남이 대신 했는데도)
 *  · 대신 쓴 강사 = 작성은 있는데 대상이 없어 → **"·"**(한 일이 안 보인다)
 * 둘 다 거짓 신호다. 그날 그 반을 쓸 책임은 대신 맡은 사람에게 있으므로 **대상을 그쪽으로 옮긴다.**
 *
 * ⚠️ 축이 **이름 문자열**인 건 기존 작성률 구조 그대로다(작성 기록이 이름으로만 남으므로).
 *    그래서 대체 강사의 `display_name`이 비어 있으면 귀속할 수 없다 — 호출부가 그런 행을 걸러서 넘긴다.
 * ⚠️ 이 함수는 **대상(분모)만** 옮긴다. 작성 기록(분자)은 이미 실제 작성자 이름으로 들어와 있어
 *    옮길 필요가 없다 — 옮기면 이중 이동이 된다.
 * ⚠️ 담임이 위임해놓고 **본인이 써버리면** 그날 대체 강사가 미작성으로 남는다(대상은 넘어갔으므로).
 *    의도된 트레이드오프다 — 그 상황의 정답은 위임을 해제하는 것이지 집계를 흐리는 게 아니다.
 */
export type WritingRateDelegation = {
  classId: string;
  /** 대체 강사 표시명 — 작성 기록(`teacher_name`)과 **같은 축**이어야 맞물린다. */
  teacherName: string;
  fromDate: string; // 포함
  toDate: string; // 포함
};

export type DelegateAttribution = (classId: string, date: string) => string | null;

/**
 * (반, 날짜) → 그날 그 반을 대신 맡은 강사 이름(없으면 null).
 * 같은 반·같은 날에 위임이 둘 이상이면 **시작일 → 이름** 순으로 앞선 것을 쓴다(결정적 — 새로고침마다
 * 강사가 바뀌면 작성률이 흔들린다). 실무상 겹칠 일은 없지만 순서를 우연에 맡기지 않는다.
 */
export function buildDelegateAttribution(
  rows: readonly WritingRateDelegation[],
): DelegateAttribution {
  const byClass = new Map<string, WritingRateDelegation[]>();
  for (const r of rows) {
    if (!r.classId || !r.teacherName) continue; // 이름 없는 행은 귀속 불가(위 주석)
    const list = byClass.get(r.classId);
    if (list) list.push(r);
    else byClass.set(r.classId, [r]);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.teacherName.localeCompare(b.teacherName));
  }
  return (classId, date) => {
    const list = byClass.get(classId);
    if (!list) return null;
    for (const d of list) {
      if (isDelegationActiveOn({ fromDate: d.fromDate, toDate: d.toDate }, date)) return d.teacherName;
    }
    return null;
  };
}
