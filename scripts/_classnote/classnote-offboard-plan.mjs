// scripts/_classnote/classnote-offboard-plan.mjs — **전 과목 퇴원 45일 뒤 ClassNote 명부 퇴원처리(퇴소)** 판정(순수 — playwright·postgres import 금지).
//
// 원장 2026-11-03 *"남은 수강과목이 1개도 없는 경우에는 45일 뒤 자동으로 퇴원처리"* — 학원이 그 원아의 옛 글을 못 보게 돼도 그대로 하되,
// **퇴원처리 직전 그 원아의 글 목록을 백업**한다(실행 = classnote-offboard.mjs). 퇴소는 되돌리는 API가 없다(학부모 재초대뿐 · 새 원아 번호가
// 생길 수 있다) — 그래서 이 판정은 **모르면 제외**(fail-closed)다. 안 내리면 현상 유지(무해), 잘못 내리면 복구 불가.
//
// 대상(전부 AND):
//   ① 원아 → 학생이 **한 명으로** 이어져 있다 — 원아 연결(0185a) 또는 반 보드 확인 기록(0302a ok). 이어진 것이 없으면 대상이 아니다
//      (엄채원학생·하수빈&하준수처럼 연결 없는 원아는 이름이 비슷해도 절대 대상이 아니다). 둘 이상이면 제외.
//   ② 그 학생 = 퇴원(`withdrawn`) · 테스트·보호 이름·중복 병합(진 쪽) 아님 · **모든 과목에 열린/시작 전 수강 0건**.
//   ③ 기준일 = max(퇴원일, 마지막 수강 종료일) · 기준일 + 45일 ≤ 오늘(KST). 퇴원일을 모르면 제외.
//   ④ 퇴원하지 않은 학생 누구의 원아일 수 있으면 제외 — 반 보드 자동 해제 ①과 같은 판정(이름이 이어짐 · 그 학생에게 연결/확인됨 ·
//      그 학생의 1인 보드에 있음 · **보호자 전화가 같음(형제)**). 비교 상대 = 열린(시작 전 포함) 수강이 있거나 **퇴원이 아닌 모든 상태**
//      (재원·휴원·예비원생·상담 — 2026-11-03 리뷰: 예비원생 '이승민A'). 이름은 원아 두 벌(명부·원아 목록) × 학생 두 벌(에이와·ClassNote 이름).
//   ⑤ 퇴원일 뒤의 돈 흔적(퇴원 다음 달 이후 청구 · 퇴원일 뒤 납부)이 있으면 제외(7/30 배한빈 실측 — 돈만이 그가 다닌다고 말했다) ·
//      퇴원일 뒤 출결·수업보고서가 있으면 제외(수강 행 없이 자리·보강으로 다닌 경우 · 리뷰 B10).
//   ⑥ 명부의 보호자 전화(carer 전화 전부)가 **하나도 없으면** 제외(형제 대조를 못 한다 · 리뷰 B7) · 그 학생과 **확실히 다르면** 제외(다른 집) ·
//      원아 명부 이름이 그 학생 이름과 **같지 않으면**(공백·끝 알파벳 제외 · 실례 한민호 ↔ 원아 '한도현') 제외 ·
//      한 학생의 원아 계정 중 하나라도 보류되면 그 학생의 원아는 모두 둔다(한 집을 반만 내리지 않는다).
//   ⑦ ClassNote 쪽(실행 직전 · 원아마다): 최근 45일 안에 그 원아 글이 있으면 제외(기준일 뒤의 활동 = 다니고 있을 수 있다 · 7/30 '어떤 보고서라도'
//      백스톱) · 글 목록을 끝까지 받지 못했으면 제외(백업 불가) · 학부모 정보(재초대 대상)를 못 읽었으면 제외.
//   ⑧ 남은 배정 모양 — 승인된·안 떠난 배정이 **전체방과 본인 1인 보드 `(과목)본인이름`뿐**일 때만(반 보드·영어 반 방·그룹 보드·남의 1인 보드가
//      남아 있으면 누가 그 원아를 쓰고 있을 수 있다 — 1단계 해제가 먼저 뗀다). 전체방 판정은 `centerWideRoomIds`(이름만 믿지 않는다).
// 7/30 판정(offboard-safety.mjs `evaluateOffboardCandidate`)에서 **안 가져온 것**과 이유:
//   · 1인 보드 봉쇄·공유 보드·보드 인원 정합(I5 등) — 1인 보드 시대의 '보드 = 학생' 전제다. 지금은 반 보드에 여러 집이 있는 게 정상이고,
//     퇴소는 보드가 아니라 원아 번호를 지목하므로 남의 집이 같이 끊기지 않는다(같이 끊기는지는 실행 뒤 명부로 확인한다). 대신 ⑧이
//     '전체방·본인 1인 보드 말고는 아무 배정도 없다'를 요구한다(남의 개인 보드도 여기서 막힌다).
//   · 생년 ↔ 학년 대조(I2) — 원아 연결·확인 기록이 이미 전화·이름·생년으로 만든 연결이다(여기서 다시 막으면 연결된 원아만 빠진다).
//   · 시스템 일괄 퇴원일 제외 — 그 규칙은 '장부 날짜로 유예를 잘못 재는 것'을 막았다. 기준일이 max(퇴원일, 마지막 수강 종료일)이라
//     장부 날짜는 기준일을 늦출 뿐이다(더 안전한 쪽).
//   · ERP 명부 이름 대조 — 퇴소 API가 원아 번호를 받으므로 이름 행을 지목할 일이 없다.

