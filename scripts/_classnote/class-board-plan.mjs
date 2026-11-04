// scripts/_classnote/class-board-plan.mjs — 수학 **반 보드** 생성·배정 계획(순수 함수, 의존성 = 순수 모듈만).
//
// 원장 2026-09-29: 수학 발송을 `(수학)학생명` 1인 보드에서 **aywa 반과 이름까지 똑같은 반 보드**로 옮긴다.
// 반을 2~3개 다니면 **모든 반에 따로** 배정한다. (그때는 1인 보드를 해제하지 않았다 — 2026-11-02 원장이 1인 보드 원아 배정을
// 해제했고 12월에 보드를 지운다. 원아 신분은 아래 ①의 확인 기록 + 원아 연결로 대신한다.)
//
// 🔴 이 계획의 유일한 위험은 **같은 반의 동명이인**이다(원장: 과거 실제로 겹친 적이 있다 — "삼중사중 가드도
//    아까울 정도로"). 반 보드 안에서 이름으로 원아를 고르는 순간 김근우·김근우A가 섞인다. 그래서:
//   ① 원아 출처(반 보드 안에서 이름 검색 금지) — 앞에서부터 하나만 쓴다:
//      a. 그 학생의 1인 보드 `(수학)유효이름`에 **이미 배정된 원아**(source "personal" — 남은 1인 보드).
//      b. 1인 보드가 없거나 비면 반 보드 기록(0302a)에서 이미 '정상'으로 확인된 원아 중 **기록된 그 반 보드에 지금도 있는 원아**
//         (`verifiedChildren`, source "verified"). 기록은 있는데 그 보드에 지금 없으면 '확인 필요' 보류 — ⚠️ **그 회차만**이다: 보류 줄엔
//         원아 번호가 없어 다음 회차엔 '기록이 아예 없는 학생'이 되고 c(원아 연결)로 같은 원아를 다시 붙인다(1인 보드 시절에도 05시 준비가
//         다시 채웠다). 사람이 뗀 원아를 영구히 막으려면 원아 연결도 고친다 — 보류 줄에 원아 번호를 남기는 수리는 후속 과제(2026-11-02 리뷰).
//      c. 확인 기록이 **아예 없는** 학생만 — 원아 연결(0185a `classnote_child_links`, 운영관리 명부의 이름·생년·보호자 전화로
//         만든 원아 → 학생 연결)의 원아(`childLinks`, source "link", 원장 2026-11-02 A안). 신입의 첫 배정과 확인 기록이 보류로
//         지워진 학생(휴원·반 사이 공백)이 이 길로 신분을 되찾는다. 반 보드에 아직 없어도 된다.
//         🔴 연결은 보호자 전화가 같은 **형제**에게 잘못 붙을 수 있다(2026-11-02 실측 3건) — 그래서 ②③⑥을 반드시 다시 걸고, ⑥은 명부 이름과
//         학부모 프로필 이름 **둘 다**(프로필은 읽은 보드 또는 원아 상세 GET — 모르면 보류) · 명부에 없는 옛 계정 원아는 뺀다.
//         ⚠️ 연결로 처음 넣은 원아는 그 회차에 0302a ok로 적혀 다음부터는 b(확인 기록 — 보드의 프로필 이름 하나)로 판정된다.
//      셋 다 없으면 '가입 대기'(`JOIN_WAIT_REASON`). 아래 ②~⑥은 어느 출처의 원아에도 똑같이 건다. ④는 기록에서 다른 학생에게
//      확인된 원아인지도 본다.
//   ② 보호자 전화 일치 필수 — ClassNote 운영관리 carer1_phone ∈ aywa 전화 4칸. 모르면 보류.
//   ③ 생년 일치 필수 — 학년에서 역산 ±1년. 모르면 보류.
//   ④ 역방향 유일성 — 그 원아가 **다른 학생의** 1인 보드에 있거나 계획상 두 학생에게 잡히면 둘 다 보류.
//   ⑤ 같은 반에 기본이름(끝 알파벳 뗀 이름)이 겹치는 학생 = 둘 다 보류(원장 확인 전 자동 배정 금지).
//   ⑥ 원아 이름이 학생 이름과 이어져야 한다(`서연` ⊂ `박서연E`는 통과) — 쌍둥이·형제는 전화가 같고 생년도
//      같거나 가까워 ②③을 통과하므로, 형제 원아가 잘못 붙어 있으면 이름만이 마지막 단서다.
// 가드는 **전부 AND**이고 하나라도 모르면 보류한다(fail-closed). 사람 확인으로만 푼다.
//
// ⚠️ 순수 유지 — playwright·postgres import 금지(Vitest가 끌어오면 안 된다). 테스트 = class-board-plan.test.mjs.

import { expectedBirthYear, normBoard } from "./board-safety.mjs";
import { phoneMatches } from "./offboard-safety.mjs";
import { childIdentityKeys } from "./identity-keys.mjs";

