// scripts/_classnote/class-board-release-apply.mjs — 반 보드 자동 해제 **실행**(ClassNote 쓰기). 판정은 class-board-release.mjs.
//
// 2026-10-02 실측(테스트 학생 '학원이'·테스트반):
//   · 원아 내보내기 = `POST https://kapi.classnote.com/v1/enrollments/{배정번호}/out`(본문 없음) → 200. 그 반에서만 빠진다(다른 반 배정 그대로).
//     배정번호 = `GET kapi…/v1_2/children/{원아}/enrollments`의 그 반 줄(`belong_to_class`·`removed_child:false`)의 `id`.
//   · 선생님 해제 = `POST https://kapi.classnote.com/v1/employments/{연결번호}/out` → 200. 그 줄은 `is_approved:false`로 남는다.
//   · 글은 원아를 내보내도 남는다.
// 🔴 한 건씩 하고 **바로 확인**한다 — 그 원아의 **다른 배정(1인 보드·다른 반)이 그대로인지**, 그 반에서 내보낸 원아만 빠졌는지,
//    선생님의 다른 반 연결이 그대로인지. 우리가 한 일 때문일 수 있는 어긋남(내보낸 원아가 그대로 · 안 내보낸 것이 사라짐)만 멈춘다 —
//    그 사이 학부모 가입·사람의 배정으로 **늘어난 것**은 정상이라 멈추지 않는다.
// 🔴 한 건의 실패(번호를 못 찾음·응답 실패·통신 오류)는 그 건만 실패로 남기고 다음으로 간다.
// 🔴 마지막 배정은 떼지 않는다(2026-11-03) — 원아의 승인된 배정이 그 줄 하나뿐이면 그 건만 실패로 남긴다(떼면 ClassNote가 그 원아를
//    자동 퇴소시킨다 — 되돌리는 API 없음). 해제 뒤 남은 배정이 0이면 `haltRelease`로 멈춘다.
// 🔴 "다른 배정·다른 연결이 함께 사라졌다"는 `haltRelease` 표식을 달고 던진다 — 동기화가 사람이 볼 때까지 자동 해제를 세운다
//    (math-class-boards-sync.mjs — 안 세우면 다음 회차가 또 한 명을 내보낸다).
import { fetchBoardChildren } from "./classnote-admin-core.mjs";
import { fetchEmployments } from "./math-class-teachers.mjs";
import { ClassBoardStop } from "./math-class-boards-apply.mjs";
import { LAST_ENROLLMENT_REASON } from "./class-board-release.mjs";

const KAPI = "https://kapi.classnote.com";

async function kapi(page, path, method = "GET") {
  return page.evaluate(
    async ([url, m]) => {
      // 통신 오류(fetch 거절)는 상태 0으로 돌려준다 — 그 건만 실패로 남기고 다음으로 간다(예외로 올리면 동기화 전체가 멈춘다).
      try {
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
        const res = await fetch(url, { method: m, credentials: "include", cache: "no-store", headers: { accept: "application/json", ...(m !== "GET" && csrf ? { "X-CSRFToken": csrf } : {}) } });
        const text = await res.text().catch(() => "");
        let json = null;
        try { json = JSON.parse(text); } catch { /* 본문이 JSON이 아니다 */ }
        return { status: res.status, json };
      } catch {
        return { status: 0, json: null };
      }
    },
    [`${KAPI}${path}`, method],
  );
}

const idSet = (list) => new Set((list ?? []).map((m) => Number(m.id)));
/**
 * 원아의 **우리 센터** 살아 있는 배정 줄 — 승인된(`is_approved === true`) · 안 내보낸(`removed_child`) · 안 떠난(`date_left`) 줄만.
 * 🔴 `/v1_2/children/{원아}/enrollments`는 **다른 학원 배정까지** 준다(2026-11-03 실측 — `center_id`·`center_name` 칸 · 413명 중 22명 29줄 ·
 *    `is_approved: null` 2줄은 모두 남의 학원). 우리 배정 1 + 남의 배정 1인 원아를 '배정 2개'로 보면 우리 마지막 배정을 떼어 **우리 센터에서
 *    자동 퇴소**시킨다(리뷰 A1). 그래서 '남는 배정'·'해제 뒤 0'·'다른 배정이 함께 사라짐'·떼는 줄 고르기 전부 이 줄만 센다 —
 *    `center_id` 칸이 없는 줄은 안 센다(모르면 0 — 마지막 배정 가드가 막는다).
 */