import { baseName, childNameConsistent } from "./class-board-plan.mjs";
import { personalOwnerName } from "./class-board-release.mjs";
import { normBoard } from "./board-safety.mjs";
import { dayDiff, isProtectedName, phoneMatches } from "./offboard-safety.mjs";

/** 전 과목 퇴원 뒤 이만큼 지나야 명부에서 내린다(원장 2026-11-03). */
export const OFFBOARD_GRACE_DAYS = 45;
/** 하루에 내리는 원아 상한 기본값 — 연동 PC `CLASSNOTE_OFFBOARD_DAILY_LIMIT`로 바꾼다. */
export const OFFBOARD_DAILY_LIMIT = 10;
/** 최근 이만큼 안에 그 원아 글이 있으면 내리지 않는다(기준일 + 45일이 지났는데 글이 있다 = 다니고 있을 수 있다). */
export const OFFBOARD_RECENT_POST_DAYS = 45;

/** 하루 상한 — env 값(양의 정수)이 있으면 그것, 없거나 이상하면 기본값. */
export function offboardDailyLimit(env = process.env) {
  const n = Number(String(env?.CLASSNOTE_OFFBOARD_DAILY_LIMIT ?? "").trim());
  return Number.isInteger(n) && n > 0 && n <= 200 ? n : OFFBOARD_DAILY_LIMIT;
}
/**
 * 스위치 — 🔴 **기본 꺼짐(관찰 모드)**. `CLASSNOTE_OFFBOARD=on`(true·1·yes)일 때만 실제로 내린다(리뷰 B1 — 연동 앱 화면은 ID/PW만 저장해
 * 원장이 PC에서 끌 방법이 없다. 그래서 켜는 쪽을 명시로). 꺼져 있으면 05시 정기 동기화가 판정 + 글 목록 확인까지만 돌리고 보고서에
 * '퇴원처리 예정' 줄을 남긴다(쓰기 0). 켜는 절차 = 원장이 보고서의 예정 명단을 확인 → 다음 연동 앱 버전에서 기본값을 바꾼다
 * (classnote-integration.md §11 'Phase 2 구현').
 */
export const offboardEnabled = (env = process.env) => ["on", "true", "1", "yes"].includes(String(env?.CLASSNOTE_OFFBOARD ?? "").trim().toLowerCase());

/**
 * 이 회차에 퇴원처리를 쉬어야 하나 — 반 보드 자동 해제의 **멈춤 표식이 남아 있거나**(해제 스위치와 무관하게 표식 파일을 직접 본다)
 * 이 회차 해제가 멈췄으면 쉰다(예상 밖 변화가 있던 날 되돌릴 수 없는 일을 하지 않는다 · 리뷰 O4/B4). 쉴 때는 보고서 문구, 아니면 null.
 * @param {{releaseHalted?:string|null}|null} run  이 회차 동기화 결과
 * @param {string} [haltMarker]  `releaseHaltReason()` — 해제 멈춤 표식(없으면 빈 글)
 */
export const offboardSkipForRun = (run, haltMarker = "") =>
  run?.releaseHalted || String(haltMarker ?? "").trim()
    ? "반 보드 자동 해제가 멈춰 있어 명부 퇴원처리도 하지 않았습니다 — 멈춤이 풀린 뒤 다음 동기화에서 합니다"
    : null;

/** 지점의 가장 최근 출결·수업보고서가 이보다 오래됐으면 '읽지 못함'으로 본다(권한 없이 0행으로 위장한 경우까지 · 리뷰 R9). */
export const ACTIVITY_STALE_DAYS = 14;
/** 권한 오류인가 — 게이트웨이는 SQLSTATE `42501`을 코드로 돌려준다(src/features/sync-agent/server/gateway.ts). */
export const isPermissionDenied = (e) => e?.code === "42501" || /\b42501\b|permission denied/i.test(String(e?.message ?? ""));

/**
 * 퇴원 뒤 활동 가드(B10)를 믿을 수 있나 — 그 지점의 가장 최근 출결·수업보고서가 **읽혀야** 한다. 권한이 없거나(42501) 비었거나 14일보다
 * 오래됐으면 그날 퇴원처리(관찰 포함)를 하지 않는다 — 실패가 아니라 보류(매일 실패 수가 쌓이지 않게). 읽히면 null.
 * 🔴 grant만 있고 정책이 없으면 에러 없이 0행이라 '퇴원 뒤 출결 없음'으로 읽혀 가드가 조용히 꺼진다 — 그 위장을 여기서 막는다.
 * @param {{ lastAttendance:{date:string|null, denied:boolean}, lastReport:{date:string|null, denied:boolean}, today:string }} a
 */
