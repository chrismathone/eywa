// scripts/_classnote/class-board-release.mjs — **반 보드 자동 해제** 판정(순수 함수 — playwright·postgres import 금지).
//
// 원장 2026-10-02: *"자동 해제라는건 실제 에이와와 클래스노트를 동기화 할 정도로 반이동 같은 경우도 해제하라는 뜻"* ·
//   *"담임이 바뀌면 옛 담임은 해제"* · *"반 삭제는 됐고, 반 이름 변경, 학생 배정 및 해제, 강사 배정 및 해제만 에이와와 통일시켜"* ·
//   *"동기화 할때도 자동 해제되게 해줘야해"*.
// 원장 2026-11-03: *"수강종료(즉, 남은 과목이 1개라도 있거나 일부 반을 종료하는경우)는 즉시즉시"* — 대상을 넓혔다(만드는 곳 =
//   class-board-release-targets.mjs). 판정은 **이 한 벌**이다 — 종류마다 가드를 새로 만들지 않는다:
//   · `class`    = 수학 반 보드(0302a 연결 — 미발송 JJ 반 제외 · 11-04 되돌림)
//   · `english`  = 영어 반 방(s2_0006 연결) — 원아만(선생님 연결은 범위 밖)
//   · `closed`   = 종강한 수학 반 보드(종강 7일 뒤 — 늦은 보고서 발송 기한이 지난 뒤) — 원아 + 선생님
//   · `personal` = 1인 보드 `(수학)이름`·`(영어)이름` — '반' 대신 **그 학생의 그 과목**이 단위다(그 과목에 열린 수강이 없고 끝난 기록이 있을 때)
// 실행은 class-board-release-apply.mjs(원아 `…/enrollments/{번호}/out` · 선생님 `…/employments/{번호}/out`, 2026-10-02 실측). 보드 삭제는 하지 않는다.
//
// 🔴 해제는 "명단 밖"이라는 **없음의 증거**로 움직인다 — 조회가 비거나 계획이 틀리면 지금 다니는 학생을 내보낸다. 그래서
//    "이 반 학생이 아니다"를 **양쪽에서** 확인한 원아만 내보낸다:
//   ① 이 반(1인 보드면 그 과목)에 열린 수강(종료일이 없거나 오늘 이후 — 휴원·시작 전 포함)이 있는 학생, 그리고 이 반(그 과목)에 끝난
//      기록이 있는 **휴원 학생** 누구의 원아일 수 있으면 보류한다(리뷰 A4): 이름이 이어지거나 · 원아 링크(0185a)가 그 학생이거나 ·
//      그 학생의 1인 보드에 있거나 · 보호자 전화(명부의 carer 전화 전부)가 같으면(형제 포함). 1인 보드는 그 과목에 열린 수강이 있는
//      **학생 전체**와 대조한다(리뷰 A5 — 한 사람이 기록 둘로 갈린 경우 #148).
//   ② **누구의 원아인지 아는** 원아만 내보낸다 — 원아 링크 또는 1인 보드 주인으로 aywa 학생이 **한 명으로** 특정돼야 한다.
//      모르거나(둘 다 없음) · 후보가 둘 이상이거나(이름이 같은 두 학생 · 링크와 1인 보드 주인이 다름) · ClassNote 운영관리 명부에
//      그 원아가 없으면(1인 보드·전화 대조를 못 한다) 보류한다(사람 확인).
//   ③ 그 학생의 **이 반 수강이 끝난 기록**이 있어야 한다(종료일이 어제까지) — "명단에 없다"(없음)가 아니라 "끝났다"(있음)가 근거다.
//      이 반을 수강한 적이 없는 학생의 원아(사람이 ClassNote에서 넣은 체험·임시 원아)는 내보내지 않는다. 반의 수강 기록을 못 읽었으면 보류.
//      ③-b 그 학생이 **휴원 중**(학생 상태 on_hold)이면 보류한다(원장 2026-11-03 *"휴원·시작 전 수강은 열린 수강"* — 휴원하면서 수강
//      종료일을 넣는 경우가 있어(2026-11-03 실측: 휴원 9명 중 8명이 열린 수강 0건) 수강만으로는 못 가린다).
//      ③-c 영어 반 방은 주인이 **방 연결이 없는 다른 영어 반**에 다니고 있으면 보류한다(그 반이 같은 방을 쓰는데 한 반에만 연결된 경우 · A6).
//   ④ **최근에 끝난 수강**(종료일이 최근 7일 안 — 1인 보드는 그 과목의 마지막 종료일)만 센다: 한 보드에서 그런 원아가 4명을 넘고
//      (지금 다니는 학생의 원아 수 + 그 원아 수)의 절반도 넘으면 **그 원아들만** 보류한다(원장 2026-11-03 *"실제 반으로 동기화시켜야되는데,
//      실제 반과 일치하지 않으면 이동해야지"* · 분모 = 리뷰 A3 — 보드 전체로 나누면 묵은 잔류가 분모를 키워 오늘 사고를 놓친다).
//      ⚠️ 남는 틈: 종료일을 **지난 날짜로 소급** 입력한 사고는 '최근'으로 안 잡혀 못 막는다 — 해제는 수강을 되살리면 다음 동기화가 다시
//      배정하고(되돌릴 수 있다), 퇴소는 ④-b 마지막 배정 가드가 막는다.
//      ④가 잡으려는 것은 '오늘 누가 반 전체 수강을 잘못 끝낸' 사고다 — 그보다 오래전에 끝난 수강은 이미 굳은 사실이라 막지 않는다
//      (JJ2M처럼 지난 학생 6명이 몇 주째 남은 보드가 영영 보류되지 않게). 종료일을 모르면 최근으로 센다(보수적).
//      종강 반 보드도 같은 규칙 하나로 본다 — 종강 7일 뒤에 정리하므로 그 반 수강은 이미 7일 넘게 끝나 있다(예전엔 종강 보드만 ④ 대신
//      '열린 수강 0건'으로 따로 봤다 · 열린 수강이 남은 학생의 원아는 ①이 하나씩 보류한다).
//   ④-b 🔴 **마지막 배정 가드(퇴소 방지)** — 그 원아의 승인된 소속 배정(운영관리 명부 — [ALL] 전체방·그룹 보드·1인 보드 포함 전부)이
//      이번 회차 해제 뒤 0개가 되면 내보내지 않는다. ClassNote는 원아의 **마지막 반 배정을 빼면 그 원아를 센터에서 자동 '퇴소'**시킨다
//      (2026-11-03 실측: 11-02 해제로 남은 배정이 0이 된 원아 2명이 그날 퇴소 · 다른 배정이나 [ALL]이 남은 69명은 재원 그대로).
//      퇴소는 되돌리는 API가 없고(학부모 재초대뿐) 센터가 그 원아의 옛 글을 못 본다 — 원장 규칙은 "전 과목 퇴원 + 45일 뒤에만 명부 퇴원처리".
//      한 회차에 같은 원아를 여러 보드에서 떼면 합산하고, 다 떼게 되면 **하나를 남긴다**: 가장 최근에 끝난 반(종료일이 늦은 쪽 — 그 원아의
//      최근 글이 있는 곳이라 45일 뒤 퇴원처리까지 학부모가 보는 자리로 맞다) → 같으면 반 보드(1인 보드는 12월에 지운다) → 같으면 계획 순서 뒤.
//      명부의 소속 반을 모르면 보류. 실행부(class-board-release-apply.mjs)도 해제 직전 실시간 배정으로 한 번 더 막고, 해제 뒤 남은 배정 0을
//      보면 자동 해제를 세운다.
//   ⑤ 한 회차 상한 — 1인 보드 10명 · 전체 40명(모든 종류 합계). 넘으면 남은 것은 다음 동기화가 이어서 한다.
//   선생님: ⑥ 우리가 아는 선생님(aywa 직원 ↔ ClassNote 선생님 대응표)만 — 모르는 계정(원장·관리자·시험 계정)은 건드리지 않는다.
//          ⑦ 그 반의 담임이 비어 있거나 재직 중이 아니면 아무도 해제하지 않는다
//          ⑧ 지금 담임·예약된 새 담임·교시 담당(앞으로 시작할 교시 · 이름만 적힌 교시 포함)·위임은 남긴다.
//          ⑨ 남길 사람 중 대응표에 없는 이름이 있으면 그 반은 보류한다(이름이 달라 같은 사람을 못 알아본 것일 수 있다).
//          ⑩ 남길 사람 중 한 명 이상이 그 반 보드에 **이미 연결돼 있을 때만** 푼다(풀고 나서 선생님이 0명인 보드를 만들지 않는다).
//          종강 반 보드는 남길 사람이 없다(⑦⑨⑩ 대신) — **원아가 하나도 안 남았을 때만** 아는 선생님 연결을 전부 푼다
//          (보류된 원아가 남으면 그 학부모의 글을 볼 선생님이 없어진다).
//      🔑 aywa가 기준이다(원장 *"강사 배정 및 해제만 에이와와 통일"*) — 그 반을 함께 보는 선생님은 aywa에 교시 담당·위임으로
//         적어야 남는다. ClassNote 화면에서 손으로만 붙인 연결은 다음 동기화가 푼다.

