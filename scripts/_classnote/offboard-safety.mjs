/**
 * scripts/_classnote/offboard-safety.mjs — ClassNote **퇴원처리 안전 판정**(순수, 무거운 의존성 0).
 *
 * 무엇을 판정하나: "이 ClassNote 원아를 퇴원처리(명부에서 내림)해도 되는가."
 * 발송 게이트(board-safety.mjs)와 **정반대 방향의 위험**을 막는다 — 발송은 "남의 집에 보내는 것"이 사고고,
 * 퇴원처리는 **"다니는 집을 끊는 것"** 이 사고다.
 *
 * 🔴 **이 작업은 실질 비가역이다.** ERP 퇴원처리를 하면 원아가 센터 명부에서 빠지고(실측: 처리된 87명 중
 * 명부 잔존 2명 = 2%), 되돌리려면 **학부모 재초대 + 재가입**이 필요한데 그건 자동화가 불가능한 구간이다.
 * 그래서 모든 가드는 **모르면 제외**(fail-closed)다. 안 내리면 현상 유지(무해)고, 잘못 내리면 복구 불가다.
 * ⚠️ **가드를 완화하지 말 것.** 특히 예외 화이트리스트를 만들지 말 것 — 발송은 "못 보내면 손해"라 사람
 * 탈출구가 필요하지만, 퇴원처리는 안 해도 손해가 없어서 탈출구가 곧 사고 경로다.
 *
 * ⚠️ 순수 유지 — playwright·postgres import 금지(테스트가 끌어오면 안 됨). 사실 수집은 호출부(스캐너) 책임.
 * 단위테스트 = offboard-safety.test.mjs.
 */
import { expectedBirthYear } from "./board-safety.mjs";

/** 생년 대조 허용 오차(년) — board-safety와 동일 근거(조기입학·유급·학부모 오입력 흡수). */
const BIRTH_YEAR_TOLERANCE = 1;

/** 학생모드 보드명 = `(과목)이름`. 퇴원처리는 학생 단위라 과목과 무관하게 그 학생 소유 보드를 전부 본다. */
export const STUDENT_BOARD_PREFIXES = ["(수학)", "(영어)"];

/**
 * 그 학생이 **소유한** 보드명 — ⚠️ **활성 수강과 무관하게** 유효이름으로만 만든다.
 * provision의 기대집합(재원 + 활성 수강)을 쓰면 퇴원생은 기대 보드가 0개라 잔존 보드가 전부
 * `foreign_board`로 오차단된다(오탐 100%).
 */
export function ownedBoardNames(effectiveName) {
  const n = String(effectiveName ?? "").trim();
  if (!n) return [];
  return STUDENT_BOARD_PREFIXES.map((p) => `${p}${n}`);
}

/**
 * `YYYY-MM-DD` 두 날짜의 **일수 차**(to − from). date-only 산술이라 타임존이 개입하지 않는다.
 * ⚠️ `new Date("2026-07-30")`처럼 파싱하면 UTC 자정으로 해석된 뒤 로컬 변환에서 하루가 밀린다 —
 * 그래서 문자열을 직접 쪼개 `Date.UTC`로 **양쪽 모두** 같은 방식으로 만든다(윤년은 Date.UTC가 처리).
 * 형식이 아니거나 실존하지 않는 날짜면 null(= 계산 불가).
 */
export function dayDiff(fromISO, toISO) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    // 2026-02-30 같은 비실존 날짜는 롤오버되므로 되돌려 확인한다.
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return t;
  };
  const a = p(fromISO);
  const b = p(toISO);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * 판정 코드 — **우선순위 순서**(위가 우선). `primaryCode`는 이 순서로 뽑으므로 구현 순서·객체 키 순서에
 * 결과가 좌우되지 않는다. `action` 우선순위는 **exclude > hold > offboard**.
 *
 * `exclude` = "자동처리 제외"이며 **영구 판정이 아니다** — 매핑·확인·재조회로 풀릴 수 있다(성격 열 참조).
 */