export function activityUnreadable({ lastAttendance, lastReport, today }) {
  const check = (label, x) => {
    if (x?.denied) return `${label} 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(연동 PC에 읽기 권한이 없습니다)`;
    const d = x?.date ? dayDiff(String(x.date).slice(0, 10), today) : null;
    if (d == null) return `${label} 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(읽힌 기록이 없습니다)`;
    if (d > ACTIVITY_STALE_DAYS) return `${label} 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(가장 최근 기록이 ${d}일 전 — ${ACTIVITY_STALE_DAYS}일보다 오래됐습니다)`;
    return null;
  };
  return check("출결", lastAttendance) ?? check("수업보고서", lastReport);
}

/**
 * 퇴원처리 회차 건전성 — 명부에서 전체방 배정이 보이는 원아 수와 전체방 보드의 원아 수가 크게 다르면(10% 넘게) 그날은 하지 않는다
 * (명부·보드 조회 중 하나가 덜 왔거나 모양이 바뀌었다 — 리뷰 B3). 맞으면 null, 아니면 보고서 문구.
 * @param {{ admissions: Map<number,{boards?:Array<{id:number}>|null}>, centerBoards: Array<{id:number,name:string,children:number|null}>|null, wideIds: Set<number> }} a
 */
export function rosterConsistency({ admissions, centerBoards, wideIds }) {
  const [wide] = [...(wideIds ?? [])];
  if (wide == null) return null; // 전체방이 없으면 ⑧이 아무도 안 내린다 — 따로 막을 것이 없다
  const board = (centerBoards ?? []).find((b) => Number(b.id) === Number(wide));
  const expect = board?.children == null ? NaN : Number(board.children);
  const seen = [...(admissions?.values?.() ?? [])].filter((a) => Array.isArray(a?.boards) && a.boards.some((b) => Number(b.id) === Number(wide))).length;
  if (!Number.isFinite(expect) || Math.abs(seen - expect) > expect * 0.1)
    return `명부에서 전체방 배정이 보이는 원아(${seen}명)와 전체방 보드의 원아(${Number.isFinite(expect) ? `${expect}명` : "모름"})가 크게 달라 오늘은 명부 퇴원처리를 하지 않았습니다(조회가 덜 됐을 수 있습니다)`;
  return null;
}

/**
 * 중복 병합으로 흡수된 쪽인가 — 앱 `src/features/students/status/merged.ts` `isMergedStudent`와 **같은 꼴**(학생 메모 맨 앞 표식).
 * 🔴 꼴을 바꾸면 두 곳을 같이(가드: classnote-offboard-plan.test.mjs가 앱 파일의 정규식과 글자로 대조한다).
 */
export const MERGE_NOTE_PATTERN = /^중복 병합:\s*\S+와 통합됨/;
export const isMergedNote = (notes) => typeof notes === "string" && MERGE_NOTE_PATTERN.test(notes.trimStart());

const later = (a, b) => (!a ? b ?? null : !b ? a : a > b ? a : b);
const day = (v) => (v ? String(v).slice(0, 10) : null);

const uniq = (xs) => [...new Set((xs ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))];
/** 학생 이름 두 벌(에이와 이름 · ClassNote 이름) — 같은 이름·1인 보드 판정은 둘 다 본다. */
const namesOf = (s) => uniq([s?.name, ...(s?.names ?? [])]);
/**
 * 같은 이름인가 — 공백 제거 + 끝 알파벳(동명이인 구분자) 제거 뒤 같다(2글자 이상). 포함 관계는 같은 이름이 아니다.
 * 🔴 **양쪽 다** 끝 알파벳이 있으면 그 알파벳까지 같아야 한다(리뷰 B11 — 명부 '이지아B' ≠ 학생 '이지아A' · 한쪽만 있으면 통과).
 */
const suffixOf = (s) => (String(s ?? "").replace(/\s/g, "").match(/[A-Za-z]+$/)?.[0] ?? "").toUpperCase();
export const sameName = (a, b) => {
  const x = baseName(a);
  if (x.length < 2 || x !== baseName(b)) return false;
  const [sa, sb] = [suffixOf(a), suffixOf(b)];
  return !sa || !sb || sa === sb;
};

/**
 * ⑧ 전체방 — 원아에게 이것과 본인 1인 보드만 남았을 때만 내린다. ClassNote 보드 목록·상세에는 **보드 종류 값이 없다**(2026-11-03 GET 실측:
 * 칸 = id·name·approved/waiting teachers·children 뿐). 그래서 이름 하나만 믿지 않고 넷을 모두 본다 — 이름이 `[ALL]`로 시작 · 그 센터에
 * 그런 보드가 **하나뿐** · 에이와 반(수학 반 보드·영어 반 방)에 이어지지 않음 · 재원 명부 원아의 절반 이상이 들어 있음.
 * 하나라도 아니면 전체방이 아니다(그 보드가 남은 원아는 '반 배정이 남아 있다'로 제외 — 모르면 내리지 않는다).
 * @param {{ boards: Array<{id:number,name:string,children:number|null}>|null, linkedBoardIds: Iterable<number>|null, rosterSize: number }} a
 *   linkedBoardIds = null이면 에이와 연결을 모른다(전체방 없음)
 * @returns {{ ids: Set<number>, basis: string }}  basis = 드라이런·보고서에 적는 판정 근거
 */
