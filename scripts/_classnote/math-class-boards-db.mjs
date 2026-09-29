// scripts/_classnote/math-class-boards-db.mjs — 반 보드 판정 결과를 0302a 표에 적는다(워커·스크립트 전용, service_role 직결).
//
// 원스크린 'C.N' 라벨과 발송 워커의 반 보드 경로가 **이 표만** 읽는다. 그래서 여기에는 ClassNote에서
// **실제로 확인된 것만** ok로 적는다 — 계획상 배정 예정(아직 배정 전)은 ok가 아니라 hold("반 보드 배정 전").
// 🔴 보호자 전화 **값**은 reason에 절대 넣지 않는다(class-board-plan.mjs 사유는 일치 여부만 담는다).
// 🔴 반 단위로 지우고 다시 넣는다(upsert 없음 — 0302a 부분 유니크와 충돌 없음, [[#113]]). 한 반은 한 트랜잭션.

/**
 * @param {import("postgres").Sql} sql
 * @param {string} tenant
 * @param {ReturnType<import("./class-board-plan.mjs").planClassBoards>} plans  — 최신 계획(보드 원아 조회 포함)
 * @returns {Promise<{classes:number, ok:number, hold:number, cleared:number}>}
 */
export async function writeClassBoardSnapshot(sql, tenant, plans) {
  const out = { classes: 0, ok: 0, hold: 0, cleared: 0 };
  for (const p of plans) {
    await sql.begin(async (tx) => {
      if (p.board.deletedBoardId != null) {
        // ClassNote에서 지운 보드 — 배정 기록만 지우고 연결 행은 남긴다(지우면 다음 날 같은 이름으로 다시 만들어진다).
        const d1 = await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id = ${p.classId}`;
        out.cleared += d1.count;
        return;
      }
      if (p.board.action !== "exists") {
        // 보드가 없거나(생성 전) 특정 불가 — 이 반의 연결을 지운다(초록불이 남으면 거짓말이다).
        const d1 = await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id = ${p.classId}`;
        const d2 = await tx`delete from classnote_class_boards where tenant_id = ${tenant} and class_id = ${p.classId}`;
        out.cleared += d1.count + d2.count;
        return;
      }
      // 같은 보드를 다른 반이 들고 있으면(반 이름을 서로 바꾼 경우 등) 그 연결을 먼저 푼다 — 유니크(board_id) 충돌 방지.
      await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and board_id = ${p.board.id} and class_id <> ${p.classId}`;
      await tx`delete from classnote_class_boards where tenant_id = ${tenant} and board_id = ${p.board.id} and class_id <> ${p.classId}`;
      await tx`
        insert into classnote_class_boards (tenant_id, class_id, board_id, board_name, synced_at)
        values (${tenant}, ${p.classId}, ${p.board.id}, ${p.className}, now())
        on conflict (tenant_id, class_id) do update set board_id = excluded.board_id, board_name = excluded.board_name, synced_at = now()`;
      await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id = ${p.classId}`;
      const rows = [];
      for (const a of p.assign)
        for (const ch of a.children)
          rows.push(
            ch.already
              ? { status: "ok", student_id: a.studentId, child_id: ch.id, child_name: ch.name, reason: null }
              : { status: "hold", student_id: a.studentId, child_id: ch.id, child_name: ch.name, reason: "반 보드 배정 전 — 다음 동기화 때 배정됩니다" },
          );
      for (const h of p.hold)
        rows.push({ status: "hold", student_id: h.studentId, child_id: null, child_name: null, reason: h.reasons.join(" / ").slice(0, 500) });
      for (const r of rows)
        await tx`
          insert into classnote_class_board_members (tenant_id, class_id, board_id, student_id, child_id, child_name, status, reason, checked_at)
          values (${tenant}, ${p.classId}, ${p.board.id}, ${r.student_id}, ${r.child_id}, ${r.child_name}, ${r.status}, ${r.reason}, now())`;
      out.classes++;
      out.ok += rows.filter((r) => r.status === "ok").length;
      out.hold += rows.filter((r) => r.status === "hold").length;
    });
  }
  // 대상에서 빠진 반(종강·특강 전환·미발송 지정·폐지)의 옛 연결 — 남아 있으면 그 반 행에 초록불이 거짓으로 남는다.
  const live = plans.map((p) => p.classId);
  if (live.length) {
    const d1 = await sql`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id not in ${sql(live)}`;
    const d2 = await sql`delete from classnote_class_boards where tenant_id = ${tenant} and class_id not in ${sql(live)}`;
    out.cleared += d1.count + d2.count;
  }
  return out;
}