import { childNameConsistent, reservedBoardName } from "./class-board-plan.mjs";
import { normBoard } from "./board-safety.mjs";
import { carerPhones, phoneMatches } from "./offboard-safety.mjs";

/** 한 반에서 최근에 끝난 원아가 이만큼을 넘고 보드 원아의 절반도 넘으면 그 원아들을 보류(④). */
export const RELEASE_CLASS_SOFT_LIMIT = 4;
/** ④가 세는 '최근에 끝난 수강' — 종료일이 오늘부터 이만큼 안(오늘 − 7일 ≤ 종료일). */
export const RELEASE_RECENT_DAYS = 7;

const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const daysBefore = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
/** 한 회차에 내보내는 원아 상한(모든 종류 합계). */
export const RELEASE_RUN_LIMIT = 40;
/** 그중 1인 보드에서 내보내는 원아 상한(리뷰 A3). */
export const PERSONAL_RELEASE_RUN_LIMIT = 10;
/** 한 회차에 해제하는 선생님 연결 상한. */
export const TEACHER_RELEASE_RUN_LIMIT = 20;

/** ④-b 보류 사유 — 마지막 반 배정(떼면 ClassNote가 그 원아를 자동 퇴소시킨다). 실행부도 같은 문장을 쓴다. */
export const LAST_ENROLLMENT_REASON = "마지막 반이라 떼면 ClassNote에서 퇴소됩니다 — 전 과목 퇴원 45일 뒤 퇴원처리로 정리합니다";
/** ④-b 보류 사유 — 명부의 소속 반을 몰라 마지막 반인지 가릴 수 없다(모르면 안 뗀다). */
export const LAST_ENROLLMENT_UNKNOWN_REASON = "운영관리 명부의 소속 반을 읽지 못해 마지막 반인지 확인할 수 없습니다(떼면 퇴소될 수 있어 해제하지 않습니다)";