//  칸 모양 = 2026-10-02 실측(`child`·`child_id` 둘 다 원아 번호(숫자) · `belong_to_class` · `removed_child` · `is_approved`) + 2026-11-03 `center_id`.
export const liveEnrollments = (rows, childId, centerId) =>
  (rows ?? []).filter(
    (e) =>
      e?.center_id != null && Number(e.center_id) === Number(centerId) && e.is_approved === true && !e.removed_child && !e.date_left &&
      Number(e.child_id ?? e.child) === Number(childId),
  );

/**
 * 원아 해제 실행. `done` = 성공한 해제를 담을 배열(도중에 멈춰도 호출자에게 남는다), `failed` = 그 건만 실패한 것.
 * @param {{ page, centerId:number, releases:Array<{className:string, boardId:number, childId:number, childName:string}>, log?, done?:Array, failed?:Array }} a
 */
export async function releaseChildren({ page, centerId, releases, log = console.log, done = [], failed = [] }) {
  const byBoard = new Map();
  for (const r of releases) byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), r]);
  for (const [boardId, list] of byBoard) {
    const before = idSet(await fetchBoardChildren(page, centerId, boardId));
    const gone = new Set();
    for (const r of list) {
      const fail = (why) => { failed.push({ ...r, why }); log(`  ⚠️ ${r.className}: 원아 해제 실패 ${r.childName} — ${why}`); };
      if (!before.has(r.childId)) { fail("그 사이 반 보드에서 이미 빠졌습니다"); continue; }
      const list2 = await kapi(page, `/v1_2/children/${r.childId}/enrollments`);
      if (list2.status !== 200 || !Array.isArray(list2.json)) { fail(`배정 목록 조회 실패(HTTP ${list2.status})`); continue; }
      const mineBefore = liveEnrollments(list2.json, r.childId, centerId);
      const rows = mineBefore.filter((e) => Number(e.belong_to_class) === Number(boardId));
      if (rows.length !== 1) { fail(`그 반 배정 줄이 ${rows.length}개라 건드리지 않습니다`); continue; }
      // 🔴 마지막 배정 가드(실시간) — 이 줄을 빼면 남는 승인 배정이 0개면 ClassNote가 그 원아를 **자동 퇴소**시킨다(되돌리는 API 없음 ·
      //    2026-11-03 실측). 판정(class-board-release.mjs ④-b)은 명부로 이미 걸렀지만, 그 사이 다른 배정이 빠졌을 수 있어 직전에 한 번 더 본다.
      if (mineBefore.length <= 1) { fail(LAST_ENROLLMENT_REASON); continue; }
      const out = await kapi(page, `/v1/enrollments/${rows[0].id}/out`, "POST");
      await page.waitForTimeout(300);
      // 확인 — 응답과 무관하게 그 원아의 배정을 다시 읽어 **실제 상태**로 가른다(응답은 실패인데 처리된 경우 · 성공인데 다른 배정이 함께 사라진 경우).
      const list3 = await kapi(page, `/v1_2/children/${r.childId}/enrollments`);
      const readable = list3.status === 200 && Array.isArray(list3.json);
      if (!readable) {
        // 내보냈는데 다시 읽지 못했다 — 다른 배정(1인 보드)이 그대로인지 모르는 채로 다음 원아로 가지 않는다.
        if (out.status === 200) {
          done.push(r);
          throw new ClassBoardStop(`${r.className}: ${r.childName} 원아를 내보낸 뒤 배정을 다시 읽지 못했다(HTTP ${list3.status}) — 다른 배정이 그대로인지 확인하지 못해 중단`);
        }
        fail(out.status === 0 ? "ClassNote 통신 오류" : `해제 응답 실패(HTTP ${out.status})`);
        continue;
      }
      const still = new Set(liveEnrollments(list3.json, r.childId, centerId).map((e) => Number(e.id)));
      if (out.status !== 200 && still.has(Number(rows[0].id))) {
        fail(out.status === 0 ? "ClassNote 통신 오류" : `해제 응답 실패(HTTP ${out.status})`);
        continue;
      }
      // 이 원아의 **다른 배정**(1인 보드·다른 반)이 그대로인가. 같이 사라졌으면 멈추고, 사람이 볼 때까지 자동 해제를 세운다(haltRelease).
      const lost = mineBefore.filter((e) => Number(e.id) !== Number(rows[0].id) && !still.has(Number(e.id)));
      done.push(r);
      if (lost.length) {
        const err = new ClassBoardStop(`${r.className}: ${r.childName} 원아를 내보냈는데 다른 배정 ${lost.length}개(${lost.map((e) => e.class_name ?? e.belong_to_class).join(", ")})가 함께 사라졌다 — 중단(사람 확인)`);
        err.haltRelease = true;
        throw err;
      }
      // 🔴 해제 뒤 남은 승인 배정이 0개 — ClassNote가 그 원아를 퇴소시켰을 수 있다(되돌릴 수 없다). 다른 배정이 사라진 것과 같은 급으로 세운다
      //    (위 직전 확인이 있어 여기 오면 안 된다 — 그래도 오면 사람이 볼 때까지 자동 해제를 멈춘다).
      if (!still.size) {
        const err = new ClassBoardStop(`${r.className}: ${r.childName} 원아를 내보낸 뒤 남은 반 배정이 0개입니다 — ClassNote가 퇴소 처리했을 수 있어 중단(사람 확인)`);
        err.haltRelease = true;
        throw err;
      }
      gone.add(r.childId);
      log(`  원아 해제 ${r.className}: ${r.childName}${out.status === 200 ? "" : "(응답은 실패였지만 실제로 해제됨)"}`);
    }
    if (!gone.size) continue;
    // 확인 — 내보낸 원아는 빠졌고, 안 내보낸 원아는 그대로여야 한다. 그 사이 새로 들어온 원아(가입·사람의 배정)는 정상이다.
    const after = idSet(await fetchBoardChildren(page, centerId, boardId));
    const stuck = [...gone].filter((id) => after.has(id));
    const vanished = [...before].filter((id) => !gone.has(id) && !after.has(id));
    if (stuck.length) throw new ClassBoardStop(`${list[0].className}: 원아 해제 뒤 반 원아가 예상과 다르다(내보낸 원아 ${stuck.length}명이 그대로) — 중단`);
    // 안 내보낸 원아가 사라졌다 — 우리 요청이 남을 함께 뺐을 수 있다. 회차만 멈추면 1분 자동 동기화가 곧 이어 가므로 사람이 볼 때까지 세운다(리뷰 A7).
    //   (내보낸 원아가 그대로인 stuck은 '처리가 늦다'일 수 있어 지금처럼 회차만 멈춘다.)
    if (vanished.length) {
      const err = new ClassBoardStop(`${list[0].className}: 원아 해제 뒤 반 원아가 예상과 다르다(내보내지 않은 원아 ${vanished.length}명이 사라짐) — 중단(사람 확인)`);
      err.haltRelease = true;
      throw err;
    }
  }
  return { done, failed };
}

