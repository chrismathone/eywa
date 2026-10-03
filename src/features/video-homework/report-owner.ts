/**
 * 영상 과제 있음/없음은 **그 보고서를 처음 쓴 선생님(작성 계정, 0172a `created_by`)만** 바꾼다
 * (원장 2026-10-03 *"선생님으로 구분하면 되는거 아닌가"* · *"방어가드 충분히 가능한 부분"* · *"일어날 수 있는 크리티컬한
 * 가능성에 대해 삼사중 방어가드"*).
 *
 * 강사뷰 '영상 제출 현황'은 작성 계정으로 "내가 낸 숙제"를 가른다. 그런데 보고서는 학생 × 날짜 × 반 한 줄이라
 * 그 반을 함께 맡는 선생님(교시 담당·대신 수업)도 같은 줄을 저장할 수 있고, 작성 계정은 갱신에서 보존된다(0172a 트리거).
 * 막지 않으면 다른 선생님이 켠 영상 과제가 **켠 사람 장부엔 안 뜨고 작성자 장부에** 뜬다.
 *
 * 방어는 네 겹이다(한 겹이 빠져도 다음 겹이 막는다):
 *  ① 화면 — 오늘 남이 처음 쓴 줄은 토글을 잠그고 저장·일괄 적용에 값을 싣지 않는다(`getOthersReportKeys` → 공급자
 *     `useVideoHomeworkOthersReport`). 그 줄은 내 세션 값 대신 저장된 값을 보여 준다(onescreen/page.tsx).
 *  ② 저장 관문 — `saveLessonReport`가 이 함수로 다시 판정해 **그 값만 두고 나머지는 저장**한다(아래).
 *  ③ DB 트리거(0336a) — 직접 쓰기·두 선생님이 같은 순간 처음 저장하는 경합까지 값을 지킨다(로그인 사용자의 갱신만).
 *  ④ 테스트 — 판정·호출 순서·쓰기 경로가 하나뿐임·트리거 조건을 잠근다(report-owner.test.ts).
 *
 * 🔴 ②는 거절하지 않는다 — 거절하면 그 선생님의 임시저장(세션)이 바꾼 값을 쥐고 있어 새로 고쳐도 같은 거절이 반복되고,
 *    그 줄의 멘트·첨부 저장과 발송까지 함께 막혔다(적대 리뷰). 둔 값(`kept`)을 돌려주면 화면이 그 값으로 되돌리고
 *    강사뷰 언어로 알린다(`os.c.videoHwKept` — 세션도 따라 고쳐진다).
 *  · 값이 그대로면 해당 없음(그대로 적는다).
 *  · 작성 계정이 비어 있는 줄(사무실이 먼저 쓴 줄·옛 줄)은 해당 없음 — 이번 저장이 작성 계정을 채운다(트리거가 빈 값만 채움).
 *  · 화면이 낡아 작성자가 바꾼 값을 되돌리게 되는 저장도 여기서 걸러진다.
 * ⚠️ 영상 과제 값을 쓰는 곳은 원스크린 저장(`saveLessonReport`) 하나다 — 새 쓰기 경로를 만들면 이 판정도 함께 태울 것.
 * 실측(10-03): 최근 30일 그런 저장 0건 — 예방 가드다.
 *
 * 이번 저장이 영상 과제 값을 적으면 안 되면 `{ kept: 지금 값 }`, 적어도 되면 null.
 */
export function videoHomeworkKept(input: {
  /** 이미 저장된 줄(없으면 새 줄). */
  prior: { createdBy: string | null; videoHomework: boolean | null } | null;
  /** 이번 저장이 적으려는 값(안 보내면 undefined — 판정 안 함). */
  wanted: boolean | undefined;
  userId: string;
}): { kept: boolean | null } | null {
  const { prior, wanted, userId } = input;
  if (!prior || typeof wanted !== "boolean") return null;
  if (!prior.createdBy || prior.createdBy === userId) return null;
  if (wanted === prior.videoHomework) return null;
  return { kept: prior.videoHomework };
}