/** 생년 대조 허용 오차 — board-safety.mjs BIRTH_YEAR_TOLERANCE와 같은 값(그쪽은 export하지 않는다). */
export const BIRTH_TOLERANCE = 1;
/** 한 학생에 붙을 수 있는 원아 수 상한 — 학부모·학생 각자 가입(2계정)까지만. 그 이상은 사람이 본다. */
export const MAX_CHILDREN_PER_STUDENT = 2;

/** 1인 보드 이름 — 발송 워커 boardClassName("math", 이름)과 같은 모양. */
export const personalBoardName = (effName) => `(수학)${effName}`;

/**
 * 보류 사유 — **원아를 찾을 출처가 하나도 없다**(1인 보드 원아·반 보드 확인 기록·원아 연결 모두 없음 = 학부모 가입 대기,
 * 또는 가입했지만 원아 연결이 아직 안 만들어졌다 — 연결은 하루 한 번 만든다).
 * 🔴 글자 그대로 — 'ClassNote 미가입'으로 시작해야 한다: 앱(`src/features/onescreen/send-class.ts` `JOIN_HOLD_REASON`)과
 *    지금 동기화(`sync-request-plan.mjs` `JOIN_WAIT`)가 이 머리로 '가입 대기'를 가린다(옛 앱도 그대로 알아본다 — 배포 순서 무관).
 *    옛 문장 둘('1인 보드 없음' · 'ClassNote 미가입·미배정(1인 보드 원아 0명)')은 더 쓰지 않지만, 다시 쓰이기 전의 기록에
 *    남아 있어 두 곳 모두 계속 알아본다. 잠금 = board-missing.test.ts · sync-request-plan.test.mjs.
 */
export const JOIN_WAIT_REASON = "ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음";

/** 보류 사유 — 반 보드 기록은 있는데 기록된 반 보드에 그 원아가 지금 없다(사람이 뗐다 · 이 회차만 멈춘다 — 다음 회차엔 원아 연결로 다시 판정, 머리 주석 ① b). */
export const VERIFIED_GONE_REASON = "반 보드에서 확인된 원아가 지금 그 반 보드에 없음 — 확인 필요";

/**
 * 보류 사유 — 보고서 미발송 반(JJ 자리 반, `classes.report_optout`)은 **오늘 다니는 학생이 없으면** ClassNote 반 보드를 새로 만들지 않는다
 * (원장 2026-11-03 *"반에 학생이 있다면 배정해야함. 없으면 굳이 만들필요 없음."* — 학생이 1명 이상이면 수학 반처럼 만들고 배정한다).
 * 같은 이름 보드가 ClassNote에 있으면 학생이 없어도 그 보드를 연결한다.
 * 🔑 2026-11-04 되돌림(원장 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"*) 뒤 운영 경로(`targetClassWhere`)는 미발송 반을 넘기지 않아
 *    이 분기는 쓰이지 않는다 — 다시 넣는 날을 위해 남긴다.
 */
export const OPTOUT_NO_CREATE_REASON = "보고서 미발송 반에 지금 다니는 학생이 없어 ClassNote 반 보드를 만들지 않습니다 — 학생이 생기면 다음 동기화가 만듭니다";

/** 기본이름 — 동명이인 접미사(끝 알파벳)를 뗀 이름. `김근우A`→`김근우`, `박서준C`→`박서준`. */
export function baseName(effName) {
  return String(effName ?? "").replace(/\s/g, "").replace(/[A-Za-z]+$/, "");
}

/**
 * ⑥ 원아 이름(학부모가 등록)이 학생 이름과 이어지는가 — 한쪽이 다른 쪽을 포함하면 통과(2글자 이상).
 * `서연`↔`박서연E` · `Jay(이재희)`↔`이재희` 통과, `김민서`↔`김민준`(쌍둥이 형제) 불통과.
 */
export function childNameConsistent(studentName, childName) {
  const x = baseName(studentName);
  if (x.length < 2) return false;
  for (const k of childIdentityKeys(childName)) {
    if (k.length >= 2 && (x.includes(k) || k.includes(x))) return true;
  }
  return false;
}

/** 1인 보드 이름이 가리키는 학생 기본이름(`(수학)`로 시작하지 않으면 null). */
function personalBoardOwner(boardName) {
  const m = normBoard(boardName).match(/^\(수학\)(.+)$/);
  return m ? m[1] : null;
}

/**
 * 확인 기록 역색인 — 원아 id → 그 원아가 '정상'으로 기록된 학생 id들(④ 역방향 가드용).
 * `keep(sid)` = 비교 상대로 셀 학생 — 지금 대상 반에 다니는 학생만(종강했지만 연결을 지키는 반·병합된 학생의 옛 기록은 다시 쓰이지 않아
 * 그대로 두면 물려받은 원아가 영구히 보류된다).
 */
export function verifiedOwnersOf(verifiedChildren, keep = () => true) {
  const out = new Map();
  for (const [sid, list] of verifiedChildren ?? []) {
    if (!keep(sid)) continue;
    for (const v of list ?? []) out.set(Number(v.id), new Set([...(out.get(Number(v.id)) ?? []), sid]));
  }
  return out;
}