/**
 * ④-b 마지막 배정 가드 — 원아마다 이번 회차 해제를 **모두 합친 뒤** 승인된 소속 배정이 1개 이상 남을 때만 통과.
 * 다 떼게 되면 하나를 남긴다(남길 것 = `keepRank` — 가장 최근에 끝난 반 → 반 보드 → 계획 순서 뒤).
 * @param {Array<{childId:number, boardId:number, boardKind?:string, endedOn?:string|null}>} releases  계획 순서
 * @param {Map<number,{boards?:Array<{id:number}>}>} admissions  운영관리 명부(`boards` = 승인된·떠나지 않은 소속 배정 — [ALL] 포함)
 * @returns {{ pass: object[], held: Array<{release:object, why:string}> }}  pass는 계획 순서 그대로
 */
export function guardLastEnrollment(releases, admissions) {
  const list = releases ?? [];
  const byChild = new Map();
  list.forEach((r, i) => byChild.set(Number(r.childId), [...(byChild.get(Number(r.childId)) ?? []), i]));
  const why = new Map(); // 보류할 해제(순번) → 사유
  for (const [childId, idx] of byChild) {
    const boards = admissions?.get?.(childId)?.boards;
    if (!Array.isArray(boards)) { for (const i of idx) why.set(i, LAST_ENROLLMENT_UNKNOWN_REASON); continue; }
    const live = new Set(boards.map((b) => Number(b.id)).filter((id) => Number.isFinite(id)));
    const out = new Set(idx.map((i) => Number(list[i].boardId)).filter((id) => live.has(id)));
    if ([...live].some((id) => !out.has(id))) continue; // 떼지 않는 배정이 남는다
    // 명부에 승인 배정이 하나도 없는데 보드에서는 보인다 — 명부와 어긋난다(모르면 안 뗀다).
    if (!out.size) { for (const i of idx) why.set(i, LAST_ENROLLMENT_UNKNOWN_REASON); continue; }
    const keep = idx.filter((i) => live.has(Number(list[i].boardId))).sort((a, b) => compareKeep(list[a], a, list[b], b))[0];
    why.set(keep, LAST_ENROLLMENT_REASON);
  }
  const pass = [];
  const held = [];
  list.forEach((r, i) => (why.has(i) ? held.push({ release: r, why: why.get(i) }) : pass.push(r)));
  return { pass, held };
}
/** 남길 것 고르기(앞이 남는다) — 가장 최근에 끝난 반(종료일을 모르면 가장 늦은 것으로) → 반 보드 → 계획 순서 뒤. */
function compareKeep(a, ai, b, bi) {
  const ea = a.endedOn ?? "9999-12-31";
  const eb = b.endedOn ?? "9999-12-31";
  if (ea !== eb) return ea > eb ? -1 : 1; // 최근에 끝난 반이 먼저
  const pa = a.boardKind === "personal" ? 1 : 0;
  const pb = b.boardKind === "personal" ? 1 : 0;
  if (pa !== pb) return pa - pb; // 반 보드가 1인 보드보다 먼저
  return bi - ai; // 계획 순서 뒤가 먼저
}

