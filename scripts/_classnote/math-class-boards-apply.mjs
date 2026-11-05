// scripts/_classnote/math-class-boards-apply.mjs — 반 보드 계획 **실행**(ClassNote 쓰기) — 수동 스크립트와 매일 동기화가 같은 코드.
//
// 한 반씩: ① 반 만들기(DOM '반 추가하기') 또는 ② 반 이름 바꾸기(PATCH — aywa에서 반 이름이 바뀐 경우) →
// ③ 원아 추가 배정(직전 재확인 — 원아를 1인 보드에서 가져온 학생은 1인 보드를, 원아 연결(0185a)에서 가져온 학생은 원아 연결표를
//    다시 읽어 계획한 원아가 아직 이 학생 것인지 본다 · 반 보드 확인 기록에서 가져온 학생은 이미 그 반 보드에 있는 원아라 다시 읽을 출처가 없다) →
// ④ 반 원아가 계획과 정확히 같은지 확인.
// 끝에 건드린 1인 보드가 **하나도 안 바뀌었는지** 확인한다. 이상하면 `ClassBoardStop`을 던진다(다음 반으로 넘어가지 않는다).
// 🔑 해제(원아·선생님)는 여기서 하지 않는다 — 배정·기록이 끝난 뒤 class-board-release-apply.mjs가 따로 한다(원장 2026-10-02 자동 해제).
import { CLASSNOTE_BASE, createBoard, dismissHonorificDialog, enrollChild, fetchBoardChildren, fetchBoards } from "./classnote-admin-core.mjs";
import { personalBoardId } from "./math-class-boards-load.mjs";
import { isPersonalBoardName, normBoard } from "./board-safety.mjs";
import { reservedBoardName } from "./class-board-plan.mjs";

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
 * 계획한 원아 중 지금 다시 읽은 원아 연결에서 **이 학생에게 붙어 있지 않은** 원아 id들 — 하나라도 있으면 그 사이 연결이 바뀌었다(멈춘다).
 * 🔑 같은지(집합 일치)가 아니라 "계획한 원아가 아직 이 학생 것인가"만 본다 — 계획은 명부에 없는 옛 연결 원아를 빼고(class-board-plan.mjs
 *    `linkMembers`) 그 사이 새 연결이 하나 생길 수도 있어, 집합 일치로 보면 그때마다 동기화 전체가 멈춘다(적대적 리뷰 2026-11-02).
 *    새로 생긴 연결은 이번에 넣지 않고 다음 동기화가 가드와 함께 본다.
 */
const unlinkedPlanned = (childLinks, studentId, planned) => {
  const owner = new Map([...(childLinks ?? [])].map(([cid, sid]) => [Number(cid), sid]));
  return planned.filter((id) => owner.get(Number(id)) !== studentId);
};

/**
 * @param {{ page, centerId, targets, boards, membersByBoard, students, log?, out?, reloadChildLinks? }} p
 *   targets = 실행할 반 계획(보류 반 제외) · students = aywa 학생 지도(유효이름)
 *   out = 반별 결과를 담을 배열(호출자가 넘기면 **도중에 멈춰도** 그때까지 한 일이 호출자에게 남는다 — 동기화 보고서 0329a)
 *   reloadChildLinks = 원아 연결표(0185a)를 **지금** 다시 읽는 함수(`() => loadChildLinks(sql, tenant)`) — 원아 연결에서 가져온 학생이
 *     있으면 필수(없으면 멈춘다). 연결은 사람이 손으로 고친다(형제에게 잘못 붙은 연결) — 계획과 배정 사이에 고쳤으면 옛 연결로 넣지 않는다.
 * @returns {Promise<Array<{className, boardId, created:boolean, renamed:string|null, enrolled:Array<{name,childId}>, held:number}>>}
 */