/**
 * 1인 보드 대신 쓸 원아 — 반 보드 기록(0302a)에서 이 학생에게 '정상'으로 확인된 원아 중 **기록된 그 반 보드에 지금도 있는 원아만**.
 * 🔴 지금 그 보드에 있어야 쓴다: 사람이 잘못 붙은 원아를 반 보드에서 떼면 다음 동기화가 기록만 보고 다시 붙이면 안 되고(떼는 것이
 *    유일한 처방이다), 기관에서 빠진 원아를 새 반에 넣으려다 실패하면 동기화 전체가 멈춘다. 이름·생년도 지금 ClassNote 값으로 대조한다.
 * @returns {{ members: object[], recorded: number }}  recorded = 기록에 있던 원아 수(보드에 없어 못 쓴 것 포함)
 */
function verifiedMembers(student, verifiedChildren, membersByBoard) {
  const list = verifiedChildren?.get?.(student.id) ?? [];
  const members = [];
  for (const v of list) {
    let live = null;
    for (const bid of v.boardIds ?? []) {
      const m = (membersByBoard.get(Number(bid)) ?? []).find((x) => Number(x.id) === Number(v.id));
      if (m) { live = m; break; }
    }
    if (live) members.push({ ...live, id: Number(live.id) });
  }
  return { members, recorded: list.length };
}

/**
 * 원아 연결(0185a)이 이 학생에게 붙인 원아 — 확인 기록이 아예 없는 학생의 마지막 출처(source "link").
 * 이름·생년은 **지금 ClassNote 값**으로 싣는다: 이름 = 운영관리 명부의 원아 이름(연결을 만든 바로 그 이름) · 생년 = 학부모 프로필 생년
 * (명부 생년은 ③이 따로 본다). 반 보드에 아직 없어도 된다(신입의 첫 배정).
 * 학부모 프로필(이름·생년) = 이번에 읽은 보드에서 찾은 값, 없으면 `childProfiles`(loadPlan이 원아 상세 GET으로 읽은 값 — 신입·일부 반만
 * 보는 실행). `nameChecks` = ⑥에 거는 이름 전부 = 명부 이름 + 프로필 이름. 🔴 둘 다 학생과 이어져야 통과한다:
 *   2026-11-02 실측 형제 3건(박세하↔박세인 · 윤현소/윤정인)은 명부 이름과 프로필 이름이 형제끼리 뒤바뀌어 있었다 — 명부 이름은 연결을
 *   만든 바로 그 입력이라 혼자서는 뒤바뀐 명부를 못 잡는다. 🔴 그래서 **프로필을 모르면 보류**한다(`profileKnown` false → 아래 가드).
 * 🔴 명부(운영관리 활성 원아)에 **없는** 원아만 뺀다 — 퇴원 때 명부에서 내린 옛 계정(재등록하면 새 원아 번호가 생긴다)이라 배정할 수도
 *    없고, 남기면 학생 전체가 '명부에 없음'으로 영구 보류된다(적대적 리뷰 2026-11-02). 남은 연결이 없으면 '가입 대기'.
 *    그 밖(전화·생년·이름 불일치)은 거르지 않고 그대로 돌려줘 아래 가드가 **사유와 함께 보류**하게 한다(조용히 빼면 형제 계정에 잘못
 *    붙은 연결이 '가입 대기'로 숨는다).
 * @param {Map<number,string>|null} childLinks  원아 id → 학생 id(`loadChildLinks`)
 * @param {Map<number,{name:string,date_birth:string|null}|null>|null} childProfiles  원아 id → 학부모 프로필(null = 조회 실패)
 */
