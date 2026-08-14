/**
 * **반 전체 안내** 판별 — 특이사항 칸에 들어온 반 공지를 개인 관찰과 갈라낸다(순수 함수).
 *
 * 🔴 왜 필요한가(2026-08-13 실측): 8/13 한 반 학생 6명의 특이사항이 **글자까지 똑같았다** —
 *    "내일 특강은 1시입니다. / 중2-2 진도가 완료되었습니다. 내일은 전범위 시험있습니다."
 *    특이사항은 AI 멘트의 주재료라, 재료가 같으면 멘트도 6명이 거의 같아진다(실제로 그랬다).
 *    프롬프트를 아무리 고쳐도 **재료가 같으면 답도 같다** — 모델 문제가 아니다.
 *
 * ⚠️ 강사가 잘못 쓴 게 아니다. 저건 학부모가 당연히 알아야 할 안내인데 **넣을 자리가 없었다**
 *    (반 서술은 sessionStorage 임시라 저장도 안 되고 학부모에게도 안 나간다). 그래서 특이사항에 6번 적었다.
 *
 * 성격이 다른 두 가지다:
 *   · 특이사항 = 그 아이 하나("개념 어려워해 연습문제로 한 번 더 확인 후 하원") → 관찰의 재료로 **녹여 쓴다**
 *   · 반 공지 = 반 전체("내일 특강 1시, 전범위 시험")                        → **그대로 전한다**(개인화하면 거짓말)
 *
 * 판정은 보수적으로: 같은 반에서 특이사항을 **쓴 학생이 3명 이상**이고 그들의 값이 **전부 동일**할 때만
 * 반 공지로 본다. 한 명이라도 다르게 썼으면 개인 관찰이 섞인 것이라 손대지 않는다.
 *
 * 🔑 **왜 3명인가**(적대 검토 2026-08-13): 2명이면 짧은 개인 메모가 우연히 겹칠 수 있다(둘 다 "조퇴").
 *    그걸 공지로 오판하면 그 아이의 사실이 **반 전체 방송**으로 둔갑한다 — 새로운 거짓이다.
 *    반면 못 잡으면 지금까지와 똑같이 동작할 뿐이다(무해). **오판보다 무동작이 안전**하므로 기준을 올렸다.
 *    실측 사례는 6/6이라 3으로도 잡힌다.
 */

/** 몇 명이 똑같이 써야 반 공지로 보는가 — 오판 방지 하한(위 주석 참조). */
export const MIN_SHARED = 3;

/** 판정 입력 1행 — (그 행의 반, 그 행의 특이사항). 반이 없는 행(보강 등)은 무시된다. */
export type ClassNoteRow = { classId: string | null | undefined; note: string };

/** 비교용 정규화 — 앞뒤 공백·줄바꿈 차이로 "다른 글"이 되지 않게. 내용 자체는 바꾸지 않는다. */
function norm(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

/**
 * 반별 **반 전체 안내** — `classId` → 안내 원문(첫 행의 원문 그대로).
 * 반환에 없는 반 = 반 공지가 아님(개인 특이사항이거나 자료 부족).
 */
export function detectClassNotices(rows: readonly ClassNoteRow[]): Map<string, string> {
  const byClass = new Map<string, { first: string; norm: string; n: number; same: boolean }>();
  for (const r of rows) {
    if (!r.classId) continue; // 반이 없는 행(순수 보강)은 '반 전체'라는 게 성립하지 않는다
    const n = norm(r.note ?? "");
    if (!n) continue; // 안 쓴 학생은 판정에서 뺀다(전원이 써야 하는 건 아니다)
    const cur = byClass.get(r.classId);
    if (!cur) byClass.set(r.classId, { first: r.note, norm: n, n: 1, same: true });
    else {
      cur.n += 1;
      if (cur.norm !== n) cur.same = false;
    }
  }
  const out = new Map<string, string>();
  for (const [classId, v] of byClass) if (v.same && v.n >= MIN_SHARED) out.set(classId, v.first);
  return out;
}

/**
 * 이 행의 특이사항이 **반 전체 안내인가** — 맞으면 `{ classNotice, specialNote: "" }`로 갈라 준다.
 * 🔴 둘 다에 넣지 않는다. 같은 문장이 '안내'와 '이 아이의 특이사항'으로 두 번 들어가면
 *    모델이 그걸 개인 사실로 한 번 더 쓴다(중복이 곧 AI 티다).
 */
export function splitNoticeFromNote(
  note: string,
  classId: string | null | undefined,
  notices: ReadonlyMap<string, string>,
): { classNotice: string; specialNote: string } {
  const notice = classId ? notices.get(classId) : undefined;
  if (notice && norm(notice) === norm(note ?? "")) return { classNotice: notice, specialNote: "" };
  return { classNotice: "", specialNote: note ?? "" };
}