/** 해제 대상 보드의 종류 → 보고서·감사로그에 붙는 이름(원장 2026-11-03 — 어느 보드에서 뺐는지 알 수 있게). */
export const BOARD_KIND_LABEL = { class: "반 보드", english: "영어 반 방", closed: "종강 반 보드", personal: "1인 보드" };

/** 1인 보드 이름(`(과목)이름`)이 가리키는 학생 이름(공백 제거). 1인 보드 모양이 아니면 null. */
export function personalOwnerName(boardName) {
  const m = normBoard(boardName).match(/^\([^)]*\)(.+)$/);
  return m ? m[1] : null;
}

/** 종류별 문구 — 1인 보드는 '반' 대신 '그 과목'이 단위다. */
function wordsOf(p) {
  const kind = BOARD_KIND_LABEL[p.kind] ? p.kind : "class";
  if (kind === "personal") {
    const subj = p.subjectLabel ?? "그 과목";
    return {
      kind,
      keeper: `${subj} 수강생`,
      recMissing: "에이와 수강 기록을 읽지 못해 확인할 수 없습니다",
      noRecord: (o) => `'${o}' 학생은 ${subj} 수강 기록이 없습니다(누가 넣었는지 확인 필요)`,
      reason: (o) => `${o} 학생의 ${subj} 수강이 모두 끝났습니다`,
    };
  }
  return {
    kind,
    keeper: "이 반 학생",
    recMissing: "에이와 반 수강 기록을 읽지 못해 확인할 수 없습니다",
    noRecord: (o) => `'${o}' 학생은 이 반 수강 기록이 없습니다(누가 넣었는지 확인 필요)`,
    reason: (o) =>
      kind === "closed"
        ? `${o} 학생의 이 반이 종강(${p.closedAt ?? "?"})한 지 7일이 지났습니다`
        : `${o} 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)`,
  };
}

/** 유효이름(공백 제거) → 학생 id들 — 1인 보드 주인을 학생으로 되짚는다. */
function studentsByName(students) {
  const byName = new Map();
  for (const s of students.values()) {
    const k = normBoard(s.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), s.id]);
  }
  return byName;
}

/** 보드 단위 확인 — 이 보드에서 원아를 한 명이라도 판정할 수 있나. 못 하면 `why`(그 보드 원아 전원 보류). */
function boardEnv(p, w, { enrollmentsByClass, students }) {
  if (w.kind === "personal") {
    // 1인 보드 대상인데 1인 보드 모양이 아니다 — 만든 쪽이 틀렸다(마지막 방어).
    if (!/^\((수학|영어)\)/.test(normBoard(p.board.name ?? "")) || !personalOwnerName(p.board.name)) return { why: "1인 보드 이름 모양이 아니라 손대지 않습니다" };
  } else if (reservedBoardName(p.board.name ?? p.className) || reservedBoardName(p.className)) {
    // 반 보드만 — 1인 보드·전체방 모양의 이름이 붙은 보드에서는 아무도 내보내지 않는다(연결표가 틀렸을 때의 마지막 방어).
    return { why: "반 보드 이름이 1인 보드·전체방 모양이라 손대지 않습니다" };
  }
  const rec = enrollmentsByClass.get(p.classId);
  if (!rec) return { why: w.recMissing }; // 수강 기록을 읽지 못했다 — 아무도 내보내지 않는다.
  const openIds = rec.open ?? [];
  const opens = openIds.map((id) => students.get(id)).filter(Boolean);
  if (opens.length !== openIds.length) return { why: "반 명단의 학생 정보를 다 읽지 못했습니다" };
  // ① 대조 상대에 **그 반(1인 보드는 그 과목)에 끝난 기록이 있는 휴원 학생**도 넣는다(리뷰 A4 — 원아 연결이 형제에게 잘못 붙은 경우
  //   휴원생의 원아가 '명단 밖'으로 빠진다). 1인 보드는 만드는 쪽이 그 과목의 휴원 학생을 `onHold`로 넘긴다.
  const onHoldIds = (rec.onHold ?? (rec.ended ?? []).filter((id) => students.get(id)?.status === "on_hold")).filter((id) => !openIds.includes(id));
  const keeperIds = [...openIds, ...onHoldIds.filter((id) => students.has(id))];
  const keepers = keeperIds.map((id) => students.get(id));
  // endedOn = 학생 → 이 반(그 과목) 수강이 마지막으로 끝난 날 — ④(최근에 끝난 수강만 센다)와 ④-b(남길 보드 고르기)가 쓴다.
  return {
    keepers, keeperSet: new Set(keeperIds), openSet: new Set(openIds), keeperNames: new Set(keepers.map((k) => normBoard(k.name))),
    ended: new Set(rec.ended ?? []), endedOn: rec.endedOn ?? {},
  };
}

