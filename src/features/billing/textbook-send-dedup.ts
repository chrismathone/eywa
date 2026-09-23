/**
 * 교재요청서 **중복 발송 차단**(순수 함수 + Vitest) — 원장 지시 2026-08-03:
 * *"일반 수업보고서와 마찬가지로 같은 종류의 교재요청서는 aywa상에서 중복 발송되지 않도록 차단먹일 것."*
 *
 * 수업보고서는 `classnote_status='success'`면 재발송을 막는다(재발송은 옛 글을 고치는 게 아니라
 * **글이 하나 더 붙는 것**뿐이다). 교재요청서도 같은 모양으로, **이미 나간 건 다시 안 나간다.**
 * 📌 2026-08-05 정정: "ClassNote는 게시글 삭제가 없다"는 전제는 **틀렸다**(DELETE 실동작 — 수업보고서
 *    회수가 그 경로를 쓴다, `report-recall.ts`). 재발송을 막는 이유는 여전히 유효하지만(중복 게시),
 *    "지울 수 없으니 어쩔 수 없다"가 근거는 아니다.
 *
 * 막는 경우가 셋인데 **셋 다 필요하다**(하나만으로는 실제 데이터에서 못 막는다):
 *  ① **이 요청서가 이미 나갔다** — `classnoteNoticeId`가 있다. 수업보고서 success 차단과 1:1 대응.
 *  ② **같은 학생·같은 교재가 다른 요청서로 이미 나갔다** — 실측(2026-08-03) `김도연 · 가우스 중1-1 2권`이
 *     **행 3개로 중복 등록**돼 있었다. ①만으로는 나머지 2건이 그대로 또 나간다.
 *  ③ **한 번의 발송 안에 같은 학생·같은 교재가 두 번** — 위 3건을 한꺼번에 고르면 같은 글이 3번 게시된다.
 *
 * ⚠️ 탈출구는 **게시취소(회수)**다 — 회수하면 앱이 연결(`classnoteNoticeId`)을 비우므로 다시 보낼 수 있다.
 *    여기에 force 인자를 더하지 말 것(수업보고서 가드와 같은 규약 — 화면의 실수 클릭을 막는 게 전부다).
 * ⚠️ 사유 문자열은 **그대로 화면에 뜬다**(raw 코드 노출 금지 규약).
 */

/** 중복 판정 키 = (학생, 교재명). 교재명은 공백·대소문자 흔들림만 정규화한다(의미까지 추측하지 않는다). */
export function textbookSendKey(studentId: string | null | undefined, bookName: string | null | undefined): string {
  const s = (studentId ?? "").trim();
  const b = (bookName ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return `${s}|${b}`;
}

export type DedupCandidate = {
  id: string;
  studentId: string | null;
  studentName: string | null;
  bookName: string;
  /** 이미 나간 공지 id(있으면 이 요청서 자체가 발송분). */
  classnoteNoticeId: string | null;
};

/**
 * 사유는 **코드**로 낸다 — 한글 문구는 화면(`_send-targets.tsx` SKIP_LABEL)이 붙인다.
 * 기존 제외 사유(no_subject 등)와 같은 규약이라 raw 코드가 화면에 노출될 일이 없다.
 * ⚠️ 코드를 추가하면 그 라벨 맵도 같은 커밋에서 채울 것(Record 타입이라 빠뜨리면 컴파일이 잡는다).
 */
export type DedupReason = "already_sent" | "same_book_sent" | "dup_in_batch";
export type DedupSkip = { name: string; reason: DedupReason };

/**
 * 보낼 것 / 거를 것 분리. `alreadySentKeys` = DB에서 조회한 **이미 발송된** (학생,교재) 키 집합.
 * 입력 순서를 유지한다 — 같은 배치에 중복이 있으면 **먼저 온 것**을 보낸다(결정적).
 */
export function partitionAlreadySent(
  rows: readonly DedupCandidate[],
  alreadySentKeys: ReadonlySet<string>,
): { sendable: DedupCandidate[]; skipped: DedupSkip[] } {
  const sendable: DedupCandidate[] = [];
  const skipped: DedupSkip[] = [];
  const seenInBatch = new Set<string>();
  for (const r of rows) {
    const name = (r.studentName ?? "").trim() || "(학생)";
    if (r.classnoteNoticeId) {
      skipped.push({ name, reason: "already_sent" });
      continue;
    }
    const key = textbookSendKey(r.studentId, r.bookName);
    // 학생·교재를 모르면 키가 무의미해 중복 판정을 안 한다(막는 쪽이 아니라 보내는 쪽으로 — 정상 발송을 죽이지 않는다).
    const keyable = !!(r.studentId ?? "").trim() && !!(r.bookName ?? "").trim();
    if (keyable && alreadySentKeys.has(key)) {
      skipped.push({ name, reason: "same_book_sent" });
      continue;
    }
    if (keyable && seenInBatch.has(key)) {
      skipped.push({ name, reason: "dup_in_batch" });
      continue;
    }
    if (keyable) seenInBatch.add(key);
    sendable.push(r);
  }
  return { sendable, skipped };
}

/**
 * 연결된 공지가 **실제로 학부모에게 남아 있지 않은** 상태인가 — 감사 F3(2026-09-23).
 *
 * 연결(`classnoteNoticeId`)은 큐 적재 직후 박히므로, 워커가 끝내 실패(`failed`)했거나 게시취소가 끝난(`revoked`)
 * 공지도 연결은 그대로 남아 "이미 발송함"으로 영영 걸러졌다(같은 학생·같은 교재의 새 요청서까지 막혔다).
 * 이 둘만 발송분으로 치지 않는다. 🔴 나머지(대기·처리 중·성공·일부 성공·회수 중·일부 회수·수정 중)는
 *    학부모 보드에 글이 있거나 곧 생기므로 **계속 막는다**(중복 게시가 되돌리기 어려운 쪽이다).
 * ⚠️ `dry_run`은 공지 상태가 아니다 — 발송 스위치가 꺼진 발송은 애초에 연결하지 않는다(textbook-notice-actions).
 */
const DEAD_NOTICE_STATUSES: ReadonlySet<string> = new Set(["failed", "revoked"]);
export function isDeadNoticeStatus(status: string | null | undefined): boolean {
  return !!status && DEAD_NOTICE_STATUSES.has(status);
}