export function centerWideRoomIds({ boards, linkedBoardIds, rosterSize }) {
  const none = (basis) => ({ ids: new Set(), basis });
  if (!Array.isArray(boards)) return none("보드 목록을 읽지 못해 전체방을 정하지 않았습니다");
  if (linkedBoardIds == null) return none("에이와 반 ↔ 보드 연결을 읽지 못해 전체방을 정하지 않았습니다");
  const all = boards.filter((b) => /^\[ALL\]/i.test(normBoard(b?.name)));
  if (all.length !== 1) return none(`이름이 [ALL]로 시작하는 보드가 ${all.length}개라 전체방을 정하지 않았습니다`);
  const b = all[0];
  if (new Set([...linkedBoardIds].map(Number)).has(Number(b.id))) return none(`'${b.name}'이(가) 에이와 반에 이어져 있어 전체방으로 보지 않습니다`);
  const n = b.children == null ? NaN : Number(b.children);
  if (!Number.isFinite(n) || !(rosterSize > 0) || n * 2 < rosterSize)
    return none(`'${b.name}'의 원아(${Number.isFinite(n) ? `${n}명` : "모름"})가 재원 명부(${rosterSize}명)의 절반이 안 돼 전체방으로 보지 않습니다`);
  return { ids: new Set([Number(b.id)]), basis: `'${b.name}'(#${b.id}) — 이름 [ALL] · 센터에 하나 · 에이와 반 연결 없음 · 재원 명부 ${rosterSize}명 중 ${n}명` };
}

/**
 * 명부 퇴원처리 대상(DB·명부만으로 가르는 부분 — ⑦은 `checkChildPosts`가 실행 직전에).
 * @param {object} a
 * @param {Map<number,{name?:string, phone?:string|null, boardNames?:string[], boards?:Array<{id:number,name:string}>}>} a.admissions
 *   재원 명부(원아 → 명부 이름(basic_info) · 보호자 전화 · 소속 보드 이름 · 승인된·안 떠난 배정)
 * @param {Map<string,{id:string, name:string, names?:string[], status?:string, withdrawnAt?:string|null, isTest?:boolean, notes?:string|null, phones?:string[]}>} a.students
 * @param {Map<string,{open:boolean, lastEnd:string|null}>} a.enrollment  학생 → 전 과목 열린(시작 전 포함) 수강이 있나 · 마지막 종료일
 * @param {Map<number,string>} a.childLinks  원아 → 학생(0185a)
 * @param {Map<number,Set<string>>} a.verifiedOwners  원아 → 0302a ok로 확인된 학생들
 * @param {Map<string,{lastPeriod:string|null, lastPaidAt:string|null}>} [a.billing]
 * @param {Map<string,{lastAttendance:string|null, lastReport:string|null}>} [a.activity]  학생 → 마지막 출결일·수업보고서일(B10)
 * @param {Map<number,string>} [a.childNames]  원아 → 원아 목록 이름(학부모가 바꿀 수 있다 — 같은 이름 판정에만 함께 쓴다)
 * @param {Array<{id:number,name:string,children:number|null}>|null} [a.centerBoards]  센터 보드 전부(⑧ 전체방 판정)
 * @param {Iterable<number>|null} [a.linkedBoardIds]  에이와 반에 이어진 보드 번호(수학 반 보드 + 영어 반 방)
 * @param {string} a.today  KST 'YYYY-MM-DD'
 * @returns {{ candidates: object[], excluded: object[], waiting: object[], unlinked: number, centerWide: string }}
 *   candidates = 기준일이 오래된 순 · excluded = 퇴원 45일이 지났는데 가드에 걸린 원아(`code` = 첫 사유 · `codes` = 걸린 사유 전부) ·
 *   waiting = 45일 전 · centerWide = ⑧ 전체방 판정 근거
 */