/** 원아 한 명 판정(①②③) — `{ release }` 또는 `{ why }`(보류 사유). */
function judgeChild(p, ch, w, env, { students, admissions, childLinks }, byName) {
  const adm = admissions.get(Number(ch.id)) ?? null;
  // 명부에 없는 원아 — 1인 보드·보호자 전화를 대조할 수 없다. 원아 링크 하나만 믿고 내보내지 않는다(배정 쪽 가드와 같은 규칙).
  if (!adm) return { why: "ClassNote 운영관리 명부에 없어 누구의 원아인지 대조할 수 없습니다" };
  const linked = childLinks.get(Number(ch.id)) ?? null;
  const ownerNames = [...new Set((adm.boardNames ?? []).map(personalOwnerName).filter(Boolean))];
  // ① 이 반(그 과목) 학생의 원아일 수 있다 — 하나라도 걸리면 보류. 대조 상대 = 열린 수강 학생 + 끝난 기록이 있는 휴원 학생(A4).
  //   휴원 학생에 걸리면 사유는 '휴원 중'으로(③-b와 같은 말 — 무엇 때문에 안 뗐는지 한눈에).
  const onHold = (k) => k && !env.openSet.has(k.id);
  const heldWhy = (k, why) => `'${k.name}' 학생은 휴원 중입니다(휴원 학생의 원아일 수 있어 자동 해제하지 않습니다 — ${why})`;
  const twin = env.keepers.find((k) => childNameConsistent(k.name, ch.name));
  if (twin) return { why: onHold(twin) ? heldWhy(twin, "이름이 이어짐") : `${w.keeper} '${twin.name}'의 원아일 수 있습니다(이름이 이어짐)` };
  if (linked && env.keeperSet.has(linked)) {
    const k = students.get(linked);
    return { why: onHold(k) ? heldWhy(k, "원아 연결") : `${w.keeper} '${k?.name ?? "?"}'에 연결된 원아입니다` };
  }
  const boardOwner = ownerNames.find((n) => env.keeperNames.has(n));
  if (boardOwner) return { why: `${w.keeper} '${boardOwner}'의 1인 보드에 있는 원아입니다` };
  const phones = carerPhones(adm);
  const phoneTwin = phones.length ? env.keepers.find((k) => phoneMatches(k.phones ?? [], phones) === true) : null;
  if (phoneTwin) return { why: onHold(phoneTwin) ? heldWhy(phoneTwin, "보호자 전화가 같음") : `${w.keeper} '${phoneTwin.name}'와 보호자 전화가 같습니다(형제일 수 있어 확인 필요)` };
  // ② 누구의 원아인지 알아야 내보낸다.
  // 1인 보드 이름은 같은 이름의 학생을 전부 가리킨다(퇴원한 동명 학생 포함). 원아 링크가 그 후보 안에 있으면 링크가 그중 누구인지를 정한다.
  const named = ownerNames.map((n) => byName.get(n) ?? []);
  const owners = new Set(linked ? [linked] : []);
  if (!(linked && named.every((ids) => ids.includes(linked)))) for (const ids of named) for (const id of ids) owners.add(id);
  if (!owners.size) return { why: "누구의 원아인지 확인하지 못했습니다(원아 연결·1인 보드 없음)" };
  // 후보가 둘 이상 — 이름이 같은 두 학생이거나, 원아 링크와 1인 보드 주인이 서로 다른 학생을 가리킨다. 어느 쪽인지 사람이 본다.
  if (owners.size > 1) return { why: `누구의 원아인지 하나로 정하지 못했습니다(후보 ${owners.size}명 — 이름이 같은 학생이거나 원아 연결이 1인 보드와 다름)` };
  const owner = [...owners][0];
  const ownerName = students.get(owner)?.name ?? "?";
  // ③-b 휴원 중인 학생은 내보내지 않는다(수강 종료일이 들어가 있어도).
  if (students.get(owner)?.status === "on_hold") return { why: `'${ownerName}' 학생은 휴원 중입니다(휴원 학생의 원아는 자동 해제하지 않습니다)` };
  // ③-c 영어 반 방 — 주인이 **방 연결이 없는 다른 영어 반**에 다니고 있으면 둔다(그 반이 실제로 이 방을 같이 쓰는데 한 반에만 연결된 경우 ·
  //   리뷰 A6). 만드는 쪽(buildEnglishPlans)이 `elsewhere`(학생 → 연결 없는 열린 영어 반 이름들)를 싣는다.
  const elsewhere = p.elsewhere?.get?.(owner);
  if (elsewhere?.length) return { why: `'${ownerName}' 학생이 반 방 연결이 없는 다른 영어 반(${elsewhere.slice(0, 2).join(", ")})에 다니고 있습니다 — 같은 방을 쓰는 반일 수 있어 자동 해제하지 않습니다` };
  // ③ 그 학생의 이 반(그 과목) 수강이 끝난 기록이 있어야 한다(수강한 적 없는 학생의 원아는 사람이 넣은 것일 수 있다).
  if (!env.ended.has(owner)) return { why: w.noRecord(ownerName) };
  return {
    release: {
      classId: p.classId, className: p.className, boardId: Number(p.board.id), boardKind: w.kind, childId: Number(ch.id), childName: ch.name,
      studentId: owner, studentName: ownerName, reason: w.reason(ownerName), endedOn: env.endedOn[owner] ?? null,
    },
  };
}