function linkMembers(student, childLinks, admissions, membersByBoard, childProfiles) {
  const out = [];
  for (const [cid, sid] of childLinks ?? []) {
    if (sid !== student.id) continue;
    const id = Number(cid);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (!admissions?.get?.(id)) continue; // 명부에 없는 옛 계정 — 위 주석
    let seen = null;
    for (const list of membersByBoard.values()) {
      const m = Array.isArray(list) ? list.find((x) => Number(x.id) === id) : null;
      if (m) { seen = m; break; }
    }
    const profile = seen ?? childProfiles?.get?.(id) ?? null;
    const admName = String(admissions.get(id)?.name ?? "").trim();
    const profileName = String(profile?.name ?? "").trim();
    out.push({
      id,
      name: admName || profileName,
      date_birth: profile?.date_birth ?? null,
      // 명부 이름은 비어 있어도 넣는다(빈 이름 = ⑥ 탈락) — 프로필 이름 하나로 통과시키지 않는다. 빈 프로필은 `profileKnown`이 따로 막는다.
      nameChecks: [...new Set([admName, profileName].filter((n, i) => i === 0 || n))],
      profileKnown: Boolean(profileName),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** 원아 수 상한을 넘었을 때의 사유 머리 — 출처마다 무엇이 많은지 말한다. */
const SOURCE_LABEL = { personal: "1인 보드", verified: "반 보드에서 확인된", link: "이 학생과 연결된" };

/**
 * 학생 1명의 원아 판정 — 반과 무관하게 한 번만 한다(같은 학생이 반 3개면 같은 원아를 세 반에 싣는다).
 * 출처 순서 = 1인 보드(personal) → 반 보드 확인 기록(verified) → 원아 연결(link). 머리 주석 ① 참조.
 * `verifiedChildren`(학생 id → [{id,name,boardIds}], 0302a ok) = 1인 보드가 없거나 비었을 때 쓰는 출처.
 * `childLinks`(원아 id → 학생 id, 0185a) = 확인 기록이 **아예 없는** 학생만 쓰는 출처. 기록은 있는데 그 보드에 원아가 없으면
 *   그 회차는 '확인 필요' 보류다(보류 줄엔 원아 번호가 없어 다음 회차엔 원아 연결로 다시 판정한다 — 머리 주석 ① b).
 * `verifiedOwners`(원아 id → 학생 id들) = ④ 역방향 — 1인 보드가 비면 1인 보드 소속으로는 못 잡으니 기록으로도 본다.
 * @returns {{ok:boolean, reasons:string[], children:Array<{id:number,name:string}>, source:"personal"|"verified"|"link"|null}}
 *   source = 원아를 어디서 가져왔나(배정 직전 재확인이 출처마다 다르다 — math-class-boards-apply.mjs).
 */
export function resolveStudentChildren(student, { boards, membersByBoard, admissions, schoolYear, verifiedChildren = null, verifiedOwners = null, childLinks = null, childProfiles = null }) {
  const reasons = [];
  const want = normBoard(personalBoardName(student.name));
  const hit = (boards ?? []).filter((b) => normBoard(b.name) === want);
  if (hit.length > 1) return { ok: false, reasons: [`1인 보드 ${hit.length}개(중복)`], children: [], source: null };

  let members = [];
  let source = "personal";
  if (hit.length === 1) {
    members = membersByBoard.get(hit[0].id);
    if (!Array.isArray(members)) return { ok: false, reasons: ["1인 보드 원아 조회 실패"], children: [], source: null };
  }
  if (members.length === 0) {
    // 1인 보드가 없거나 비었다 — 반 보드에서 이미 확인한 원아로 판정한다.
    const v = verifiedMembers(student, verifiedChildren, membersByBoard);
    if (v.members.length) {
      members = v.members;
      source = "verified";
    } else if (v.recorded) {
      return { ok: false, reasons: [VERIFIED_GONE_REASON], children: [], source: null };
    } else {
      // 확인 기록도 없다 — 원아 연결로 판정한다(가드는 아래에서 똑같이). 그것도 없으면 가입 대기.
      members = linkMembers(student, childLinks, admissions, membersByBoard, childProfiles);
      source = "link";
      // 🔴 사유 문장은 글자 그대로 — 앱이 이 원문으로 '가입 대기'를 가린다(send-class.ts · 잠금 = board-missing.test.ts).
      if (!members.length) return { ok: false, reasons: [JOIN_WAIT_REASON], children: [], source: null };
    }
  }
  if (members.length > MAX_CHILDREN_PER_STUDENT)
    return { ok: false, reasons: [`${SOURCE_LABEL[source]} 원아 ${members.length}명 — 사람 확인 필요`], children: [], source: null };

  const expected = expectedBirthYear(student.grade, schoolYear);
  for (const m of members) {
    const who = `원아 "${m.name || "?"}"`;
    // ③ 생년 — 관리자 화면의 생년월일(운영관리 명부 child_date_birth)이 먼저, 학부모 프로필(date_birth)은 보조.
    //    둘 중 하나라도 맞으면 통과(원장 2026-09-29: 관리자 화면에서 고친 생년이 안 먹었다 — 두 값이 따로 산다).
    const toYear = (v) => { const y = Number(String(v ?? "").slice(0, 4)); return Number.isFinite(y) && y >= 1900 ? y : null; };
    const years = [toYear(admissions.get(m.id)?.birth), toYear(m.date_birth)].filter((y) => y != null);
    if (expected == null) reasons.push(`학년(${student.grade ?? "없음"})을 몰라 생년 대조 불가`);
    else if (!years.length) reasons.push(`${who} 생년 없음`);
    else if (!years.some((y) => Math.abs(y - expected) <= BIRTH_TOLERANCE))
      reasons.push(`${who} 생년 불일치(${years[0]}년생, 기대 ${expected}년생)`);
    // ⑥ 이름 연속성 — 원아 연결 출처는 명부 이름·프로필 이름 둘 다(linkMembers `nameChecks`), 그 밖은 보드에서 읽은 이름 하나.
    const names = Array.isArray(m.nameChecks) && m.nameChecks.length ? m.nameChecks : [m.name];
    // findIndex — 이름이 비어(undefined) 걸린 원아도 놓치지 않는다(find는 걸린 값 자체가 undefined면 '없음'과 구별이 안 된다).
    const off = names.findIndex((n) => !childNameConsistent(student.name, n));
    if (off >= 0) reasons.push(`원아 "${names[off] || "?"}" 이름이 학생(${student.name})과 다름 — 형제 계정일 수 있어 확인 필요`);
    // ⑥-b 원아 연결 출처는 학부모 프로필 이름까지 봐야 통과한다(linkMembers) — 못 읽었으면 보류(다음 동기화가 다시 읽는다).
    if (m.profileKnown === false) reasons.push(`${who} 학부모 프로필(이름)을 확인하지 못함 — 다음 동기화에서 다시 확인`);
    // ② 전화 — 값은 절대 사유에 싣지 않는다(일치 여부만)
    const adm = admissions.get(m.id);
    if (!adm) reasons.push(`${who} 운영관리 명부에 없음 — 보호자 전화 대조 불가`);
    else {
      const pm = phoneMatches(student.phones ?? [], [adm.phone]);
      if (pm === null) reasons.push(`${who} 보호자 전화 대조 불가(한쪽 번호 없음)`);
      else if (pm === false) reasons.push(`${who} 보호자 전화 불일치`);
      // ④ 역방향 — 이 원아가 다른 학생의 1인 보드에도 있다. 명부의 소속 보드 칸을 못 읽었으면(null) 대조할 수 없다(리뷰 B3 — 빈 목록으로 두면 조용히 통과).
      if (adm.boardNames === null) reasons.push(`${who} 운영관리 명부의 소속 보드를 읽지 못함 — 다른 학생 1인 보드 대조 불가`);
      const others = (adm.boardNames ?? [])
        .map(personalBoardOwner)
        .filter((o) => o && o !== normBoard(student.name));
      if (others.length) reasons.push(`${who} 다른 학생 1인 보드에도 있음(${others.map((o) => `(수학)${o}`).join(", ")})`);
    }
    // ④ 역방향(기록) — 반 보드 기록에서 이 원아가 다른 학생에게 '정상'으로 잡혀 있다(1인 보드가 비면 위 검사로는 못 잡는다).
    const recordedFor = [...(verifiedOwners?.get?.(Number(m.id)) ?? [])].filter((sid) => sid !== student.id);
    if (recordedFor.length) reasons.push(`${who} 반 보드 기록에서 다른 학생에게 확인된 원아입니다`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    children: members.map((m) => ({ id: m.id, name: m.name ?? "" })),
    source,
  };
}

/**
 * 반 보드로 **쓰면 안 되는 이름**(개명 감사 G2) — 1인 보드 `(수학)…`·`(영어)…` 같은 `(과목)` 접두, 전체방 `[ALL]…`.
 * 반 이름이 이 모양이면 그 이름의 보드를 채택·생성·개명하지 않는다 — 1인 보드와 이름이 겹치는 순간 1인 보드 발송의
 * "보드가 곧 매핑" 폴백이 이 반 가족 전원을 통과시킬 수 있다. 앱은 이런 반 이름을 저장 단계에서 막는다(class-name.ts).
 * @returns {string|null} 이유(한글) — 해당 없으면 null
 */
export function reservedBoardName(name) {
  const n = normBoard(name);
  if (/^\([^)]*\)/.test(n)) return "괄호 과목 접두로 시작하는 1인 보드 이름 모양입니다";
  if (/^\[ALL\]/i.test(n)) return "전체방([ALL]) 이름 모양입니다";
  return null;
}

/**
 * 반 보드 계획.
 * @param {object} p
 * @param {Array<{classId:string, className:string, studentIds:string[]}>} p.classes  대상 aywa 수학 반
 * @param {Map<string,{id:string,name:string,grade:string|null,phones:string[]}>} p.students  name = 유효이름
 * @param {Array<{id:number,name:string}>} p.boards  ClassNote 전 보드
 * @param {Map<number,Array<{id:number,name?:string,date_birth?:string|null}>>} p.membersByBoard  조회한 보드의 원아
 * @param {Map<number,{phone:string|null, boardNames:string[]}>} p.admissions  운영관리 명부(원아 id → 보호자 전화·소속 보드)
 * @param {number} p.schoolYear
 * @param {Map<string,Array<{id:number,name:string,boardIds:number[]}>>|null} [p.verifiedChildren]  반 보드에서 확인된 원아(0302a ok) — 1인 보드가 없거나 빈 학생만 쓴다
 * @param {Set<string>|null} [p.verifiedOwnerScope]  ④(기록) 비교 상대 학생 — 전체 대상 반의 학생(없으면 이번 계획 반의 학생)
 * @param {Map<number,string>|null} [p.childLinks]  원아 연결(0185a, 원아 id → 학생 id) — 확인 기록이 아예 없는 학생만 쓴다.
 *   명부(`admissions`)에 없는 원아는 빼고, ⑥은 명부 이름(`name`) + 학부모 프로필 이름 둘 다로 건다(프로필을 모르면 보류).
 * @param {Map<number,{name:string,date_birth:string|null}|null>|null} [p.childProfiles]  이번에 읽은 보드에 없는 연결 원아의 학부모 프로필
 *   (loadPlan이 원아 상세 GET으로 읽는다 · null = 조회 실패 → 그 학생 보류).
 * @param {Map<string, Set<number>>|null} [p.formerFamilyByClass]  보고서 미발송 반(`reportOptout`)의 같은 이름 보드에 남은 원아 중 **이 반의 지난
 *   학생으로 증명된 원아**(해제 판정 ①②③ 통과 — class-board-release.mjs `formerFamilyOf`). 이 원아만 남은 보드는 채택한다(그 뒤 자동 해제가 정리).
 */
export function planClassBoards({ classes, students, boards, membersByBoard, admissions, schoolYear, linkedBoardByClass = new Map(), verifiedChildren = null, verifiedOwnerScope = null, childLinks = null, childProfiles = null, formerFamilyByClass = null }) {
  // 1) 학생별 원아 판정(한 번씩)
  const byStudent = new Map();
  // 비교 상대 = 지금 대상 반에 다니는 학생(일부 반만 보는 실행은 호출부가 전체 대상 반 기준으로 넘긴다 — verifiedOwnerScope).
  const ownerScope = verifiedOwnerScope ?? new Set(classes.flatMap((c) => c.studentIds));
  const verifiedOwners = verifiedOwnersOf(verifiedChildren, (sid) => ownerScope.has(sid));
  for (const c of classes)
    for (const sid of c.studentIds) {
      if (byStudent.has(sid)) continue;
      const s = students.get(sid);
      byStudent.set(sid, s ? resolveStudentChildren(s, { boards, membersByBoard, admissions, schoolYear, verifiedChildren, verifiedOwners, childLinks, childProfiles }) : { ok: false, reasons: ["학생 정보 없음"], children: [], source: null });
    }

  // ④-b 계획 안에서 한 원아가 두 학생에게 잡히면 둘 다 보류
  // 🔴 원아 연결 출처인데 자기 가드에 이미 걸린 학생은 세지 않는다 — 형제에게 잘못 붙은 연결 하나가 **확인 기록·1인 보드로 멀쩡히
  //    받던 형제**까지 보류시키면 안 된다(그 학생은 이미 보류이고, 연결이 틀렸다는 사유는 그 학생 줄에 남는다).
  const owners = new Map();
  for (const [sid, v] of byStudent) {
    if (v.source === "link" && !v.ok) continue;
    for (const ch of v.children) owners.set(ch.id, [...(owners.get(ch.id) ?? []), sid]);
  }
  for (const [cid, sids] of owners) {
    if (sids.length < 2) continue;
    const names = sids.map((sid) => students.get(sid)?.name ?? "?").join(", ");
    for (const sid of sids) {
      const v = byStudent.get(sid);
      v.ok = false;
      v.reasons.push(`같은 원아(id ${cid})가 여러 학생에게 잡힘: ${names}`);
    }
  }

  // 2) 반별
  // 연결표(0302a)가 쥔 보드 → 반. 이름이 같은 보드라도 **다른 반에 연결된 보드**는 이 반 것으로 보지 않는다.
  const classByLinkedBoard = new Map([...linkedBoardByClass].map(([cid, bid]) => [Number(bid), cid]));
  // 이 반 누구의 원아인가 — 보류된 학생 원아도 "그 반 가족"이다(아래 extras와 같은 축).
  const plannedOf = (c) => new Set(c.studentIds.flatMap((sid) => byStudent.get(sid).children.map((ch) => ch.id)));
  const plans = classes.map((c) => {
    const linkedId = linkedBoardByClass.get(c.classId);
    const linked = linkedId != null ? (boards ?? []).find((b) => Number(b.id) === Number(linkedId)) : null;
    // 🔑 이름 충돌은 **다른 보드**와의 충돌만 센다 — 연결된 자기 보드는 빼고 본다(개명 감사 G7: "중3 A"→"중3A"처럼
    //    공백만 바꾼 개명이 자기 보드와 '공백만 다름'으로 잡혀 영구 보류되던 것).
    const others = (boards ?? []).filter((b) => !linked || Number(b.id) !== Number(linked.id));
    const exact = others.filter((b) => b.name === c.className);
    const near = others.filter((b) => b.name !== c.className && normBoard(b.name) === normBoard(c.className));
    const reserved = reservedBoardName(c.className);
    let board;
    if (linked) {
      // 🔑 반 연결은 **번호가 기준**이다(2026-09-29 동기화) — aywa에서 반 이름을 바꿔도 새 반을 만들지 않고 이름을 바꾼다.
      // 🔴 이름을 못 바꾸는 사정(같은 이름 보드가 이미 있음·예약된 이름)이 있어도 **연결은 지킨다**(개명 감사 G1) —
      //    번호로 계속 보내면 되고, 연결을 지우면 다음 날 이름으로 엉뚱한 보드를 채택하거나 새 보드를 만든다.
      if (linked.name === c.className) board = { action: "exists", id: linked.id, name: linked.name };
      else if (reserved)
        board = { action: "exists", id: linked.id, name: linked.name, renameBlocked: `반 이름 "${c.className}"은(는) ${reserved} — 보드 이름을 바꾸지 않습니다` };
      else if (exact.length || near.length)
        board = { action: "exists", id: linked.id, name: linked.name, renameBlocked: `반 이름을 "${c.className}"(으)로 바꿔야 하는데 그 이름의 보드가 이미 있습니다 — 발송은 연결된 보드(#${linked.id})로 계속합니다` };
      else board = { action: "exists", id: linked.id, name: linked.name, rename: { from: linked.name, to: c.className } };
    } else if (linkedId != null) {
      // 🔴 연결된 보드가 ClassNote에서 사라졌다 = 사람이 지웠다(2026-09-29 빈 반 JJ3E). 새로 만들면 지운 반이 매일 되살아난다.
      // 연결 행은 남긴다(deletedBoardId) — 지우면 다음 날 이름 규칙으로 다시 만들어진다. 안 쓰는 반이면 aywa에서 종강하면 연결도 정리된다.
      board = { action: "block", deletedBoardId: Number(linkedId), reason: `연결된 ClassNote 반(#${linkedId})이 삭제됐습니다 — 안 쓰는 반이면 aywa에서 종강하세요` };
    } else if (reserved) board = { action: "block", reason: `반 이름 "${c.className}"은(는) ${reserved} — 반 보드로 쓰지 않습니다` };
    else if (exact.length > 1) board = { action: "block", reason: `같은 이름 보드 ${exact.length}개` };
    else if (near.length) board = { action: "block", reason: `공백만 다른 보드가 있음(${near.map((b) => JSON.stringify(b.name)).join(", ")})` };
    else if (exact.length === 1 && classByLinkedBoard.has(Number(exact[0].id)) && classByLinkedBoard.get(Number(exact[0].id)) !== c.classId)
      board = { action: "block", reason: `같은 이름 보드가 다른 반에 연결돼 있습니다` };
    else if (exact.length === 1) {
      // 🔴 이름만 같은 기존 보드를 처음 채택할 때는 **그 보드의 원아가 전부 이 반 가족**이어야 한다(개명 감사 G2) —
      //    폐지 반의 옛 보드·사람이 만든 보드에 남의 집이 있으면 우리 가족을 거기 섞게 된다.
      const members = membersByBoard.get(exact[0].id);
      const planned = plannedOf(c);
      if (!Array.isArray(members)) board = { action: "block", reason: `같은 이름 보드(#${exact[0].id}) 원아 조회 실패 — 채택 보류` };
      else {
        const strangers = members.filter((m) => !planned.has(m.id));
        // 🔑 보고서 미발송 반(JJ)은 ClassNote에 같은 이름 보드가 먼저 있었다 — 그 보드에 **이 반의 지난 학생**(수강이 끝나 그대로 해제 대상인
        //    원아)만 남아 있으면 남의 집이 아니라 이 반의 옛 가족이라 채택한다(원장 2026-11-03). 그 원아는 채택 뒤 자동 해제가 정리한다
        //    (④ 양 가드에 걸리면 해제 리스트에 사유와 함께 남는다). 지난 학생으로 증명되지 않는 원아가 하나라도 있으면 종전대로 보류.
        //    11-04 되돌림 뒤 운영 경로에선 `reportOptout`이 생기지 않아 이 채택은 쓰이지 않는다.
        const former = c.reportOptout ? formerFamilyByClass?.get?.(c.classId) ?? null : null;
        const foreign = former ? strangers.filter((m) => !former.has(Number(m.id))) : strangers;
        if (!strangers.length) board = { action: "exists", id: exact[0].id, name: exact[0].name };
        else if (!foreign.length) board = { action: "exists", id: exact[0].id, name: exact[0].name, adoptedFormer: strangers.length };
        else
          board = {
            action: "block",
            reason: former
              ? `같은 이름 보드(#${exact[0].id})에 이 반 학생도 이 반의 지난 학생도 아닌 원아 ${foreign.length}명이 있습니다 — 채택하지 않습니다(사람 확인)`
              : `같은 이름 보드(#${exact[0].id})에 이 반 학생이 아닌 원아 ${strangers.length}명이 있습니다 — 채택하지 않습니다(사람 확인)`,
            // 미발송 반 — 낯선 원아가 이 반의 지난 학생인지 호출부(loadPlan `formerFamily`)가 확인할 수 있게 넘긴다.
            ...(c.reportOptout && !former ? { adoptCandidate: { boardId: Number(exact[0].id), boardName: exact[0].name, strangers: strangers.map((m) => ({ id: Number(m.id), name: m.name ?? "?" })) } } : {}),
          };
      }
    } else board = c.reportOptout && !c.studentIds.length ? { action: "block", reason: OPTOUT_NO_CREATE_REASON, notice: true } : { action: "create" };
    // `notice` = 실패가 아니라 안내(학생이 없어 일부러 안 만든다) — 보고서가 '보류'로 적어 실패 수·버튼 숫자에 들지 않는다(리뷰 C1).

    // ⑤ 같은 반 기본이름 겹침
    const groups = new Map();
    for (const sid of c.studentIds) {
      const b = baseName(students.get(sid)?.name);
      if (b) groups.set(b, [...(groups.get(b) ?? []), sid]);
    }
    const homonym = new Map();
    for (const sids of groups.values()) {
      if (sids.length < 2) continue;
      const names = sids.map((sid) => students.get(sid)?.name ?? "?").join(", ");
      for (const sid of sids) homonym.set(sid, `같은 반 동명이인(${names}) — 원장 확인 전 자동 배정 금지`);
    }

    const current = board.action === "exists" ? membersByBoard.get(board.id) : [];
    const currentIds = new Set((current ?? []).map((m) => m.id));
    const assign = [];
    const hold = [];
    for (const sid of c.studentIds) {
      const s = students.get(sid);
      const v = byStudent.get(sid);
      const reasons = [...v.reasons, ...(homonym.has(sid) ? [homonym.get(sid)] : [])];
      if (board.action === "block") reasons.push(`반 보드 특정 불가 — ${board.reason}`);
      if (reasons.length) hold.push({ studentId: sid, name: s?.name ?? "?", reasons });
      else
        assign.push({
          studentId: sid,
          name: s.name,
          children: v.children.map((ch) => ({ ...ch, already: currentIds.has(ch.id) })),
          source: v.source,
        });
    }
    // 보류된 학생의 원아도 "그 반 학생의 가족"이라 잉여가 아니다 — 잉여 = 이 반 누구의 원아도 아닌 것.
    const planned = new Set(c.studentIds.flatMap((sid) => byStudent.get(sid).children.map((ch) => ch.id)));
    // extraChildren = 같은 목록을 번호와 함께(자동 해제가 번호로 내보낸다 — class-board-release.mjs). extras는 이름만(보고서·해제 리스트).
    const extraChildren = (current ?? []).filter((m) => !planned.has(m.id)).map((m) => ({ id: m.id, name: m.name ?? "?" }));
    const extras = extraChildren.map((m) => m.name);
    return { classId: c.classId, className: c.className, board, assign, hold, extras, extraChildren, ...(c.reportOptout ? { reportOptout: true } : {}) };
  });
  return plans;
}

/** 요약 — 반·학생×반·원아 배정 건수. */
export function summarizePlan(plans) {
  const s = { classes: plans.length, create: 0, exists: 0, blocked: 0, pairs: 0, assignPairs: 0, holdPairs: 0, enrollments: 0, already: 0, extras: 0 };
  for (const p of plans) {
    if (p.board.action === "create") s.create++;
    else if (p.board.action === "exists") s.exists++;
    else s.blocked++;
    s.pairs += p.assign.length + p.hold.length;
    s.assignPairs += p.assign.length;
    s.holdPairs += p.hold.length;
    s.extras += p.extras.length;
    for (const a of p.assign) for (const ch of a.children) {
      if (ch.already) s.already++;
      else s.enrollments++;
    }
  }
  return s;
}

/**
 * 동기화가 걷지 않고 **지킬** 종강 반 연결 — 종강 반이면서 연결된 ClassNote 보드가 지금 목록에 살아 있는 반(순수).
 * 보드가 지워졌으면 지키지 않는다 → 연결이 걷히고 앱이 '보낼 반' 고르기를 띄운다(원장 2026-09-30).
 * @param {{ closedIds: readonly string[], planClassIds: readonly string[], linkedBoardByClass: Map<string, number>, liveBoardIds: Iterable<number> }} a
 * @returns {string[]}
 */
export function closedClassesToKeep({ closedIds, planClassIds, linkedBoardByClass, liveBoardIds }) {
  const inPlan = new Set(planClassIds);
  const live = new Set([...liveBoardIds].map(Number));
  return closedIds.filter((id) => !inPlan.has(id) && linkedBoardByClass.has(id) && live.has(Number(linkedBoardByClass.get(id))));
}

/**
 * 매일 05시 1인 보드 준비(classnote-provision-core.mjs)가 오늘 **수학을 건너뛸까**(순수) — 원장 2026-11-02 A안.
 * · `"class"`   = 수학 발송 경로가 반별 — `(수학)이름` 1인 보드를 만들지도 원아를 배정하지도 않는다(원아 신분 = ① b·c).
 * · `"unknown"` = 경로를 못 읽었다 — 모르는 채로 1인 보드를 만들거나 채우지 않는다(그날 수학만 건너뛴다).
 * · `null`      = 기존(personal)·일부 선생님만 반별(pilot) — 1인 보드로 보내는 선생님이 있으니 종전대로 준비한다.
 * 영어는 이 판정과 무관하다(영어 `(영어)` 준비는 그대로).
 * @param {string|null|undefined} route  `getClassnoteMathRoute().route`(못 읽었으면 null)
 * @returns {"class"|"unknown"|null}
 */
export function mathPersonalProvisionOff(route) {
  if (route === "class") return "class";
  if (route === "personal" || route === "pilot") return null;
  return "unknown";
}