export function planOffboard({ admissions, students, enrollment, childLinks, verifiedOwners, billing = new Map(), activity = new Map(), today, childNames = new Map(), centerBoards = null, linkedBoardIds = null }) {
  // 비교 상대 = **퇴원이 아닌 학생 전부**(재원·휴원·예비원생·상담) + 열린 수강이 있는 학생(2026-11-03 리뷰 — 예비원생 '이승민A'와 같은 이름인
  // 퇴원생 '이승민'의 원아가 대상에 올랐다. 예비원생도 곧 다닐 학생이고, 그 원아일 수 있다).
  const keepers = [...students.values()].filter((s) => enrollment.get(s.id)?.open || s.status !== "withdrawn");
  const keeperNames = new Set(keepers.flatMap((k) => namesOf(k).map(normBoard)));
  // '기본 이름|끝 알파벳' → 그 이름을 가진 학생들(상태 무관 · F7 — 학생 쪽에 알파벳이 없을 때 명부 '박서준C'가 다른 '박서준C' 학생 몫인지 본다).
  const suffixed = new Map();
  for (const t of students.values()) for (const n of namesOf(t)) {
    const sx = suffixOf(n);
    if (!sx) continue;
    const key = `${baseName(n)}|${sx}`;
    suffixed.set(key, new Set([...(suffixed.get(key) ?? []), t.id]));
  }
  const wide = centerWideRoomIds({ boards: centerBoards, linkedBoardIds, rosterSize: admissions?.size ?? 0 });
  const candidates = [];
  const excluded = [];
  const waiting = [];
  // 퇴원하지 않은 학생에게도 이어진 원아의 **퇴원생 쪽 주인** — 그 학생의 다른 원아 계정도 둔다(리뷰 B6 · 한 집을 반만 내리지 않는다).
  const sharedOwners = new Set();
  let unlinked = 0;
  for (const [cid, adm] of admissions ?? []) {
    const childId = Number(cid);
    const rosterName = String(adm?.name ?? "").trim();
    const listName = String(childNames?.get?.(childId) ?? "").trim();
    const childName = rosterName || listName || "?";
    const childNameSet = uniq([rosterName, listName]);
    // ① 이 원아가 누구인가 — 연결·확인 기록으로만(이름으로 추측하지 않는다).
    const owners = new Set([...(verifiedOwners?.get?.(childId) ?? [])]);
    const linked = childLinks?.get?.(childId);
    if (linked) owners.add(linked);
    if (!owners.size) { unlinked++; continue; }
    const out = (code, why, s = null) => excluded.push({ childId, childName, studentId: s?.id ?? null, studentName: s?.name ?? null, code, codes: [code], why });
    const ownerList = [...owners].map((id) => students.get(id));
    // 그 원아가 퇴원하지 않은 학생에게 이어져 있으면 — 퇴원생이 아니라 그 학생의 원아다(대상 아님 · 조용히 넘어간다).
    //   함께 이어진 퇴원생이 있으면 그 퇴원생의 다른 원아 계정도 둔다(B6).
    const live = (s) => s && (enrollment.get(s.id)?.open || s.status !== "withdrawn");
    if (ownerList.some(live)) {
      for (const s of ownerList) if (s && !live(s)) sharedOwners.add(s.id);
      continue;
    }
    if (owners.size > 1) { out("ambiguous_owner", `이 원아가 학생 ${owners.size}명에게 이어져 있어 누구의 원아인지 하나로 정할 수 없습니다`); continue; }
    const s = ownerList[0];
    if (!s) { out("no_student", "이어진 학생 정보를 읽지 못했습니다"); continue; }
    // ② 학생
    if (s.isTest || namesOf(s).some(isProtectedName) || childNameSet.some(isProtectedName)) { out("protected", "테스트·보호 계정입니다 — 명부에서 내리지 않습니다", s); continue; }
    if (isMergedNote(s.notes)) { out("merged", "중복 병합으로 다른 학생에 합쳐진 기록입니다 — 그만둔 학생이 아닙니다", s); continue; }
    const enr = enrollment.get(s.id) ?? { open: false, lastEnd: null };
    // ③ 기준일
    const withdrawnAt = day(s.withdrawnAt);
    if (!withdrawnAt) { out("no_withdrawn_at", "퇴원일이 없어 45일이 지났는지 알 수 없습니다", s); continue; }
    const base = later(withdrawnAt, day(enr.lastEnd));
    const days = dayDiff(base, today);
    if (days == null) { out("bad_date", `기준일(${base})을 해석할 수 없습니다`, s); continue; }
    const row = { childId, childName, studentId: s.id, studentName: s.name, withdrawnAt, lastEnd: day(enr.lastEnd), baseDate: base, days, boardNames: [...(adm?.boardNames ?? [])] };
    if (days < OFFBOARD_GRACE_DAYS) { waiting.push(row); continue; }
    // 여기부터는 사유를 **모두** 모은다(첫 사유가 보고서 문구 · 드라이런은 사유별로 따로 센다).
    const reasons = [];
    const hit = (code, why) => reasons.push({ code, why });
    // ⑤ 퇴원 뒤 돈 흔적
    const b = billing?.get?.(s.id);
    const money = [];
    if (b?.lastPeriod && b.lastPeriod > withdrawnAt.slice(0, 7)) money.push(`청구 ${b.lastPeriod}`);
    if (b?.lastPaidAt && day(b.lastPaidAt) > withdrawnAt) money.push(`납부 ${day(b.lastPaidAt)}`);
    if (money.length) hit("recent_billing", `퇴원일(${withdrawnAt}) 뒤의 돈 흔적이 있습니다(${money.join(", ")}) — 다니고 있을 수 있어 내리지 않습니다`);
    // ⑤-b 퇴원일 뒤의 에이와 활동 — 출결·수업보고서(수강 행 없이 자리·보강으로 다닌 경우 · 리뷰 B10).
    const act = activity?.get?.(s.id);
    const did = [];
    if (act?.lastAttendance && day(act.lastAttendance) > withdrawnAt) did.push(`출결 ${day(act.lastAttendance)}`);
    if (act?.lastReport && day(act.lastReport) > withdrawnAt) did.push(`수업보고서 ${day(act.lastReport)}`);
    if (did.length) hit("recent_activity", `퇴원일(${withdrawnAt}) 뒤의 기록이 있습니다(${did.join(", ")}) — 다니고 있을 수 있어 내리지 않습니다`);
    // ⑥ 다른 집 · 다른 아이 — 보호자 전화가 확실히 다르거나, 원아 이름이 그 학생 이름과 **같지 않으면**(공백·끝 알파벳 제외) 내리지 않는다.
    //    원아 이름 = 명부 이름(학원이 적는 basic_info) — 학부모가 원아 목록 이름을 '채민 공주💋'처럼 바꾼 경우가 있어서다. 명부 이름이 없을 때만 원아 목록 이름.
    //    보호자 전화 = 명부의 carer 전화 전부(B7) — 하나도 없으면 형제 대조를 못 해 내리지 않는다.
    const phones = adm?.phones?.length ? adm.phones : adm?.phone ? [adm.phone] : [];
    if (!phones.length) hit("no_phone", "보호자 전화가 없어 형제 대조를 할 수 없습니다");
    else if (phoneMatches(s.phones ?? [], phones) === false) hit("phone_mismatch", "ClassNote 보호자 전화가 그 학생의 전화와 다릅니다 — 다른 집일 수 있습니다");
    const ownName = rosterName || listName;
    // 🔴 끝 알파벳(동명이인 구분자)은 학생 이름 **전부**에서 모아 본다 — 학생 '이지아A' + ClassNote 이름 '이지아'(알파벳 없음)이면
    //    sameName('이지아','이지아B')가 혼자 통과해 B11이 우회된다(리뷰 R2). 명부 이름에 알파벳이 있고 학생 쪽에도 하나라도 있는데
    //    같은 것이 없으면 다른 아이다.
    const ownSuffix = suffixOf(ownName);
    const studentSuffixes = namesOf(s).map(suffixOf).filter(Boolean);
    const suffixClash = !!ownSuffix && studentSuffixes.length > 0 && !studentSuffixes.includes(ownSuffix);
    // 학생 쪽엔 알파벳이 없는데 명부에 알파벳 X가 있고, '기본 이름+X'인 **다른** 학생이 있으면 그 학생의 원아일 수 있다(F7).
    const otherOwner = !!ownSuffix && studentSuffixes.length === 0 && [...(suffixed.get(`${baseName(ownName)}|${ownSuffix}`) ?? [])].some((id) => id !== s.id);
    if (suffixClash || otherOwner || !namesOf(s).some((n) => sameName(n, ownName)))
      hit("name_mismatch", `원아 이름 '${ownName || "?"}'이(가) 학생 '${s.name}'과 같지 않습니다 — 형제 계정이 잘못 이어졌을 수 있어 내리지 않습니다`);
    // ⑧ 남은 배정 모양 — 전체방과 본인 1인 보드 `(과목)본인이름`만 남았을 때만. 반 보드·영어 반 방·그룹 보드·남의 1인 보드가 하나라도 있으면
    //    그 원아를 누가 쓰고 있을 수 있다(형제가 한 원아를 같이 쓰는 경우 등) — 1단계 해제가 먼저 뗀다(퇴소는 되돌릴 수 없다).
    //    🔴 여기서 세는 배정 = **안 떠난 배정 전부**(승인 대기 포함 — 누가 그 원아로 반 보드 가입을 요청한 것이다 · 리뷰 B5).
    //       해제 쪽 '남는 배정'(마지막 배정 가드)은 반대로 승인된 것만 센다 — 둘 다 '모르면 손대지 않는' 쪽으로 센 것이다.
    const assigned = adm?.allBoards !== undefined ? adm.allBoards : adm?.boards;
    if (!Array.isArray(assigned)) hit("boards_unknown", "그 원아의 반 배정을 읽지 못했습니다 — 남은 배정을 모르면 내리지 않습니다");
    else {
      const own = new Set(namesOf(s).map(normBoard));
      const rest = assigned.filter((x) => !wide.ids.has(Number(x.id)) && !own.has(personalOwnerName(x.name) ?? "\u0000"));
      if (rest.length) {
        const names = rest.slice(0, 3).map((x) => x.name || `#${x.id}`).join(", ") + (rest.length > 3 ? ` 외 ${rest.length - 3}개` : "");
        hit("board_remaining", `반 배정이 남아 있습니다(${names}) — 해제가 먼저입니다`);
      }
    }
    // ④ 퇴원하지 않은 학생의 원아일 수 있다(반 보드 자동 해제 ①과 같은 판정 — 이름이 이어짐 · 그 학생의 1인 보드 · 보호자 전화가 같음(형제)).
    //    이름은 원아 이름 두 벌(명부·원아 목록) × 학생 이름 두 벌(에이와·ClassNote) 모두로 본다.
    const twin = keepers.find((k) => namesOf(k).some((kn) => childNameSet.some((cn) => childNameConsistent(kn, cn))));
    if (twin) hit("current_family_name", `퇴원하지 않은 학생 '${twin.name}'의 원아일 수 있습니다(이름이 이어짐)`);
    const owner = (adm?.boardNames ?? []).map(personalOwnerName).find((n) => n && keeperNames.has(n));
    if (owner) hit("current_family_board", `퇴원하지 않은 학생 '${owner}'의 1인 보드에 있는 원아입니다`);
    const sib = phones.length ? keepers.find((k) => phoneMatches(k.phones ?? [], phones) === true) : null;
    if (sib) hit("current_family_phone", `퇴원하지 않은 학생 '${sib.name}'와 보호자 전화가 같습니다(형제일 수 있어 내리지 않습니다)`);
    if (reasons.length) {
      excluded.push({ childId, childName, studentId: s.id, studentName: s.name, days, code: reasons[0].code, codes: reasons.map((r) => r.code), why: reasons[0].why });
      continue;
    }
    candidates.push(row);
  }
  // 한 학생의 원아(학부모·학생 두 계정 등)는 함께 판정한다 — 한 계정이 보류되면(형제 전화 · 돈 흔적 …) 나머지도 두고 사람이 본다
  // (2026-11-03 드라이런: 박예서의 두 계정 중 보호자 전화가 적힌 쪽만 형제 가드에 걸리고 전화가 빈 쪽은 대상에 올랐다).
  const heldStudents = new Set(excluded.map((x) => x.studentId).filter(Boolean));
  const kept = [];
  for (const c of candidates) {
    if (heldStudents.has(c.studentId))
      excluded.push({ childId: c.childId, childName: c.childName, studentId: c.studentId, studentName: c.studentName, days: c.days, code: "sibling_account_held", codes: ["sibling_account_held"], why: "같은 학생의 다른 원아 계정이 보류돼 함께 둡니다" });
    else if (sharedOwners.has(c.studentId))
      excluded.push({ childId: c.childId, childName: c.childName, studentId: c.studentId, studentName: c.studentName, days: c.days, code: "sibling_account_held", codes: ["sibling_account_held"], why: "같은 학생의 다른 원아 계정이 퇴원하지 않은 학생에게도 이어져 있어 함께 둡니다" });
    else kept.push(c);
  }
  kept.sort((a, b) => b.days - a.days || a.childId - b.childId);
  return { candidates: kept, excluded, waiting, unlinked, centerWide: wide.basis, centerWideIds: [...wide.ids] };
}