/**
 * 원아 해제 계획.
 * @param {Array<{classId:string, className:string, kind?:"class"|"english"|"closed"|"personal", subjectLabel?:string, closedAt?:string,
 *   board:{action:string,id?:number,name?:string}, extraChildren?:Array<{id:number,name:string}>}>} plans
 *   최신 계획(보드 원아를 방금 읽은 것) — 종류가 섞여도 된다(⑤ 상한은 합계). `kind` 없음 = 수학 반 보드.
 * @param {object} ctx
 * @param {Map<string, {open:string[], ended:string[], endedOn?:Record<string,string>}>} ctx.enrollmentsByClass  반(1인 보드면 그 계획의 classId) →
 *   open = **열린 수강**이 있는 학생 id(휴원·시작 전 포함) · ended = 수강이 끝난 기록이 있는 학생 id · endedOn = 학생 → 마지막으로 끝난 날
 *   (④·④-b — 없으면 '모름' = 최근으로 센다). 없으면(조회 누락) 보류.
 * @param {string} [ctx.today]  'YYYY-MM-DD'(KST) — ④의 '최근 7일' 기준(기본 = 오늘)
 * @param {Map<string,{id:string,name:string,phones?:string[],status?:string}>} ctx.students  전 학생(유효이름·전화·상태)
 * @param {Map<number, Array<{id:number}>>} ctx.membersByBoard
 * @param {Map<number,{phone:string|null, phones?:Array<string|null>, boardNames:string[]}>} ctx.admissions  운영관리 명부(원아 → 보호자 전화(phone = carer1 · phones = carer1~N)·소속 보드 이름)
 * @param {Map<number,string>} ctx.childLinks  원아 id → 학생 id(0185a)
 * @param {number} [ctx.runLimit]
 * @returns {{ releases: Array<{classId:string, className:string, boardId:number, boardKind:string, childId:number, childName:string, studentId:string|null, studentName:string, reason:string}>,
 *            held: Array<{className:string, childName:string, why:string, text:string}> }}  why = 보류 사유만(해제 리스트 라벨용)
 */
