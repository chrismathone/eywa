// scripts/_classnote/classnote-class-route.mjs — 수학 **반 보드 경로**의 대상 확정 + 게시 후 교차 확인(워커 전용).
//
// 원장 2026-09-29: 반 보드(aywa 반과 이름이 같은 ClassNote 반)에 학생 1:1로 보낸다. 🔴 가장 위험한 경로 =
// **같은 반 동명이인** — 그래서 원아는 이름으로 절대 찾지 않고, 0302a `classnote_class_board_members`에
// 가드(1인 보드 원아·보호자 전화·생년·역방향 유일성·같은 반 동명이인·이름 연속성)를 통과해 ok로 적힌 원아만 쓴다.
// 게시 직전 ClassNote를 **다시 읽어** 그 원아가 아직 그 반에 배정돼 있는지 확인하고(TOCTOU), 게시 뒤에는
// 같은 반 다른 원아의 알림장을 훑어 이 보고서 링크가 새지 않았는지 본다(마지막 차단).
import { fetchBoardChildren, fetchChildDetail, findChildReportId } from "./classnote-admin-core.mjs";
import { normalizeRouteConfig } from "./class-route-decide.mjs";

/** 설정 직독(allowlist와 같은 패턴 — 앱 캐시 무관, 커밋값 즉시). */
export async function getClassnoteMathRoute(sql, tenant) {
  const [row] = await sql`select data->'report' as report from tenant_settings where tenant_id = ${tenant}`;
  return normalizeRouteConfig(row?.report ?? null);
}

/**
 * 이 학생을 이 반 보드로 게시할 수 있는가 — **반 보드 연결(0302a) + 그 학생의 원아 매칭이 ok**인 수학 반(원장 2026-09-30).
 * 🔴 앱 `classBoardLiveForStudent`·보낼 반 후보와 **같은 규칙**이다 — 연결만 보면 앱은 다른 반을 고르게 했는데 여기선
 *    원래 반으로 가서 "원아 매칭이 끝나지 않았습니다"로 실패한다.
 * - 특강도 정규 반과 같다(*"특강도 그냥 클래스노트에 반을 만드는게 가장 베스트"* — 매일 동기화가 특강 반 보드도 만든다).
 * - 종강 반도 연결이 남아 있으면 그대로 보낸다(*"클래스노트에 반이 살아있는 한은 계속 보내고"*) — 매일 동기화는 종강 반의
 *   ClassNote 보드가 **실제로 남아 있을 때만** 연결을 지키고, 지워졌으면 연결을 걷는다(math-class-boards-db.mjs keep).
 * - 미발송·폐지 반은 아니다. 연결이 없으면 앱이 정한 '보낼 반'(classnote_class_id)으로, 그것도 없으면 1인 보드로(pickRouteClass).
 * ⚠️ 0302a 표가 없으면 throw — 호출부가 잡는다(예전처럼 "대상"으로 두고 대상 확정 단계가 실패로 드러낸다).
 */
export async function isClassRouteEligible(sql, tenant, classId, studentId) {
  if (!classId || !studentId) return false;
  const [row] = await sql`select 1 as ok from classes c
    join classnote_class_boards b on b.tenant_id = c.tenant_id and b.class_id = c.id
    where c.tenant_id = ${tenant} and c.id = ${classId} and c.is_active and not c.report_optout
      and c.subject in ('math', 'subject_1')
      and exists (select 1 from classnote_class_board_members m
        where m.tenant_id = c.tenant_id and m.class_id = c.id and m.student_id = ${studentId} and m.status = 'ok')
      -- 보류 행이 하나라도 있으면 resolveClassTargets가 실패한다 — 게시할 수 있는 반이 아니다(앱 liveBoardClassIdsOf와 같다).
      and not exists (select 1 from classnote_class_board_members m
        where m.tenant_id = c.tenant_id and m.class_id = c.id and m.student_id = ${studentId} and m.status <> 'ok')`;
  return !!row;
}

