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

/** 반 공지 한 건에 붙일 수 있는 이미지 상한(앱 `NOTICE_ATTACHMENT_MAX`와 같은 값). */
export const CLASS_NOTICE_IMAGE_MAX = 10;

/**
 * 큐 행(`classnote_class_notices`)의 **이미지 첨부**(원장 2026-10-03 *"반공지 이미지 가능하게"*).
 * 새 칸을 만들지 않고 `targets[].attachments`에 싣는다(원생 개별 공지의 학생별 첨부와 같은 자리 — SQL 없이 간다, [[#95]]).
 * 반 공지의 이미지는 **전 반 공통**이라 대상마다 같은 목록이 들어 있다 — 경로 기준으로 합쳐 한 벌로 돌려준다.
 * @returns {Array<{path:string, name:string}>}
 */
export function classNoticeAttachments(row) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(row?.targets) ? row.targets : []) {
    for (const a of Array.isArray(t?.attachments) ? t.attachments : []) {
      const path = typeof a?.path === "string" ? a.path.trim() : "";
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, name: String(a?.name ?? "").trim() || "이미지" });
    }
  }
  return out;
}

/**
 * 공지 요청 본문. 🔴 대상 반은 **정확히 하나**(양의 정수) — 아니면 던진다(기관 전체 공지 사고 차단).
 * `attachedImages` = ClassNote 내부 저장소(kage)에 올려 받은 이미지(알림장과 같은 모양 — 2026-10-03 테스트반 실측).
 *   키가 없는 항목·상한 초과는 던진다(이미지가 조용히 빠진 공지를 올리지 않는다).
 */
export function buildClassNoticePayload({ boardId, title, body, centerId, authorName, attachedImages = [] }) {
  const id = Number(boardId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("반 단체 공지: 대상 반 번호가 올바르지 않습니다 — 발송 중단");
  if (!String(title ?? "").trim() || !String(body ?? "").trim()) throw new Error("반 단체 공지: 제목·내용이 비었습니다");
  const images = Array.isArray(attachedImages) ? attachedImages : [];
  if (images.length > CLASS_NOTICE_IMAGE_MAX) throw new Error(`반 단체 공지: 이미지는 최대 ${CLASS_NOTICE_IMAGE_MAX}장입니다`);
  if (images.some((x) => typeof x?.access_key !== "string" || !x.access_key)) throw new Error("반 단체 공지: 올리지 못한 이미지가 있습니다 — 발송 중단");
  return {
    classes_to: [id],
    title: String(title),
    content: String(body),
    attached_images: images,
    attached_video: null,
    attached_files: [],
    is_comment_on: true,
    center: Number(centerId),
    author_name: authorName,
    scheduled: "",
  };
}