export function planChildReleases(plans, ctx) {
  const { membersByBoard, runLimit = RELEASE_RUN_LIMIT, personalRunLimit = PERSONAL_RELEASE_RUN_LIMIT, today = kstToday() } = ctx;
  const recentFrom = daysBefore(today, RELEASE_RECENT_DAYS);
  const byName = studentsByName(ctx.students);
  const releases = [];
  const held = [];
  const hold = (p, ch, why) => held.push({ className: p.className, childName: ch.name, why, text: `원아 해제 보류: ${ch.name} — ${why}` });

  for (const p of plans ?? []) {
    if (p.board?.action !== "exists" || p.board.id == null) continue;
    const extras = p.extraChildren ?? [];
    if (!extras.length) continue;
    const w = wordsOf(p);
    const env = boardEnv(p, w, ctx);
    if (env.why) {
      for (const ch of extras) hold(p, ch, env.why);
      continue;
    }
    const mine = [];
    for (const ch of extras) {
      const j = judgeChild(p, ch, w, env, ctx, byName);
      if (j.why) hold(p, ch, j.why);
      else mine.push(j.release);
    }
    // ④ 최근에 끝난 수강이 한꺼번에 많다 — 오늘 누가 반 전체 수강을 잘못 끝냈을 수 있다. 그 원아들만 보류하고, 오래전에 끝난 것은 그대로 낸다.
    //   분모 = **지금 다니는 학생의 원아 수**(보드 원아 − 명단 밖 원아) + 최근 해제 대상 수 — 보드 전체로 나누면 묵은 잔류가 분모를 키워
    //   오늘 사고를 놓친다(리뷰 A3 — 보드 30 = 묵은 10 + 오늘 12 + 다니는 8이면 12/30은 통과, 12/20은 보류).
    const boardSize = (membersByBoard.get(Number(p.board.id)) ?? []).length;
    const recent = mine.filter((m) => !m.endedOn || m.endedOn >= recentFrom);
    const base = Math.max(0, boardSize - extras.length) + recent.length;
    if (recent.length > RELEASE_CLASS_SOFT_LIMIT && recent.length * 2 > base) {
      const unit = { class: ["반", "반 보드"], english: ["반 방", "반 방"], closed: ["반", "반 보드"], personal: ["1인 보드", "1인 보드"] }[w.kind];
      for (const m of recent)
        hold(p, { name: m.childName }, `이 ${unit[0]}에서 최근 ${RELEASE_RECENT_DAYS}일 안에 수강이 끝난 원아가 ${recent.length}명으로 ${unit[1]}의 지금 다니는 원아와 합친 수(${base}명)의 절반을 넘습니다(ClassNote에서 직접 확인)`);
      releases.push(...mine.filter((m) => !recent.includes(m)));
      continue;
    }
    releases.push(...mine);
  }
  // ④-b 마지막 배정 가드(퇴소 방지) — 모든 종류를 합쳐서(같은 원아를 여러 보드에서 떼면 마지막 하나는 남긴다). ⑤보다 먼저 —
  //   ⑤가 뒤에서 덜어 내면 실제로 떼는 것은 더 줄 뿐이라 남는 배정은 늘기만 한다.
  const last = guardLastEnrollment(releases, ctx.admissions);
  releases.splice(0, releases.length, ...last.pass);
  // 학생을 함께 싣는다 — 보고서·드라이런이 '전 과목 퇴원생'(45일 뒤 퇴원처리로 정리)과 재원생을 가르게.
  for (const { release: r, why } of last.held)
    held.push({ className: r.className, childName: r.childName, why, text: `원아 해제 보류: ${r.childName} — ${why}`, studentId: r.studentId ?? null, studentName: r.studentName ?? null });
  // ⑤ 회차 상한 — 1인 보드는 따로 10명(리뷰 A3 — 1인 보드는 한 보드에 한 집이라 ④가 거의 안 걸린다 · 잘못 넣은 종료일이 한꺼번에 몰려도
  //   하루 피해를 10명으로 묶는다), 그다음 전체 40명.
  let personalCount = 0;
  for (let i = 0; i < releases.length; ) {
    if (releases[i].boardKind === "personal" && ++personalCount > personalRunLimit) {
      const [r] = releases.splice(i, 1);
      const why = `1인 보드는 한 번에 ${personalRunLimit}명까지만 해제해 다음 동기화에서 합니다`;
      held.push({ className: r.className, childName: r.childName, why, text: `원아 해제 미룸: ${r.childName} — ${why}` });
    } else i++;
  }
  if (releases.length > runLimit) {
    for (const r of releases.splice(runLimit)) {
      const why = "한 번에 해제하는 수를 넘어 다음 동기화에서 합니다";
      held.push({ className: r.className, childName: r.childName, why, text: `원아 해제 미룸: ${r.childName} — ${why}` });
    }
  }
  return { releases, held };
}

/**
 * 같은 이름 보드를 처음 연결할 때(JJ 자리 반, class-board-plan.mjs) — 보드의 '이 반 학생이 아닌 원아' 중 **이 반의 지난 학생으로
 * 증명되는 원아**(①②③을 통과 — 그대로 해제 대상)만 고른다. ④⑤(양·회차 상한)는 채택과 무관해 보지 않는다.
 * @param {Array<{classId:string, className:string, boardId:number, boardName:string, strangers:Array<{id:number,name:string}>}>} cands
 * @returns {Map<string, Set<number>>} 반 → 지난 학생 원아 id
 */
export function formerFamilyOf(cands, ctx) {
  const byName = studentsByName(ctx.students);
  const out = new Map();
  for (const c of cands ?? []) {
    const p = { classId: c.classId, className: c.className, kind: "class", board: { action: "exists", id: c.boardId, name: c.boardName } };
    const w = wordsOf(p);
    const env = boardEnv(p, w, ctx);
    const ok = new Set();
    if (!env.why) for (const ch of c.strangers ?? []) if (judgeChild(p, ch, w, env, ctx, byName).release) ok.add(Number(ch.id));
    out.set(c.classId, ok);
  }
  return out;
}

/**
 * 선생님 해제 계획 — 반 보드에 연결돼 있지만 **지금 그 반 담당이 아닌** 선생님.
 * @param {{ boards: Array<{className:string, boardId:number, boardName?:string, homeroom?:string|null, homeroomActive?:boolean, keepNames?:string[],
 *     closed?:boolean, remainingChildren?:number}>,
 *   emps: Array<{id:number, teacher_id:number, class_in_charge:number, is_approved?:boolean}>,
 *   teacherMap: Record<string, number>, runLimit?: number }} a
 *   boards = 이번 동기화가 본 반 보드(확인된 것) · keepNames = 남길 사람(담임·교시 담당·위임)의 aywa 표시 이름 ·
 *   closed = 종강 반 보드(남길 사람 없음 — remainingChildren = 원아 해제 뒤 그 보드에 남은 원아 수)
 * @returns {{ releases: Array<{className:string, boardId:number, employmentId:number, teacherId:number, teacher:string}>, held: Array<{className:string, text:string}> }}
 */