/**
 * 반 보드 대상 확정. 실패는 전부 **결정적**(재시도해도 같은 답) — 호출부가 failed로 고정하고 사유를 남긴다.
 * ⚠️ 0302a 표가 없으면(SQL 미적용) 조회가 throw한다 → 호출부가 잡아 1인 보드로 보내지 않고 실패로 둔다
 *    (설정을 반별로 바꿨는데 조용히 옛 경로로 가면 원장이 시험 결과를 오해한다).
 * @returns {Promise<{ok:true, boardId:number, boardName:string, targets:Array<{child:{id:number,name:string}, enrollment:{id:number}}>, others:number[]}
 *                 | {ok:false, error:string}>}
 */
export async function resolveClassTargets(sql, page, { tenant, centerId, classId, studentId }) {
  // 🔴 보고서 미발송 반(JJ 자리 반)은 반 보드 연결이 있어도 보내지 않는다 — 동기화는 미발송 반을 연결하지 않지만(11-04 'JJ 맞춤'
  //    되돌림) 옛 연결이 남아 있을 수 있다. 발송 판정(isClassRouteEligible·앱)이 먼저 거르지만, 그 조회가 실패해 '대상'으로 넘어온 경우의 마지막 방어.
  const [board] = await sql`select b.board_id, b.board_name from classnote_class_boards b
    join classes c on c.tenant_id = b.tenant_id and c.id = b.class_id
    where b.tenant_id = ${tenant} and b.class_id = ${classId} and not c.report_optout`;
  if (!board) return { ok: false, error: "반별 발송: 이 반의 ClassNote 반 연결이 없습니다(C.N 빨강) — 반 매칭 후 다시 발송하세요" };
  const rows = await sql`select child_id, child_name, status, reason from classnote_class_board_members
    where tenant_id = ${tenant} and class_id = ${classId} and student_id = ${studentId}`;
  const held = rows.filter((x) => x.status !== "ok");
  if (!rows.length || held.length)
    return {
      ok: false,
      error: `반별 발송: 이 학생의 ClassNote 원아 매칭이 끝나지 않았습니다(C.N 빨강)${
        held.length ? ` — ${held.map((h) => h.reason).filter(Boolean).join(" / ").slice(0, 160)}` : ""
      }`,
    };
  const boardId = Number(board.board_id);
  // 실시간 재확인 — 그 사이 원장이 ClassNote에서 배정을 바꿨을 수 있다.
  const live = await fetchBoardChildren(page, centerId, boardId);
  const liveIds = new Set(live.map((m) => Number(m.id)));
  const targets = [];
  for (const r of rows) {
    const childId = Number(r.child_id);
    if (!liveIds.has(childId))
      return { ok: false, error: `반별 발송: 원아 "${r.child_name ?? childId}"가 ClassNote 반(${board.board_name})에 없습니다 — 반 매칭 후 다시 발송하세요` };
    const detail = await fetchChildDetail(page, childId);
    const enrollment = (detail?.enrollment ?? []).find((e) => e.belong_to_class === boardId && !e.removed_child);
    if (!enrollment)
      return { ok: false, error: `반별 발송: 원아 "${r.child_name ?? childId}"의 반 배정 기록을 찾지 못했습니다` };
    targets.push({ child: { id: childId, name: r.child_name ?? "" }, enrollment });
  }
  const mine = new Set(targets.map((t) => t.child.id));
  return { ok: true, boardId, boardName: board.board_name, targets, others: [...liveIds].filter((id) => !mine.has(id)) };
}

/**
 * 게시 후 교차 확인 — 같은 반 **다른** 원아의 최근 알림장에 이 보고서 링크가 있으면 새어 나간 것이다.
 * @returns {Promise<{ok:true} | {ok:false, leakedTo:number[], unknown:boolean}>}
 *   unknown=true = 조회 실패로 확인 못 함(새었다고 단정하지 않지만 호출부는 경고를 남긴다).
 */
export async function crossCheckOthers(page, { centerId, boardId, others, contents }) {
  const leakedTo = [];
  let unknown = false;
  for (const child of others) {
    const r = await findChildReportId(page, centerId, { cls: boardId, child, content: contents });
    if (!r.ok) unknown = true;
    else if (r.id) leakedTo.push(child);
  }
  return leakedTo.length || unknown ? { ok: false, leakedTo, unknown } : { ok: true };
}