/**
 * 선생님 해제 실행 — 한 건씩 하고, 끝에 **그 선생님의 다른 연결이 그대로인지** 확인한다.
 * @param {{ page, centerId:number, releases:Array<{className:string, boardId:number, employmentId:number, teacherId:number, teacher:string}>, log?, done?:Array, failed?:Array }} a
 */
export async function releaseTeachers({ page, centerId, releases, log = console.log, done = [], failed = [] }) {
  if (!releases.length) return { done, failed };
  // 우리가 건드린 선생님들의 살아 있는 연결만 본다 — 그 사이 사람이 다른 선생님을 정리한 것은 우리 일이 아니다.
  const touched = new Set(releases.map((r) => Number(r.teacherId)));
  const live = (emps) => new Set(emps.filter((e) => e.is_approved === true && touched.has(Number(e.teacher_id))).map((e) => Number(e.id)));
  const before = await fetchEmployments(page, centerId);
  const beforeLive = live(before);
  const gone = new Set();
  for (const r of releases) {
    const fail = (why) => { failed.push({ ...r, why }); log(`  ⚠️ ${r.className}: 담임 해제 실패 ${r.teacher} — ${why}`); };
    const row = before.find((e) => Number(e.id) === r.employmentId);
    if (!row || row.is_approved !== true || Number(row.teacher_id) !== r.teacherId || Number(row.class_in_charge) !== r.boardId) { fail("연결 줄이 계획과 다릅니다"); continue; }
    const out = await kapi(page, `/v1/employments/${r.employmentId}/out`, "POST");
    if (out.status !== 200) { fail(out.status === 0 ? "ClassNote 통신 오류" : `해제 응답 실패(HTTP ${out.status})`); continue; }
    gone.add(r.employmentId);
    done.push(r);
    log(`  담임 해제 ${r.className}: ${r.teacher}`);
    await page.waitForTimeout(300);
  }
  if (!gone.size) return { done, failed };
  const afterLive = live(await fetchEmployments(page, centerId));
  const lost = [...beforeLive].filter((id) => !afterLive.has(id) && !gone.has(id));
  const stuck = [...gone].filter((id) => afterLive.has(id));
  if (lost.length) {
    const err = new ClassBoardStop(`담임 해제 뒤 그 선생님의 다른 연결 ${lost.length}개가 함께 사라졌다 — 중단(사람 확인)`);
    err.haltRelease = true;
    throw err;
  }
  if (stuck.length) throw new ClassBoardStop(`담임 해제를 했는데 연결 ${stuck.length}개가 그대로다 — 중단(사람 확인)`);
  return { done, failed };
}