export async function applyClassBoardPlans({ page, centerId, targets, boards, membersByBoard, students, log = console.log, out = [], reloadChildLinks = null }) {
  // 1인 보드 재확인은 **원아를 1인 보드에서 가져온 학생만** 한다. 반 보드 확인 기록·원아 연결에서 가져온 학생(source "verified"·"link" —
  // 1인 보드가 없거나 비었다, 원장 2026-11-02)은 1인 보드가 출처가 아니라서, 다시 읽으면 늘 "계획과 다르다"로 동기화 전체가 멈춘다.
  const fromPersonal = (a) => (a.source ?? "personal") === "personal";
  const fromLink = (a) => a.source === "link";
  const personalBefore = new Map();
  for (const p of targets)
    for (const a of p.assign) {
      if (!fromPersonal(a)) continue;
      const pid = personalBoardId(boards, students.get(a.studentId).name);
      if (pid != null && !personalBefore.has(pid)) personalBefore.set(pid, ids(membersByBoard.get(pid)));
    }

  for (const p of targets) {
    const entry = { classId: p.classId, className: p.className, boardId: p.board.id ?? null, created: false, renamed: null, enrolled: [], held: p.hold.length, skipped: null };
    out.push(entry);
    let boardId = p.board.id ?? null;

    // 🔴 1인 보드 꼴 이름(`(수학)`·`(영어)` — 계획한 반 이름이나 지금 연결된 보드 이름)이면 만들지도, 이름을 바꾸지도, 원아를 넣지도
    //    않는다(원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"* · 1.0.14). 그 반만 건너뛴다.
    const linkedName = boardId != null ? boards.find((b) => Number(b.id) === Number(boardId))?.name : null;
    if (isPersonalBoardName(p.className) || isPersonalBoardName(linkedName)) {
      entry.skipped = "1인 보드 꼴 이름이라 반 보드로 다루지 않습니다(1인 보드에는 원아를 배정하지 않습니다)";
      log(`  ⛔ ${p.className}: ${entry.skipped}`);
      continue;
    }

    // 🔑 이름 검증 실패는 **그 반만** 보류한다(개명 감사 G8) — 전에는 한 반의 생성·개명 검증 실패가 ClassBoardStop으로
    //    동기화 전체(다른 반 신입 배정·0302a 기록)를 매일 멈췄다. 원아 대조 실패는 여전히 전체를 멈춘다(오배정 위험).
    if (p.board.action === "create") {
      const before = await fetchBoards(page, centerId);
      if (before.some((b) => b.name === p.className)) {
        entry.skipped = "그 사이 같은 이름 보드가 생겼다 — 내일 다시 계획";
        log(`  ⛔ ${p.className}: ${entry.skipped}`);
        continue;
      }
      await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
      await dismissHonorificDialog(page);
      const res = await createBoard(page, p.className);
      const after = await fetchBoards(page, centerId);
      const added = after.filter((b) => !before.some((x) => x.id === b.id));
      // 여러 개가 새로 생겼다 = 누가 동시에 만들고 있다 — 어느 게 우리 것인지 모르니 전체를 멈춘다.
      if (added.length > 1 || after.length > before.length + 1)
        throw new ClassBoardStop(`${p.className}: 반 생성 중 보드가 ${added.length}개 늘었다 — 중단(사람 확인)`);
      if (added.length === 0) {
        entry.skipped = `반 생성 실패 — ${res.reason ?? "새 보드 없음"}`;
        log(`  ⛔ ${p.className}: ${entry.skipped}`);
        continue;
      }
      // 🔴 새 보드는 **확인된 것만** 이 반으로 연결·배정한다 — 응답 성공 + 이름이 (공백만 빼고) 같음 + 예약된 모양 아님.
      //    아니면 그 반만 보류하고 원아를 넣지 않는다(확인 안 된 보드에 가족을 넣지 않는다). 만들어진 보드는 사람이 본다.
      const madeName = added[0].name;
      if (!res.ok || normBoard(madeName) !== normBoard(p.className) || reservedBoardName(madeName)) {
        entry.skipped = `반 생성 결과를 확인하지 못해 보류 — 새 보드 #${added[0].id} ${JSON.stringify(madeName)}(ClassNote에서 확인 필요)`;
        log(`  ⛔ ${p.className}: ${entry.skipped}`);
        continue;
      }
      boardId = added[0].id;
      entry.created = true;
      if (madeName !== p.className) log(`  ⚠️ ${p.className}: ClassNote 이름이 ${JSON.stringify(madeName)}(공백만 다름) — 번호(#${boardId})로 연결합니다`);
      log(`  반 생성 ${p.className} #${boardId}`);
    } else if (p.board.rename) {
      const st = await renameBoard(page, centerId, boardId, p.board.rename.to);
      const now = (await fetchBoards(page, centerId)).find((b) => b.id === boardId)?.name;
      if (st !== 200 || now !== p.board.rename.to) {
        // 이름만 못 바꿨다 — 연결(번호)은 그대로라 발송은 계속된다. 원아 배정은 이어서 한다.
        entry.renameFailed = `HTTP ${st} · 지금 ${JSON.stringify(now)}`;
        log(`  ⚠️ ${JSON.stringify(p.board.rename.from)} → ${JSON.stringify(p.board.rename.to)}: 반 이름 변경 실패(${entry.renameFailed}) — 연결된 보드로 계속 보냅니다`);
      } else {
        entry.renamed = p.board.rename.from;
        log(`  반 이름 변경 ${JSON.stringify(p.board.rename.from)} → ${JSON.stringify(p.board.rename.to)}`);
      }
    }
    entry.boardId = boardId;

    const want = new Set();
    // 원아 연결 재확인 — 이 반에 연결 출처 학생이 있으면 배정 직전에 한 번 다시 읽는다(반마다 · DB 조회 1건).
    let linksNow = null;
    for (const a of p.assign) {
      if (fromPersonal(a)) {
        const pid = personalBoardId(boards, students.get(a.studentId).name);
        const live = ids(await fetchBoardChildren(page, centerId, pid));
        const planned = new Set(a.children.map((c) => c.id));
        if (!sameSet(live, planned)) throw new ClassBoardStop(`${a.name}: 1인 보드 원아가 계획과 다르다(그 사이 변경) — 중단`);
      } else if (fromLink(a)) {
        if (typeof reloadChildLinks !== "function") throw new ClassBoardStop(`${a.name}: 원아 연결에서 가져온 학생인데 원아 연결을 다시 읽을 수 없다 — 중단`);
        linksNow ??= await reloadChildLinks();
        if (unlinkedPlanned(linksNow, a.studentId, a.children.map((c) => c.id)).length)
          throw new ClassBoardStop(`${a.name}: 원아 연결이 계획과 다르다(그 사이 변경) — 중단`);
      }
      for (const c of a.children) {
        want.add(c.id);
        if (c.already) continue;
        const r = await enrollChild(page, c.id, boardId);
        if (r.status !== 201) throw new ClassBoardStop(`${a.name}: 배정 실패 HTTP ${r.status}`);
        entry.enrolled.push({ name: a.name, childId: c.id, studentId: a.studentId });
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