export function planTeacherReleases({ boards, emps, teacherMap, runLimit = TEACHER_RELEASE_RUN_LIMIT }) {
  const nameOf = new Map(Object.entries(teacherMap).map(([name, id]) => [Number(id), name]));
  const releases = [];
  const held = [];
  const push = (b, list) => { for (const e of list) releases.push({ className: b.className, boardId: Number(b.boardId), employmentId: Number(e.id), teacherId: Number(e.teacher_id), teacher: nameOf.get(Number(e.teacher_id)) }); };
  for (const b of boards ?? []) {
    if (b.boardId == null) continue;
    // ⑥ 아는 선생님의 살아 있는 연결만 본다(해제된 연결은 is_approved:false로 남는다).
    const linked = (emps ?? []).filter((e) => Number(e.class_in_charge) === Number(b.boardId) && e.is_approved === true && nameOf.has(Number(e.teacher_id)));
    if (!linked.length) continue;
    if (b.closed) {
      const names = linked.map((e) => nameOf.get(Number(e.teacher_id))).join(", ");
      if (reservedBoardName(b.boardName ?? b.className)) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 보드 이름이 1인 보드·전체방 모양이라 손대지 않습니다` }); continue; }
      // 원아가 남았다(보류·실패) — 그 학부모의 글을 볼 선생님이 없어지지 않게 둔다. 모르면(숫자가 아님) 남은 것으로 본다.
      const left = Number.isFinite(b.remainingChildren) ? b.remainingChildren : 1;
      if (left > 0) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 종강 반 보드에 원아가 남아 있어 선생님 연결은 그대로 둡니다(원아가 정리된 뒤 해제)` }); continue; }
      push(b, linked);
      continue;
    }
    const keep = new Set((b.keepNames ?? []).map((n) => teacherMap[n]).filter((id) => id != null).map(Number));
    const stale = linked.filter((e) => !keep.has(Number(e.teacher_id)));
    if (!stale.length) continue;
    const names = stale.map((e) => nameOf.get(Number(e.teacher_id))).join(", ");
    if (reservedBoardName(b.boardName ?? b.className)) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 반 보드 이름이 1인 보드·전체방 모양이라 손대지 않습니다` }); continue; }
    // ⑦ 담임이 비어 있거나 재직 중이 아닌 반 — 누가 맡는지 정해지지 않은 상태에서 선생님을 빼지 않는다.
    if (!b.homeroom) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 에이와에 이 반 담임이 없습니다` }); continue; }
    if (b.homeroomActive === false) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 이 반 담임 '${b.homeroom}'이(가) 재직 중이 아닙니다(새 담임을 정한 뒤 정리됩니다)` }); continue; }
    // ⑨ 남길 사람 중 대응표에 없는 이름 — 같은 사람을 다른 이름으로 적은 것일 수 있다.
    const unknown = (b.keepNames ?? []).filter((n) => teacherMap[n] == null);
    if (unknown.length) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 이 반 담당 '${unknown.join(", ")}'의 ClassNote 계정을 몰라 확인할 수 없습니다` }); continue; }
    // ⑩ 남길 사람이 이 보드에 한 명도 연결돼 있지 않다 — 풀면 선생님이 0명인 보드가 된다.
    if (!linked.some((e) => keep.has(Number(e.teacher_id)))) { held.push({ className: b.className, text: `담임 해제 보류(${names}) — 지금 담당이 아직 이 반 보드에 연결되지 않았습니다` }); continue; }
    push(b, stale);
  }
  if (releases.length > runLimit) {
    for (const r of releases.splice(runLimit)) held.push({ className: r.className, text: `담임 해제 미룸(${r.teacher}) — 한 번에 해제하는 수를 넘어 다음 동기화에서 합니다` });
  }
  return { releases, held };
}

/** 계획에서 해제한 원아를 뺀다(그 뒤의 기록·해제 리스트·보고서가 지금 상태를 말하게). 계획 배열을 제자리에서 고친다. */
export function dropReleasedExtras(plans, released) {
  const gone = new Map();
  for (const r of released ?? []) gone.set(Number(r.boardId), (gone.get(Number(r.boardId)) ?? new Set()).add(Number(r.childId)));
  for (const p of plans ?? []) {
    if (p.board?.action !== "exists" || p.board.id == null) continue;
    const ids = gone.get(Number(p.board.id));
    if (!ids?.size) continue;
    p.extraChildren = (p.extraChildren ?? []).filter((c) => !ids.has(Number(c.id)));
    p.extras = p.extraChildren.map((c) => c.name);
  }
}
