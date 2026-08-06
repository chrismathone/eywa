/**
 * scripts/_classnote/classnote-inbox-store.mjs — 학부모 연락 **원문 저장 + 분류 킥**(0184a).
 *
 * 기존 인바운드(글·댓글 → 담당 강사 벨)와 **다른 축**이다:
 *  - 기존: `(수학)` 1인 보드만 · 보드명으로 학생 매핑 · notifications에 강사 수만큼 복제.
 *  - 여기: **전 보드**(영어 그룹반 포함) · **원아 id**로 학생 매핑 · 원문 **1행**만 저장.
 *
 * 왜 전 보드인가(2026-08-06 실측): 재원 341명 중 **영어만 다니는 학생이 149명(44%)**. 수학 보드만 보면
 * 셔틀·출결 명단의 절반이 빈다. 실제로 같은 날 `(영어)최연재`에 "가족여행이 있어 연재 오늘 내일 수업에
 * 못갈것같아요"가 올라왔지만 수학 전용 폴러는 그 글을 보지도 못했다.
 *
 * 왜 원아 id인가: 그룹반 보드명(`[EIE] Let's Speak 6 …`)엔 학생이 없다. 반면 피드 행의 `child`는
 * **그룹반 포함 100%** 채워진다(실측 43/43). 매핑은 `classnote_child_links`(sync-child-map이 채움).
 *
 * ⚠️ 분류(AI)는 여기서 하지 않는다 — 앱의 `generateJSON()` 단일 진입점을 거쳐야 하고(CLAUDE.md),
 *    연동 PC에 AI 키를 두지 않기 위해서다. 저장 후 앱 내부 API를 **킥**만 한다(best-effort).
 * ⚠️ 저장 실패·킥 실패 모두 발송·강사 알림과 **독립**이다. 미분류 행은 다음 폴의 킥에서 다시 잡힌다.
 */

/**
 * 매핑표(원아 id → 학생 id) — 폴마다 1회 조회. 미매핑 원아는 그냥 없는 키다(그래도 원문은 저장한다).
 * ⚠️ 원아는 학생보다 많다(같은 아이의 다계정) — 표가 **원아 기준**인 이유(0185a).
 */
export async function loadChildStudentMap(sql, tenant) {
  const rows = await sql`select child_id, student_id from classnote_child_links where tenant_id = ${tenant}`;
  return new Map(rows.map((r) => [Number(r.child_id), r.student_id]));
}

/**
 * 학부모 연락 원문 저장(멱등 — 유니크 인덱스가 같은 글·댓글의 재삽입을 흡수한다).
 *
 * ⚠️ **학생을 못 찾아도 저장한다.** 매핑은 나중에 채워질 수 있고(원아 가입·전화 입력), 그때 이 행을
 *    되살리려면 원문이 남아 있어야 한다. 대신 `student_id`가 비면 알림은 안 나간다(누구 얘긴지 모르니까).
 *
 * @param {Array<{source:"post"|"comment", postId:number, commentId?:number|null, childId?:number|null,
 *                className?:string|null, content?:string|null, postedAt?:string|null}>} items
 * @returns {Promise<number>} 실제로 새로 들어간 행 수
 */
export async function storeParentMessages(sql, tenant, items, childToStudent) {
  const rows = [];
  for (const it of items ?? []) {
    const content = String(it?.content ?? "").trim();
    // 내용이 아예 없는 건(사진·스티커만) 출결 판단 재료가 없다 → 저장하지 않는다(분류 비용만 든다).
    // 강사 벨엔 기존 경로가 "[사진 1장] (내용 없이 첨부만)"으로 그대로 알린다.
    if (!content) continue;
    const childId = Number(it?.childId);
    rows.push({
      tenant_id: tenant,
      source: it.source,
      classnote_post_id: Number(it.postId),
      classnote_comment_id: it.commentId == null ? null : Number(it.commentId),
      child_id: Number.isFinite(childId) ? childId : null,
      student_id: (Number.isFinite(childId) ? childToStudent.get(childId) : null) ?? null,
      class_name: it.className ?? null,
      content,
      posted_at: it.postedAt ?? null,
    });
  }
  if (!rows.length) return 0;
  const inserted = await sql`
    insert into classnote_parent_messages ${sql(
      rows,
      "tenant_id",
      "source",
      "classnote_post_id",
      "classnote_comment_id",
      "child_id",
      "student_id",
      "class_name",
      "content",
      "posted_at",
    )}
    on conflict do nothing
    returning id`;
  return inserted.length;
}

/**
 * 앱에 "분류해줘" 킥 — 실패해도 **삼키고 로그만** 남긴다.
 *
 * 워커가 이걸 치명으로 다루면 안 되는 이유: 분류는 늦어도 되지만(다음 폴이 재시도) 발송·강사 알림은
 * 늦으면 안 된다. 한 축의 네트워크 문제로 다른 축을 세우지 않는다.
 *
 * 🔴 **응답을 오래 기다리면 안 된다** — 데몬의 한 tick은 순차라서, 여기서 60초를 붙들면 **그만큼 발송 큐
 * 처리가 밀린다**(글 폴·댓글 폴에서 각각 부르므로 최악 두 배). 분류는 최대 60건×AI라 실제로 수십 초가 걸린다.
 * → **짧게 끊는다.** 연결을 끊어도 **서버는 계속 처리하고 결과를 DB에 쓴다**(행 단위 저장). 우리가 잃는 건
 * 로그 한 줄뿐이다. 중복 알림은 앱의 선점(`notified_at` compare-and-set)이 막는다.
 */
const KICK_TIMEOUT_MS = 8_000;
export async function kickClassify(log = console.log) {
  const base = process.env.CLASSNOTE_SHARE_BASE || process.env.CLASSNOTE_SCREENSHOT_BASE;
  const secret = process.env.CLASSNOTE_INTERNAL_SECRET;
  if (!base || !secret) {
    log("[출결분류] 킥 생략 — CLASSNOTE_SHARE_BASE 또는 CLASSNOTE_INTERNAL_SECRET 미설정(원문은 저장됨)");
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/internal/parent-messages/classify`, {
      method: "POST",
      headers: { "x-eywa-internal": secret },
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(`[출결분류] 킥 실패 HTTP ${res.status} — 다음 폴에서 재시도(원문은 저장됨)`);
      return { ok: false };
    }
    if (body.classified) {
      log(`[출결분류] ${body.classified}건 분류 · 출결 ${body.attendance ?? 0}건 · 알림 ${body.notified ?? 0}건`);
    }
    return { ok: true, ...body };
  } catch (e) {
    // 타임아웃은 **실패가 아니다** — 서버가 계속 처리 중이라는 뜻이다(위 주석 참조). 발송을 붙들지 않으려고
    // 일부러 짧게 끊었으므로, 여기서 "실패"라고 적으면 로그를 보는 사람이 헛다리를 짚는다.
    const aborted = e?.name === "TimeoutError" || e?.name === "AbortError";
    log(
      aborted
        ? "[출결분류] 요청 접수 — 결과는 기다리지 않는다(서버에서 계속 처리·다음 폴 로그에서 확인)"
        : `[출결분류] 킥 오류 — 다음 폴에서 재시도(원문은 저장됨): ${e.message}`,
    );
    return { ok: aborted };
  }
}