/**
 * ⑦ 그 원아의 글(실행 직전 · ClassNote) — 최근 45일 안에 글이 있으면 제외 · 목록이 불완전하면 제외.
 * @param {{ complete:boolean, posts:Array<{created?:string, date_written?:string}> }} got
 * @returns {{ ok:true, lastPostAt:string|null, count:number } | { ok:false, code:string, why:string }}
 */
export function checkChildPosts(got, today) {
  if (!got?.complete) return { ok: false, code: "posts_unknown", why: "그 원아의 글 목록을 끝까지 받지 못했습니다 — 백업할 수 없어 내리지 않습니다" };
  const kst = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : null);
  const last = (got.posts ?? []).map((p) => later(kst(p.created), day(p.date_written))).reduce((a, b) => later(a, b), null);
  const d = last ? dayDiff(last, today) : null;
  if (last && d == null) return { ok: false, code: "posts_unknown", why: `마지막 글 날짜(${last})를 해석할 수 없습니다` };
  if (d != null && d < OFFBOARD_RECENT_POST_DAYS)
    return { ok: false, code: "recent_post", why: `최근 ${OFFBOARD_RECENT_POST_DAYS}일 안에 이 원아 글이 있습니다(마지막 ${last}, ${d}일 전) — 다니고 있을 수 있어 내리지 않습니다` };
  return { ok: true, lastPostAt: last, count: (got.posts ?? []).length };
}