export const GUARDS = [
  // ── exclude ───────────────────────────────────────────────────────────────
  { code: "enrolled", action: "exclude" }, //           정상: 재원이거나 그 과목을 계속 다님(과목 이탈 포함)
  { code: "no_eywa_match", action: "exclude" }, //      eywa에 대응 학생 없음(테스트·퇴사강사 보드 등)
  { code: "ambiguous_forward", action: "exclude" }, //  이 원아에 eywa 학생이 2명+ 걸림
  { code: "ambiguous_reverse", action: "exclude" }, //  그 학생에 원아가 2명+ 걸림
  { code: "identity_unknown", action: "exclude" }, //   생년·학년 없음/불일치, 원아 상세 조회 실패
  { code: "erp_link_unknown", action: "exclude" }, //   명부엔 활성인데 같은 이름 ERP 행에 out_date(상태 모순)
  { code: "foreign_board", action: "exclude" }, //      남의 개인 보드에 소속(잔존 가족 의심)
  { code: "shared_board", action: "exclude" }, //       소유 보드에 가족 2+ (남의 집을 같이 내림)
  { code: "input_inconsistent", action: "exclude" }, // 보드 인원 ↔ 원아 소속이 모순 / 보드명 중복
  { code: "members_unknown", action: "exclude" }, //    보드 연결 가족 수 미확인(API 변경 의심)
  { code: "board_scan_failed", action: "exclude" }, //  보드 전건 조회 실패
  { code: "snapshot_incomplete", action: "exclude" }, // 복구용 스냅샷(부모 식별자) 미확보
  // ── hold ──────────────────────────────────────────────────────────────────
  { code: "grace", action: "hold" }, //                 유예 기간 미경과(시간이 지나면 자동 해소)
  { code: "recent_activity", action: "hold" }, //       최근 발송·재등록·학부모 활동 신호
];

const ACTION_RANK = { exclude: 3, hold: 2, offboard: 1 };

/**
 * 퇴원처리 후보 판정(순수). **평가 가능한 모든 가드를 평가한 뒤** 우선순위로 확정한다.
 *
 * ⚠️ "모든 가드"가 아니라 **"수집된 사실로 평가 가능한 가드 전체"** 다. 스캐너는 비용 때문에 2-pass로
 * 사실을 모으므로(값싼 가드로 대부분 걸러낸 뒤 남은 소수만 원아 상세 조회), 1-pass 단계에선 I5류를
 * 평가할 수 없다. 그 사실을 숨기지 않고 `notEvaluatedCodes`·`factsComplete`로 **드러낸다** —
 * 중첩 집계는 `factsComplete === true`인 행만 써야 통계가 거짓말을 하지 않는다.
 * ⚠️ 그래서 `hold`도 2-pass를 통과해야 한다(호출부 계약): 나중에 `foreign_board`가 드러나면
 * exclude가 hold를 이겨야 하는데, hold에서 수집을 끊으면 위험이 hold 뒤에 숨는다.
 *
 * @param {object} facts
 * @param {{id?:number, name?:string, birth?:string|null, parentId?:number|null, parentName?:string|null, parentUsername?:string|null}} facts.child
 * @param {number} facts.matchedStudentCount  이 원아에 매칭된 eywa 학생 **행 수**(퇴원·예비 포함 전 학생 우주)
 * @param {number} facts.reverseMatchCount    그 학생에 매칭된 원아 **행 수**
 * @param {null|{id:string, name:string, grade:string|null, status:string, activeSubjects:string[], withdrawnAt:string|null}} facts.student
 * @param {{status:"ok"|"failed"|"not_collected", enrollments?:Array<{belong_to_class:number, removed_child?:boolean, class_name?:string, isStudentBoard?:boolean}>}} facts.childDetail
 *   `isStudentBoard` = 그 보드가 `(과목)이름` **1인 보드**인가(호출부가 보드 ID로 해석). false면 그룹반이라
 *   foreign 판정에서 제외하고, undefined(판별 불가)면 fail-closed로 foreign 취급한다.
 * @param {{scanComplete:boolean, boards:Array<{id:number,name:string,children:number|null}>, nameConflicts?:number}} facts.ownedBoards
 * @param {number[]} [facts.broadcastBoardIds]  `[ALL] …전체방` 등 학생 개인 보드가 아닌 공용 보드 id
 * @param {null|{activeRows:number, outRows:number}} facts.erpNameEvidence
 * @param {{lastReportSentAt?:string|null, recentEnrollmentStart?:string|null, inboundNameHit?:boolean}} [facts.activity]
 * @param {string} facts.today  KST `YYYY-MM-DD`
 * @param {number} facts.schoolYear
 * @param {number} facts.graceDays
 * @returns {{action:"offboard"|"hold"|"exclude", primaryCode:string, matchedCodes:string[],
 *            notEvaluatedCodes:string[], factsComplete:boolean, reason:string, snapshot:object|null}}
 */
