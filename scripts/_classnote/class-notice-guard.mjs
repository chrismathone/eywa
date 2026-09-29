// scripts/_classnote/class-notice-guard.mjs — 반 단체 공지 안전 판정·요청 조립(순수, 의존성 0 — Vitest).
//
// 반 단체 공지는 ClassNote 반 보드에 **남아 있는 원아 전원**에게 간다(원아 해제는 화면에서 손으로만 된다).
// 그래서 보내기 전에 "보드의 원아 = 그 반 재원생(매칭 확인)"인지 대조하고, 모르는 원아가 하나라도 있으면 막는다.
// 🔴 `classes_to`는 ClassNote에서 **필수가 아니다** — 빠지면 기관 전체 공지일 수 있다. 요청은 반드시 여기서 조립한다.

/** 테스트 발송 대상 = `[수학] 테스트반`(원아 = 학원이·학원삼·학원사·학원오·학원육). */
export const TEST_NOTICE_BOARD = { id: 1317083, name: "[수학] 테스트반" };

/**
 * 보드 원아 대조.
 * @param {{ live: Array<{id:number, name?:string}>, allowed: Set<number> | number[] }} p
 *   live = ClassNote 보드의 지금 원아 · allowed = 그 반 재원생의 매칭 확인 원아(0302a ok ∩ 오늘 수강 중)
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function evaluateClassNoticeBoard({ live, allowed }) {
  const ok = allowed instanceof Set ? allowed : new Set(allowed);
  if (!Array.isArray(live) || live.length === 0) return { ok: false, reason: "ClassNote 반에 원아가 없습니다" };
  const extras = live.filter((m) => !ok.has(Number(m.id)));
  if (extras.length)
    return {
      ok: false,
      reason: `ClassNote 반에 이 반 재원생이 아닌 원아 ${extras.length}명(${extras
        .slice(0, 5)
        .map((m) => m.name ?? m.id)
        .join(", ")}${extras.length > 5 ? " 등" : ""}) — 반 공지가 그 집에도 갑니다. ClassNote에서 배정을 정리한 뒤 다시 보내세요`,
    };
  return { ok: true };
}

/** 테스트 보드 판정 — 원아가 전부 `학원`으로 시작하는 테스트 원아인가. */
export function isTestOnlyBoard(live) {
  return Array.isArray(live) && live.length > 0 && live.every((m) => String(m?.name ?? "").startsWith("학원"));
}

/**
 * 공지 요청 본문. 🔴 대상 반은 **정확히 하나**(양의 정수) — 아니면 던진다(기관 전체 공지 사고 차단).
 */
export function buildClassNoticePayload({ boardId, title, body, centerId, authorName }) {
  const id = Number(boardId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("반 단체 공지: 대상 반 번호가 올바르지 않습니다 — 발송 중단");
  if (!String(title ?? "").trim() || !String(body ?? "").trim()) throw new Error("반 단체 공지: 제목·내용이 비었습니다");
  return {
    classes_to: [id],
    title: String(title),
    content: String(body),
    attached_images: [],
    attached_video: null,
    attached_files: [],
    is_comment_on: true,
    center: Number(centerId),
    author_name: authorName,
    scheduled: "",
  };
}
