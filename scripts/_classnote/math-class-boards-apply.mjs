// scripts/_classnote/math-class-boards-apply.mjs — 반 보드 계획 **실행**(ClassNote 쓰기) — 수동 스크립트와 매일 동기화가 같은 코드.
//
// 한 반씩: ① 반 만들기(DOM '반 추가하기') 또는 ② 반 이름 바꾸기(PATCH — aywa에서 반 이름이 바뀐 경우) →
// ③ 원아 추가 배정(직전에 1인 보드를 다시 읽어 계획과 같은지 확인) → ④ 반 원아가 계획과 정확히 같은지 확인.
// 끝에 건드린 1인 보드가 **하나도 안 바뀌었는지** 확인한다. 이상하면 `ClassBoardStop`을 던진다(다음 반으로 넘어가지 않는다).
// 🔴 해제(원아·선생님)는 하지 않는다 — ClassNote API가 막았다(405). 되돌리기는 ClassNote 화면에서 손으로.
import { CLASSNOTE_BASE, createBoard, dismissHonorificDialog, enrollChild, fetchBoardChildren, fetchBoards } from "./classnote-admin-core.mjs";
import { personalBoardId } from "./math-class-boards-load.mjs";

export class ClassBoardStop extends Error {}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const ids = (list) => new Set((list ?? []).map((m) => m.id));

async function renameBoard(page, centerId, boardId, name) {
  return page.evaluate(
    async ([c, id, n]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const r = await fetch(`/api/v1/centers/${c}/classes/${id}/`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ name: n }),
      });
      return r.status;
    },
    [centerId, boardId, name],
  );
}

/**
 * @param {{ page, centerId, targets, boards, membersByBoard, students, log? }} p
 *   targets = 실행할 반 계획(보류 반 제외) · students = aywa 학생 지도(유효이름)
 * @returns {Promise<Array<{className, boardId, created:boolean, renamed:string|null, enrolled:Array<{name,childId}>, held:number}>>}
 */
export async function applyClassBoardPlans({ page, centerId, targets, boards, membersByBoard, students, log = console.log }) {
  const personalBefore = new Map();
  for (const p of targets)
    for (const a of p.assign) {
      const pid = personalBoardId(boards, students.get(a.studentId).name);
      if (pid != null && !personalBefore.has(pid)) personalBefore.set(pid, ids(membersByBoard.get(pid)));
    }

  const out = [];
  for (const p of targets) {
    const entry = { className: p.className, boardId: p.board.id ?? null, created: false, renamed: null, enrolled: [], held: p.hold.length };
    out.push(entry);
    let boardId = p.board.id ?? null;

    if (p.board.action === "create") {
      const before = await fetchBoards(page, centerId);
      if (before.some((b) => b.name === p.className)) throw new ClassBoardStop(`${p.className}: 그 사이 같은 이름 보드가 생겼다 — 중단(계획 다시)`);
      await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
      await dismissHonorificDialog(page);
      const res = await createBoard(page, p.className);
      const after = await fetchBoards(page, centerId);
      const added = after.filter((b) => !before.some((x) => x.id === b.id));
      if (!res.ok || added.length !== 1 || added[0].name !== p.className || after.length !== before.length + 1)
        throw new ClassBoardStop(`${p.className}: 반 생성 검증 실패 — ${res.reason ?? ""} · 새 보드 ${added.map((b) => JSON.stringify(b.name)).join(", ") || "없음"}`);
      boardId = added[0].id;
      entry.created = true;
      log(`  반 생성 ${p.className} #${boardId}`);
    } else if (p.board.rename) {
      const st = await renameBoard(page, centerId, boardId, p.board.rename.to);
      const now = (await fetchBoards(page, centerId)).find((b) => b.id === boardId)?.name;
      if (st !== 200 || now !== p.board.rename.to)
        throw new ClassBoardStop(`${p.board.rename.from} → ${p.board.rename.to}: 반 이름 변경 검증 실패(HTTP ${st} · 지금 ${JSON.stringify(now)})`);
      entry.renamed = p.board.rename.from;
      log(`  반 이름 변경 ${JSON.stringify(p.board.rename.from)} → ${JSON.stringify(p.board.rename.to)}`);
    }
    entry.boardId = boardId;

    const want = new Set();
    for (const a of p.assign) {
      const pid = personalBoardId(boards, students.get(a.studentId).name);
      const live = ids(await fetchBoardChildren(page, centerId, pid));
      const planned = new Set(a.children.map((c) => c.id));
      if (!sameSet(live, planned)) throw new ClassBoardStop(`${a.name}: 1인 보드 원아가 계획과 다르다(그 사이 변경) — 중단`);
      for (const c of a.children) {
        want.add(c.id);
        if (c.already) continue;
        const r = await enrollChild(page, c.id, boardId);
        if (r.status !== 201) throw new ClassBoardStop(`${a.name}: 배정 실패 HTTP ${r.status}`);
        entry.enrolled.push({ name: a.name, childId: c.id });
        await page.waitForTimeout(300);
      }
    }
    const members = await fetchBoardChildren(page, centerId, boardId);
    for (const m of membersByBoard.get(boardId) ?? []) want.add(m.id); // 원래 있던 원아(반을 옮긴 학생 등)는 그대로 남아 있어야 정상
    if (!sameSet(ids(members), want)) throw new ClassBoardStop(`${p.className}: 반 원아가 계획과 다르다 — 실제 ${members.map((m) => m.name).join(", ")}`);
    if (entry.enrolled.length) log(`  ${p.className}: 배정 ${entry.enrolled.length}건`);
  }

  for (const [pid, before] of personalBefore) {
    const now = ids(await fetchBoardChildren(page, centerId, pid));
    if (!sameSet(now, before)) throw new ClassBoardStop(`1인 보드 #${pid} 원아가 바뀌었다 — 확인 필요`);
  }
  return out;
}