export function evaluateOffboardCandidate(facts) {
  const {
    child = {},
    matchedStudentCount,
    reverseMatchCount,
    student = null,
    childDetail = { status: "not_collected" },
    ownedBoards = { scanComplete: false, boards: [] },
    broadcastBoardIds = [],
    erpNameEvidence = null,
    activity = {},
    today,
    schoolYear,
    graceDays,
  } = facts ?? {};

  /** code → {hit, reason} | null(평가 불가) */
  const verdicts = new Map();
  const set = (code, hit, reason) => verdicts.set(code, hit ? { hit: true, reason } : { hit: false });
  const skip = (code) => verdicts.set(code, null);

  // ── 카디널리티(I3·I4) — 다른 모든 판정의 전제 ────────────────────────────────
  if (typeof matchedStudentCount !== "number") {
    skip("no_eywa_match");
    skip("ambiguous_forward");
  } else {
    set("no_eywa_match", matchedStudentCount === 0, "eywa에 대응하는 학생이 없습니다(테스트 계정·퇴사 강사·외부 보드일 수 있습니다)");
    set(
      "ambiguous_forward",
      matchedStudentCount > 1,
      `이 원아에 eywa 학생 ${matchedStudentCount}명이 걸립니다 — 누구인지 확정할 수 없습니다(동명이인·접미사)`,
    );
  }
  if (typeof reverseMatchCount !== "number") skip("ambiguous_reverse");
  else
    set(
      "ambiguous_reverse",
      reverseMatchCount > 1,
      `그 학생에 ClassNote 원아 ${reverseMatchCount}명이 걸립니다 — 어느 원아를 내려야 할지 확정할 수 없습니다`,
    );

  // ── 재원 신호(가장 중요한 정상 케이스) ──────────────────────────────────────
  if (!student) skip("enrolled");
  else {
    // ⚠️ `activeSubjects`는 **발송 opt-in 과목이 아니라 전 과목**이다. 퇴원처리는 원아를 센터 명부에서
    // 내리는 것이라 "수학 발송은 안 하지만 영어를 다니는 학생"도 내리면 안 된다(계획서보다 조인 것).
    const active = student.activeSubjects ?? [];
    const isWithdrawn = student.status === "withdrawn";
    set(
      "enrolled",
      !isWithdrawn || active.length > 0,
      !isWithdrawn
        ? `eywa 학생 상태가 '퇴원'이 아닙니다(${student.status})`
        : `eywa에선 퇴원인데 살아 있는 수강이 있습니다(${active.join(", ")}) — 명부에서 내리면 그 과목 보드까지 끊깁니다`,
    );
  }

  // ── 신원(I2) — 생년 ↔ 학년 역산 대조 ────────────────────────────────────────
  if (childDetail?.status === "failed") {
    set("identity_unknown", true, "원아 상세 조회에 실패해 신원을 확인할 수 없습니다(재시도 대상)");
  } else if (!student) {
    skip("identity_unknown");
  } else {
    const want = expectedBirthYear(student.grade, schoolYear);
    const got = Number(String(child.birth ?? "").slice(0, 4));
    if (want == null) set("identity_unknown", true, `eywa 학년(${student.grade ?? "없음"})을 알 수 없어 이 원아가 그 학생인지 확인할 수 없습니다`);
    else if (!Number.isFinite(got) || got < 1900) set("identity_unknown", true, "원아 생년월일이 없어 이 원아가 그 학생인지 확인할 수 없습니다");
    else
      set(
        "identity_unknown",
        Math.abs(got - want) > BIRTH_YEAR_TOLERANCE,
        `생년 불일치 — eywa ${student.grade}(${want}년생 기대)인데 원아는 ${got}년생입니다(다른 아이일 수 있습니다)`,
      );
  }

  // ── ERP 이름 증거 — **제외 방향으로만** 쓴다 ─────────────────────────────────
  // ERP 명부 행에는 원아 ID·생년·연락처가 없어(상세 404·사진키 불일치) "그 행이 이 아이"라고 단정할 수 없다.
  // 그래서 out_date 행의 존재를 "이미 처리됨(할 일 없음)"으로 읽지 않고 **상태 모순 = 사람이 볼 것**으로 읽는다.
  if (!erpNameEvidence) skip("erp_link_unknown");
  else
    set(
      "erp_link_unknown",
      (erpNameEvidence.outRows ?? 0) > 0,
      `ClassNote 명부엔 활성인데 같은 이름의 ERP 행 ${erpNameEvidence.outRows}건에 퇴원일이 있습니다 — 같은 아이인지 알 수 없어(연결 키 없음) 사람이 확인해야 합니다`,
    );

  // ── 보드 안전(I5·공유·정합성) ───────────────────────────────────────────────
  const boards = ownedBoards?.boards ?? [];
  const scanOk = ownedBoards?.scanComplete === true;
  set("board_scan_failed", !scanOk, "ClassNote 보드 전건 조회에 실패했습니다(재시도 대상)");

  if (!scanOk) {
    skip("members_unknown");
    skip("shared_board");
  } else {
    set(
      "members_unknown",
      boards.some((b) => b.children == null),
      "보드에 연결된 가족 수를 읽지 못했습니다(ClassNote API 변경 의심) — 확인 전엔 내리지 않습니다",
    );
    const shared = boards.filter((b) => (b.children ?? 0) >= 2);
    set(
      "shared_board",
      shared.length > 0,
      `보드에 가족이 2명 이상 연결돼 있습니다(${shared.map((b) => `${b.name} ${b.children}가족`).join(", ")}) — 내리면 남의 집도 함께 끊깁니다`,
    );
  }

  const detailOk = childDetail?.status === "ok";
  const ownedIds = new Set(boards.map((b) => b.id));
  const allowedIds = new Set([...ownedIds, ...(broadcastBoardIds ?? [])]);
  const live = detailOk ? (childDetail.enrollments ?? []).filter((e) => !e.removed_child) : [];

  if (!detailOk || !scanOk) skip("foreign_board");
  else {
    // ⚠️ **그룹반 소속은 foreign이 아니다.** 잔존 가족의 증거는 "**다른 학생의 1인 보드**에 붙어 있는 것"이다
    // (admin-core `hasForeignStudentBoard`와 같은 기준). 영어 그룹반(`[EIE] …`)·`[ALL] 전체방` 같은 다인
    // 보드는 그냥 그룹 멤버십이라, 이걸 foreign으로 세면 정상 학생이 통째로 오차단된다(실측: 그렇게 세면 64건).
    // `isStudentBoard`는 호출부가 **보드 ID로** 해석해 넣는다(이름 비교로 판단하지 않는다).
    // ⚠️ 판별 불가(보드 목록에 없는 id = undefined)는 **foreign으로 취급**한다 — 모르면 안 내린다.
    const foreign = live.filter((e) => !allowedIds.has(e.belong_to_class) && e.isStudentBoard !== false);
    set(
      "foreign_board",
      foreign.length > 0,
      `이 원아가 다른 학생의 개인 보드에 소속돼 있습니다(${foreign
        .map((e) => e.class_name ?? `보드 ${e.belong_to_class}`)
        .join(", ")}) — 잔존 가족일 수 있습니다`,
    );
  }

  if (!detailOk || !scanOk) skip("input_inconsistent");
  else {
    const memberIds = new Set(live.map((e) => e.belong_to_class));
    const conflicts = ownedBoards?.nameConflicts ?? 0;
    // 소유 보드에 가족이 1명 있는데 그게 이 원아가 아니다 / 이 원아가 소속인데 보드 인원은 0이다 → 사실이 어긋난다.
    const occupiedByOther = boards.filter((b) => (b.children ?? 0) > 0 && !memberIds.has(b.id));
    const emptyButMember = boards.filter((b) => b.children === 0 && memberIds.has(b.id));
    const bad = [...occupiedByOther, ...emptyButMember];
    set(
      "input_inconsistent",
      conflicts > 0 || bad.length > 0,
      conflicts > 0
        ? `같은 이름의 보드가 여러 개라(중복 ${conflicts}건) 대상을 특정할 수 없습니다`
        : `보드 인원과 원아 소속이 어긋납니다(${bad.map((b) => `${b.name} ${b.children}가족`).join(", ")}) — 확인이 필요합니다`,
    );
  }

  // ── 복구 스냅샷(G10) — 잘못 내렸을 때 "누구에게 재초대할지"가 없으면 시작하지 않는다 ──
  const snapshot =
    child?.id != null
      ? {
          childId: child.id,
          childName: child.name ?? null,
          childBirth: child.birth ?? null,
          parentId: child.parentId ?? null,
          parentName: child.parentName ?? null,
          parentUsername: child.parentUsername ?? null,
          // ⚠️ 빈 배열도 **완전한 스냅샷**이다 — 보드 없이 명부에만 남은 잔존자가 이 경로로 걸린다.
          boardIds: scanOk ? boards.map((b) => b.id) : null,
          boardNames: scanOk ? boards.map((b) => b.name) : null,
          studentId: student?.id ?? null,
        }
      : null;
  set(
    "snapshot_incomplete",
    !snapshot || snapshot.parentId == null || !(snapshot.parentName || snapshot.parentUsername) || snapshot.boardIds == null,
    "되돌릴 때 필요한 학부모 식별 정보를 확보하지 못했습니다(재초대 대상을 알 수 없으면 시작하지 않습니다)",
  );

  // ── 유예(45일) ──────────────────────────────────────────────────────────────
  if (!student) skip("grace");
  else {
    const days = dayDiff(student.withdrawnAt, today);
    if (days == null)
      set("grace", true, "퇴원일이 없거나 형식이 올바르지 않아 유예 경과를 확인할 수 없습니다");
    else
      set(
        "grace",
        days < graceDays,
        `퇴원 후 ${days}일 — 유예 ${graceDays}일이 지나지 않았습니다(실측: 그 과목을 다시 등록한 사례가 전부 30일 내)`,
      );
  }

  // ── 최근 활동 ───────────────────────────────────────────────────────────────
  const sig = [];
  if (activity?.lastReportSentAt) sig.push(`최근 발송 ${activity.lastReportSentAt}`);
  if (activity?.recentEnrollmentStart) sig.push(`최근/예정 수강 시작 ${activity.recentEnrollmentStart}`);
  if (activity?.inboundNameHit) sig.push("최근 학부모 글·댓글 알림(이름 일치)");
  set("recent_activity", sig.length > 0, `아직 살아 있는 신호가 있습니다(${sig.join(", ")})`);

  // ── 확정: 평가된 것만 모아 우선순위로 ───────────────────────────────────────
  const matchedCodes = [];
  const notEvaluatedCodes = [];
  for (const g of GUARDS) {
    const v = verdicts.get(g.code);
    if (v === null || v === undefined) notEvaluatedCodes.push(g.code);
    else if (v.hit) matchedCodes.push(g.code);
  }

  let action = "offboard";
  let primaryCode = "ok";
  let reason = "전 가드 통과 — 승인 대상입니다";
  // GUARDS는 우선순위 순서이고 action 랭크가 더 높을 때만 갈아치우므로, **같은 랭크에선 먼저 나온 코드가
  // 이긴다**(구현 순서·객체 키 순서 무관). exclude가 목록 뒤에 있어도 hold를 이긴다.
  for (const g of GUARDS) {
    const v = verdicts.get(g.code);
    if (!v?.hit) continue;
    if (ACTION_RANK[g.action] > ACTION_RANK[action]) {
      action = g.action;
      primaryCode = g.code;
      reason = v.reason;
    }
  }

  return {
    action,
    primaryCode,
    matchedCodes,
    notEvaluatedCodes,
    factsComplete: notEvaluatedCodes.length === 0,
    reason,
    snapshot,
  };
}