/**
 * 실행 뒤 확인 — 재원 명부에서 **그 원아만** 빠졌고 퇴소 명부에 그 원아가 있어야 한다.
 * @returns {{ ok:true } | { ok:false, halt:boolean, why:string }}  halt = 다른 원아가 함께 사라졌다(사람이 볼 때까지 퇴원처리를 세운다)
 */
export function verifyOffboard({ before, after, left, childId }) {
  const gone = [...before].filter((id) => !after.has(id));
  const others = gone.filter((id) => Number(id) !== Number(childId));
  if (others.length) return { ok: false, halt: true, why: `퇴원처리 뒤 다른 원아 ${others.length}명이 재원 명부에서 함께 사라졌습니다 — 멈춥니다(사람 확인)` };
  if (after.has(Number(childId))) return { ok: false, halt: false, why: "퇴원처리 요청 뒤에도 재원 명부에 그대로 있습니다(ClassNote가 처리하지 않음)" };
  if (!left.has(Number(childId))) return { ok: false, halt: false, why: "재원 명부에서는 빠졌는데 퇴소 명부에서 찾지 못했습니다(확인 필요)" };
  return { ok: true };
}

/** 숫자·전화 꼴 아이디(학부모가 전화번호로 가입한 경우) — 백업에 싣지 않는다(B8). */
const phoneLike = (s) => /^[+\d][\d\s\-().]*$/.test(String(s ?? "").trim());
/** 첨부는 **주소·이름·크기 메타만** — 원본 파일은 받지 않는다(B8 · 2026-11-03 실측 칸: original_file_name·file_size·original/high). */
const attachMeta = (a) => (a && typeof a === "object" ? { name: a.original_file_name ?? null, size: a.file_size ?? null, url: a.original ?? a.high ?? a.large ?? null } : null);
const attachList = (xs) => (Array.isArray(xs) ? xs.map(attachMeta).filter(Boolean) : []);

