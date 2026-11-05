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
 * @param {{ keepClassIds?: readonly string[], scoped?: boolean }} [opts]  — keepClassIds = 걷지 않고 지킬 연결(ClassNote 보드가 살아 있는
 *   종강 반, `closedClassesToKeep`) · scoped = **일부 반만** 본 실행(지금 동기화) — 계획 밖 반의 연결을 걷지 않는다
 * @returns {Promise<{classes:number, ok:number, hold:number, cleared:number}>}
 */
export async function writeClassBoardSnapshot(sql, tenant, plans, { keepClassIds = [], scoped = false } = {}) {
  if (sql.agentOperation) return sql.agentOperation("class-board-snapshot", { plans, keepClassIds, scoped });
  const out = { classes: 0, ok: 0, hold: 0, cleared: 0 };
  for (const p of plans) {
    await sql.begin(async (tx) => {
      if (p.board.deletedBoardId != null || p.board.keepLink === true) {
        // ClassNote에서 지운 보드 — 배정 기록만 지우고 연결 행은 남긴다(지우면 다음 날 같은 이름으로 다시 만들어진다).
        // keepLink = 연결된 보드 이름이 1인 보드 모양이라 막은 반(class-board-plan.mjs · 2026-11-04) — 같은 까닭으로 연결은 남긴다.
        const d1 = await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id = ${p.classId}`;
        out.cleared += d1.count;
        return;
      }
      if (p.board.action !== "exists") {
        // 보드가 없거나(생성 전) 특정 불가 — 이 반의 연결을 지운다(초록불이 남으면 거짓말이다).
        // ⚠️ 연결된 보드가 살아 있는 반은 여기 오지 않는다 — 이름 충돌이 있어도 계획이 exists(renameBlocked)로 지킨다(개명 감사 G1).
        const d1 = await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id = ${p.classId}`;
        const d2 = await tx`delete from classnote_class_boards where tenant_id = ${tenant} and class_id = ${p.classId}`;
        out.cleared += d1.count + d2.count;
        return;
      }
      // 같은 보드를 다른 반이 들고 있으면 그 연결을 먼저 푼다 — 유니크(board_id) 충돌 방지.
      // board_name = **ClassNote에 지금 붙은 이름**(개명이 막혔거나 실패하면 옛 이름) — 학부모 글 매칭·로그가 실제 보드를 가리키게.
      await tx`delete from classnote_class_board_members where tenant_id = ${tenant} and board_id = ${p.board.id} and class_id <> ${p.classId}`;
      await tx`delete from classnote_class_boards where tenant_id = ${tenant} and board_id = ${p.board.id} and class_id <> ${p.classId}`;
      await tx`
        insert into classnote_class_boards (tenant_id, class_id, board_id, board_name, synced_at)
        values (${tenant}, ${p.classId}, ${p.board.id}, ${p.board.name ?? p.className}, now())
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
  // 대상에서 빠진 반(종강·미발송 지정·폐지)의 옛 연결 — 남아 있으면 그 반 행에 초록불이 거짓으로 남는다.
  // 🔴 단, ClassNote 보드가 살아 있는 종강 반은 지킨다(원장 2026-09-30 — 반이 살아 있는 한 그 반으로 보낸다).
  // 🔴 일부 반만 본 실행(scoped)은 이 정리를 하지 않는다 — 계획에 없는 반 = "대상에서 빠진 반"이 아니라 "이번에 안 본 반"이다.
  //    여기서 지우면 지금 동기화 한 번에 **다른 모든 반의 연결이 사라진다**(발송이 전부 '보낼 반 없음'으로 막힌다).
  if (scoped) return out;
  const live = [...plans.map((p) => p.classId), ...keepClassIds];
  if (live.length) {
    const d1 = await sql`delete from classnote_class_board_members where tenant_id = ${tenant} and class_id not in ${sql(live)}`;
    const d2 = await sql`delete from classnote_class_boards where tenant_id = ${tenant} and class_id not in ${sql(live)}`;
    out.cleared += d1.count + d2.count;
  }
  return out;
}

/**
 * 반 보드별 **해제 리스트**(0329a, 원장 2026-10-02) — 그 보드엔 있는데 aywa 그 반 누구의 원아도 아닌 원아 이름(`plan.extras`).
 * 자동 해제(class-board-release.mjs)가 **보류한** 원아가 여기 남는다 — 사람이 확인하고 ClassNote 화면에서 정리한다. `held`를 넘기면
 * 이름 뒤에 **왜 자동으로 해제하지 않았는지**를 붙인다(전 반 최신 목록에서도 사유가 보이게).
 *  · 보드가 확인된 반(`exists`)만 적는다 — 방금 읽은 원아 목록이 근거라 그 반의 목록을 통째로 갈아 끼운다(없으면 빈 배열).
 *  · 🔴 어떤 실패도 동기화를 막지 않는다 — 칸이 아직 없으면(0329a 전, #95) 이 기록만 건너뛴다. 값은 `sql.json`으로(문자열로 넣으면 이중 인코딩, #82).
 * @param {import("postgres").Sql} sql
 * @param {string} tenant
 * @param {ReturnType<import("./class-board-plan.mjs").planClassBoards>} plans
 * @param {(line: string) => void} [log]
 * @returns {Promise<{classes:number, names:number, skipped:boolean}>}
 */
/**
 * 해제 대상 한 줄 — 원아 이름. 🔴 그 반 **보류 학생**과 이름이 겹치면 표시를 붙인다: 보류 학생(1인 보드가 없거나 가드에 걸린 재원생)의
 * 원아는 계획이 '그 반 누구의 원아'로 세지 못해 잉여로 떨어진다. 그대로 해제하면 **지금 다니는 학생**이 반 보드에서 빠지고,
 * 보류 상태라 동기화가 다시 넣지도 않는다(적대 리뷰 2026-10-02).
 */
const bare = (s) => String(s ?? "").replace(/[a-zA-Z\s()]/g, "");
export function releaseLabel(childName, hold) {
  const name = String(childName ?? "").trim();
  if (!name) return "";
  const key = bare(name);
  const twin = key.length >= 2 ? (hold ?? []).find((h) => { const k = bare(h?.name); return k.length >= 2 && (k.includes(key) || key.includes(k)); }) : null;
  return twin ? `${name} (확인 필요 — 이 반 보류 학생 '${twin.name}'의 원아일 수 있음)` : name;
}

export async function writeReleaseNames(sql, tenant, plans, log = console.log, held = []) {
  // (반, 원아 이름) → 보류 사유. 같은 이름이 둘이면 앞에서부터 하나씩 쓴다.
  const whyOf = (p, name) => {
    const at = held.findIndex((h) => h && !h.used && h.className === p.className && h.childName === name && h.why);
    if (at < 0) return null;
    held[at] = { ...held[at], used: true };
    return held[at].why;
  };
  const out = { classes: 0, names: 0, skipped: false };
  try {
    for (const p of plans) {
      if (p.board.deletedBoardId != null) {
        // ClassNote에서 지워진 보드 — 해제할 원아도 없다. 남겨 두면 없는 보드의 목록이 보고서에 계속 뜬다.
        await sql`update classnote_class_boards set release_names = ${sql.json([])}, release_checked_at = now()
          where tenant_id = ${tenant} and class_id = ${p.classId}`;
        continue;
      }
      if (p.board.action !== "exists" || p.board.id == null) continue;
      const names = [...new Set((p.extras ?? []).map((n) => {
        const why = String(n ?? "").trim() ? whyOf(p, n) : null;
        return why ? `${String(n).trim()} (자동 해제 보류 — ${why})` : releaseLabel(n, p.hold);
      }).filter(Boolean))];
      await sql`
        update classnote_class_boards set release_names = ${sql.json(names)}, release_checked_at = now()
        where tenant_id = ${tenant} and class_id = ${p.classId} and board_id = ${p.board.id}`;
      out.classes++;
      out.names += names.length;
    }
  } catch (e) {
    out.skipped = true;
    log(`[class-board] 해제 리스트 기록 건너뜀 — ${String(e?.message ?? e).slice(0, 120)}`);
  }
  return out;
}