/**
 * 백업 본문(JSON) — 되돌릴 때 필요한 것(학부모 재초대 대상)과 그 원아의 글·댓글. 🔴 보호자 전화·주소·병력은 싣지 않는다 · 학부모 아이디가
 * 숫자·전화 꼴이면 뺀다 · 첨부는 메타만 · 댓글 작성자는 이름·종류만(아이디 없음).
 * @param {{ child:{id:number,name:string}, student:{id:string,name:string}, detail:any, posts:any[], comments?:Map<number,any[]>, baseDate:string, days:number, at:string, tenant:string, centerId?:number }} a
 *   comments = 글 번호 → 그 글의 댓글 전부(`fetchPostComments` — 댓글이 있는 글만)
 */
export function buildOffboardBackup({ child, student, detail, posts, comments = new Map(), baseDate, days, at, tenant, centerId = null }) {
  const parent = detail?.parent ?? null;
  const ours = (e) => centerId == null || e?.center_id == null || Number(e.center_id) === Number(centerId); // 남의 학원 배정은 싣지 않는다
  return {
    kind: "classnote-offboard-backup",
    version: 2,
    at,
    tenantId: tenant,
    child: { id: child.id, name: child.name, birth: detail?.date_birth ?? null },
    parent: parent ? { id: parent.id ?? null, name: parent.name ?? null, username: phoneLike(parent.username) ? null : parent.username ?? null, type: parent.type ?? null } : null,
    student: { id: student.id, name: student.name, baseDate, days },
    enrollments: (detail?.enrollment ?? []).filter((e) => !e.removed_child && ours(e)).map((e) => ({ boardId: e.belong_to_class ?? null, boardName: e.class_name ?? null, approved: e.is_approved === true })),
    posts: (posts ?? []).map((p) => ({
      id: p.id, created: p.created ?? null, dateWritten: p.date_written ?? null, authorName: p.author_name ?? null, boardId: p.cls ?? null, boardName: p.class_name ?? null,
      content: p.content ?? "", attachedImages: attachList(p.attached_images), attachedFiles: attachList(p.attached_files), attachedVideo: attachMeta(p.attached_video),
      numComments: p.num_comments ?? 0, reactions: p.reaction_count ?? 0, readByParent: p.read_by_parent?.date_read ?? null,
      comments: (comments.get(Number(p.id)) ?? []).map((c) => ({
        id: c.id, created: c.created ?? null, authorName: c.author_name ?? c.author?.name ?? null, authorType: c.author?.type ?? null,
        content: c.content ?? "", emoticon: c.emoticon_content ?? null,
        attachedImages: attachList(c.attached_images), attachedFiles: attachList(c.attached_files), attachedVideo: attachMeta(c.attached_video),
      })),
    })),
  };
}

/** 댓글을 다 받았나 — 댓글이 있다고 적힌 글(`num_comments > 0`)마다 목록을 받아야 한다(못 받으면 그 원아는 내리지 않는다 · B8). */
export function commentsComplete(posts, got) {
  for (const p of posts ?? []) if (Number(p.num_comments) > 0 && !got?.complete?.has?.(Number(p.id))) return false;
  return true;
}

/** 백업에 학부모(재초대 대상)가 있나 — 없으면 내리지 않는다(되돌릴 길을 모르는 채로 시작하지 않는다 · 7/30 G10). */
export const backupRestorable = (b) => !!(b?.parent?.id && (b.parent.name || b.parent.username));

/**
 * 한 집(같은 학생의 원아 계정 묶음) 중 일부만 내리고 멈췄을 때의 보고서 문구(리뷰 B12) — 다 내렸거나 하나도 못 내렸으면 null.
 * @param {{ studentName:string, total:number, done:number }} a
 */
export const partialFamilyText = ({ studentName, total, done }) =>
  done > 0 && done < total ? `한 집 중 일부만 처리: ${studentName} — 원아 계정 ${total}개 중 ${done}개만 퇴원처리했습니다(나머지는 ClassNote에서 확인해 주세요)` : null;
