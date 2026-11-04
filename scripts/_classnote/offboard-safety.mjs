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

/**
 * 🔴 **보호 계정 — 어떤 이유로도 정리 대상이 되면 안 되는 학생/보드.**
 *
 * 원장 지적(2026-07-30): *"학원이 퇴원시켜버리면 다시 가입시켜야 되잖아."* — 정확하다. `학원이`는
 * **유일한 실발송 E2E 테스트 계정**인데(§6), 명부에서 내리면 복구에 **학부모 재초대 + 재가입**이 필요해
 * (자동화 불가) 앞으로의 모든 ClassNote 발송 검증 수단을 잃는다.
 *
 * ⚠️ **우연한 제외에 기대지 말 것**: 실측상 `학원이`는 지금 '전화 불일치'로만 걸러지고 있어서,
 * aywa에 전화를 채워 넣는 순간 **삭제 후보로 올라온다**. 그래서 최우선 순위의 명시적 가드로 못박는다.
 */
export const PROTECTED_STUDENT_NAMES = ["학원이", "학원삼", "학원사", "학원오"];

/** 보호 대상인가 — 보드명 `(과목)이름`·학생 유효이름 어느 쪽으로 넘겨도 판정된다. */
export function isProtectedName(nameOrBoard) {
  const t = String(nameOrBoard ?? "")
    .replace(/\s/g, "")
    .replace(/^\((수학|영어)\)/, "");
  return PROTECTED_STUDENT_NAMES.includes(t);
}

/**
 * 🔴 **시스템 일괄 퇴원일 — 실제 퇴원 신호가 아니다.** 이 날짜로 찍힌 학생은 **자동 퇴원처리 대상에서 제외**한다.
 *
 * 원장 지시(2026-07-30): *"7-10 대량 퇴원분을 퇴원목록에서 잡지 않도록 해줘. 그건 시스템 퇴원처리니까."*
 *
 * 실측 근거: `2026-07-10` 하루에 **119명**(다음으로 많은 날은 07-13의 12명)인데, 그들의 **수강 종료일은
 * 제각각**이다(07-03 40명·04-06 15명·05-04 8명·03-31 7명…). 즉 그날 수업이 끝난 게 아니라 **이미 끝나 있던
 * 학생들에게 일괄로 `status=withdrawn` 도장을 찍은 날**이다 → `withdrawn_at`이 **장부상 날짜**일 뿐이라
 * 유예(45일) 계산의 기준으로 쓸 수 없다(실제론 몇 달 전에 그만뒀는데 "20일 전 퇴원"으로 보인다).
 *
 * ⚠️ 이 목록에 날짜를 추가할 땐 **일괄 처리였다는 근거**(하루 건수 급증 + 수강 종료일 산포)를 함께 남길 것.
 * ⚠️ 보드 삭제(Operation A)에는 적용하지 않는다 — 그쪽은 `withdrawn_at`이 아니라 **그 과목 수강 종료 + 무게시**로
 *    판정하므로 이 장부 날짜에 의존하지 않는다.
 */
export const SYSTEM_BULK_WITHDRAWAL_DATES = [
  "2026-07-10", // 하루 119명(다음 순위 12명) · 수강 종료일은 제각각 → status 도장만 일괄
  // ⚠️ 2026-07-03: 위 119명 중 77명을 "마지막 수강 종료일"로 교정했더니 40명이 이 날짜로 몰렸다.
  //    확인해보니 `enrollments.end_date`의 최다값이 **2026-07-03(149건)** — 수강 종료일 자체가 일괄이었다.
  //    즉 교정이 **장부 날짜를 다른 장부 날짜로 옮긴 것**이었다. makeedu는 같은 학생들에게 04-30·05-06·
  //    05-07·05-13 등 제각각을 갖고 있어(결제 기반) 그쪽이 진짜다 → makeedu 대조로 다시 채운다.
  //    🔑 교훈: **"파생값이 원본보다 깨끗하다"고 가정하지 말 것.** 분포를 먼저 보라(한 날짜 뭉침 = 일괄 신호).
  "2026-07-03",
];

/** 그 퇴원일이 시스템 일괄 처리분인가. */
export function isSystemBulkWithdrawal(withdrawnAt) {
  return SYSTEM_BULK_WITHDRAWAL_DATES.includes(String(withdrawnAt ?? "").trim());
}

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
 * 전화번호 정규화 — 숫자만. 국가번호(+82)·0 접두는 뒤 10~11자리로 수렴시켜 비교한다.
 * ⚠️ 정규화 결과를 저장·로그·AI에 넘기지 말 것(대조 목적 한정).
 */
export function normalizePhone(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return "";
  const t = d.startsWith("82") ? `0${d.slice(2)}` : d;
  return t.length >= 9 ? t.slice(-11) : "";
}

/**
 * 운영관리 명부 한 원아의 **보호자 전화 전부**(carer1~N · `math-class-boards-load` fetchAdmissions의 `phones`).
 * `phones`가 없는 옛 모양(테스트·수동 도구의 `{ phone }`)이면 그 하나만. 둘 다 없으면 빈 목록(= `phoneMatches`가 null — 대조 불가).
 * 왜 전부인가(원장 2026-11-04): 클래스노트 보호자1 = 엄마, aywa 보호자 = 아빠처럼 **같은 집의 다른 보호자**가 갈려 적히면
 * carer1만 보던 반 보드 ②·동명이인 대조가 '불일치'로 막았다(전유솔 — 보호자2에 아빠 번호를 넣어도 안 풀림).
 * 퇴원처리·반 보드 해제도 이 함수로 본다(class-board-release · classnote-offboard-plan — 한 곳만 고쳐 갈리지 않게).
 * 한계(2026-11-04 리뷰): carer2 이후에 다른 집 번호·여러 집 대표번호를 잘못 넣으면 그 번호로도 통과한다 — 이름(⑥)·생년(③)이 남은 가드다.
 * @param {{ phone?: string|null, phones?: Array<string|null|undefined> } | null | undefined} adm
 * @returns {string[]}
 */
export function carerPhones(adm) {
  if (!adm) return [];
  if (Array.isArray(adm.phones) && adm.phones.some(Boolean)) return adm.phones.filter(Boolean);
  return adm.phone ? [adm.phone] : [];
}

/** 두 전화 목록에 공통 번호가 있나(aywa parent_phone·student_phone ↔ ClassNote carer 연락처). */
export function phoneMatches(a, b) {
  const A = new Set((a ?? []).map(normalizePhone).filter(Boolean));
  const B = (b ?? []).map(normalizePhone).filter(Boolean);
  if (!A.size || !B.length) return null; // 한쪽이라도 없으면 대조 불가(= 판단 보류)
  return B.some((x) => A.has(x));
}

/**
 * 판정 코드 — **우선순위 순서**(위가 우선). `primaryCode`는 이 순서로 뽑으므로 구현 순서·객체 키 순서에
 * 결과가 좌우되지 않는다. `action` 우선순위는 **exclude > hold > offboard**.
 *
 * `exclude` = "자동처리 제외"이며 **영구 판정이 아니다** — 매핑·확인·재조회로 풀릴 수 있다(성격 열 참조).
 */
export const GUARDS = [
  // ── exclude ───────────────────────────────────────────────────────────────
  { code: "protected_account", action: "exclude" }, //  🔴 실발송 테스트 계정 등 절대 보호(최우선)
  { code: "enrolled", action: "exclude" }, //           정상: 재원이거나 그 과목을 계속 다님(과목 이탈 포함)
  { code: "system_withdrawal", action: "exclude" }, //  🔴 시스템 일괄 퇴원일(장부 날짜) — 실제 퇴원 신호 아님
  { code: "no_eywa_match", action: "exclude" }, //      aywa에 대응 학생 없음(테스트·퇴사강사 보드 등)
  { code: "ambiguous_forward", action: "exclude" }, //  이 원아에 aywa 학생이 2명+ 걸림
  { code: "ambiguous_reverse", action: "exclude" }, //  그 학생에 원아가 2명+ 걸림
  { code: "phone_mismatch", action: "exclude" }, //     ClassNote 보호자 연락처가 aywa 전화와 불일치(= 다른 집)
  { code: "identity_unknown", action: "exclude" }, //   생년·학년 없음/불일치, 원아 상세 조회 실패
  { code: "erp_link_unknown", action: "exclude" }, //   명부엔 활성인데 같은 이름 ERP 행에 out_date(상태 모순)
  { code: "foreign_board", action: "exclude" }, //      남의 개인 보드에 소속(잔존 가족 의심)
  { code: "shared_board", action: "exclude" }, //       소유 보드에 가족 2+ (남의 집을 같이 내림)
  { code: "input_inconsistent", action: "exclude" }, // 보드 인원 ↔ 원아 소속이 모순 / 보드명 중복
  { code: "members_unknown", action: "exclude" }, //    보드 연결 가족 수 미확인(API 변경 의심)
  { code: "board_scan_failed", action: "exclude" }, //  보드 전건 조회 실패
  { code: "snapshot_incomplete", action: "exclude" }, // 복구용 스냅샷(부모 식별자) 미확보
  { code: "posts_unknown", action: "exclude" }, //      보드 게시물 이력을 신뢰할 수 없음(100건 초과·조회 실패)
  // ── hold ──────────────────────────────────────────────────────────────────
  { code: "recent_billing", action: "hold" }, //        🔴 퇴원 이후의 청구·납부가 있음(= 실제로는 다니는 중일 수 있음)
  { code: "withdrawal_inconsistent", action: "hold" }, // 🔴 퇴원일보다 수강 종료일이 나중(데이터 모순)
  { code: "grace", action: "hold" }, //                 aywa 퇴원일 유예 미경과(시간이 지나면 자동 해소)
  { code: "recent_posts", action: "hold" }, //          ClassNote 보드에 최근 게시물이 있음(원장 기준 1.5개월)
  { code: "recent_any_post", action: "hold" }, //       ⭐ 그 학생의 **어떤 보드든** 최근 7일 내 게시물(원장 백스톱)
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
 * @param {number} facts.matchedStudentCount  이 원아에 매칭된 aywa 학생 **행 수**(퇴원·예비 포함 전 학생 우주)
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
    boardPosts = null,
    studentAnyPost = null,
    anyPostDays = 7,
    phone = null,
    billing = null,
    enrollmentEnd = null,
    today,
    schoolYear,
    graceDays,
  } = facts ?? {};

  /** code → {hit, reason} | null(평가 불가) */
  const verdicts = new Map();
  const set = (code, hit, reason) => verdicts.set(code, hit ? { hit: true, reason } : { hit: false });
  const skip = (code) => verdicts.set(code, null);

  // ── 🔴 보호 계정 — 다른 무엇보다 먼저(우연한 제외에 기대지 않는다) ──────────────
  set(
    "protected_account",
    isProtectedName(child?.name) || isProtectedName(student?.name),
    "보호 대상 계정입니다(실발송 테스트 계정 등) — 어떤 이유로도 명부에서 내리지 않습니다",
  );

  // ── 카디널리티(I3·I4) — 다른 모든 판정의 전제 ────────────────────────────────
  if (typeof matchedStudentCount !== "number") {
    skip("no_eywa_match");
    skip("ambiguous_forward");
  } else {
    set("no_eywa_match", matchedStudentCount === 0, "aywa에 대응하는 학생이 없습니다(테스트 계정·퇴사 강사·외부 보드일 수 있습니다)");
    set(
      "ambiguous_forward",
      matchedStudentCount > 1,
      `이 원아에 aywa 학생 ${matchedStudentCount}명이 걸립니다 — 누구인지 확정할 수 없습니다(동명이인·접미사)`,
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
        ? `aywa 학생 상태가 '퇴원'이 아닙니다(${student.status})`
        : `aywa에선 퇴원인데 살아 있는 수강이 있습니다(${active.join(", ")}) — 명부에서 내리면 그 과목 보드까지 끊깁니다`,
    );
  }

  // ── 전화 대조(최상위 신원 증거, 원장 제안 2026-07-30) ────────────────────────
  // ClassNote 운영관리가 보호자 연락처를 준다(`admissioninfos[].basic_info.carer1_phone`, 실측 472/472).
  // 이름·생년은 **추정**이지만 전화는 **그 집의 사실**이라, 같은 학년 동명이인처럼 다른 증거로 안 갈리는
  // 경우까지 갈라준다. 불일치면 다른 집이므로 즉시 제외.
  // ⚠️ 값을 로그·DB·AI에 남기지 말 것 — 이 엔드포인트엔 알레르기·병력·주소까지 함께 실려 있다(대조에만 사용).
  if (!phone || phone.checked !== true) skip("phone_mismatch");
  else set("phone_mismatch", phone.match === false, "ClassNote 보호자 연락처가 aywa에 등록된 전화와 다릅니다 — 다른 집일 수 있습니다");

  // ── 🔴 시스템 일괄 퇴원 — 장부 날짜라 자동 대상에서 뺀다(원장 지시) ──────────────
  if (!student) skip("system_withdrawal");
  else
    set(
      "system_withdrawal",
      isSystemBulkWithdrawal(student.withdrawnAt),
      `퇴원일 ${student.withdrawnAt}은 시스템 일괄 처리분입니다(그날 119명 · 수강 종료일은 제각각) — 실제 퇴원 시점이 아니라 자동 퇴원처리 대상에서 제외합니다(개별 판단은 사람이)`,
    );

  // ── 신원(I2) — 생년 ↔ 학년 역산 대조 ────────────────────────────────────────
  if (childDetail?.status === "failed") {
    set("identity_unknown", true, "원아 상세 조회에 실패해 신원을 확인할 수 없습니다(재시도 대상)");
  } else if (!student) {
    skip("identity_unknown");
  } else {
    const want = expectedBirthYear(student.grade, schoolYear);
    const got = Number(String(child.birth ?? "").slice(0, 4));
    if (want == null) set("identity_unknown", true, `aywa 학년(${student.grade ?? "없음"})을 알 수 없어 이 원아가 그 학생인지 확인할 수 없습니다`);
    else if (!Number.isFinite(got) || got < 1900) set("identity_unknown", true, "원아 생년월일이 없어 이 원아가 그 학생인지 확인할 수 없습니다");
    else
      set(
        "identity_unknown",
        Math.abs(got - want) > BIRTH_YEAR_TOLERANCE,
        `생년 불일치 — aywa ${student.grade}(${want}년생 기대)인데 원아는 ${got}년생입니다(다른 아이일 수 있습니다)`,
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

  // ── ClassNote 보드 게시물 이력(원장 기준 2026-07-30: 1.5개월 무게시면 안전장치 충분) ──────
  // ⚠️ 게시물 이력이 **불완전하면 제외**한다 — 100건 초과(next 존재)나 조회 실패면 "최근 게시물이 없다"를
  //    증명할 수 없다. 커서로 이어받으면 cls 필터가 풀려 남의 보드 글이 섞이므로 이어받지 않는다.
  if (!boardPosts) {
    skip("posts_unknown");
    skip("recent_posts");
  } else {
    set("posts_unknown", boardPosts.complete !== true, "보드 게시물 이력을 끝까지 확인하지 못했습니다(100건 초과·조회 실패) — 무활동을 증명할 수 없습니다");
    const since = boardPosts.lastPostAt ? dayDiff(boardPosts.lastPostAt, today) : null;
    if (boardPosts.lastPostAt && since == null)
      set("recent_posts", true, `마지막 게시물 날짜(${boardPosts.lastPostAt})를 해석할 수 없습니다`);
    else
      set(
        "recent_posts",
        since != null && since < graceDays,
        `ClassNote 보드에 최근 게시물이 있습니다(마지막 ${boardPosts.lastPostAt}, ${since}일 전 — 기준 ${graceDays}일)`,
      );
  }

  // ── ⭐ 최근 7일 내 "어떤 보고서라도" (원장 백스톱 2026-07-30) ───────────────────
  // 원장 원문: *"최근 7일 사이에 어떠한 보고서라도 업로드된 학생은 퇴원처리 불가로 놓으면 왠만해서는
  // 재원중인 학생이 사라지지는 않을듯."* — **과목·보드를 가리지 않고** 그 학생의 전 보드를 합산해 본다.
  // 값진 이유: 우리 수강 데이터(enrollments)가 틀려도 **ClassNote 활동 자체가 생존을 증명**하므로,
  // 다른 모든 가드가 동시에 실패해도 재원생을 명부에서 내리는 것을 막는 마지막 그물이 된다.
  // ⚠️ 보드 삭제(Operation A)에는 적용하지 않는다 — 영어 보고서가 최근이어도 그만둔 수학 보드는 지워도 된다.
  if (!studentAnyPost) skip("recent_any_post");
  else if (studentAnyPost.complete !== true) set("recent_any_post", true, "그 학생의 게시물 이력을 끝까지 확인하지 못했습니다 — 최근 활동 없음을 증명할 수 없습니다");
  else {
    const d = studentAnyPost.lastPostAt ? dayDiff(studentAnyPost.lastPostAt, today) : null;
    set("recent_any_post", d != null && d < anyPostDays, `최근 ${anyPostDays}일 내에 보고서가 올라왔습니다(마지막 ${studentAnyPost.lastPostAt}, ${d}일 전) — 재원 중일 수 있어 명부에서 내리지 않습니다`);
  }

  // ── 🔴 돈의 흔적 — 가장 강한 "실제로 다닌다" 신호 (원장 2026-07-30) ─────────────
  // 원장: *"메이크에듀가 실제 퇴원날짜와 일치할 확률이 높음. 실제 결제랑 환불을 진행하므로."*
  // 같은 논리를 aywa 청구에 적용한다. **퇴원일 이후의 청구·납부는 퇴원과 모순**이다 —
  // 실측으로 잡았다: 배한빈(퇴원 2026-04-06)에게 **2026-07 청구 + 06-30 납부**가 있었다.
  // 다른 모든 가드(활성수강 0·보고서 없음·무게시)를 통과했는데 돈만이 그가 살아있다고 말했다.
  if (!billing) skip("recent_billing");
  else {
    const wd = student?.withdrawnAt ?? null;
    const after = [];
    // 청구월(YYYY-MM)은 퇴원월과 같은 달까지는 정상(그 달 수업분) — **퇴원 다음 달부터**를 모순으로 본다.
    if (billing.lastPeriod && wd && billing.lastPeriod > wd.slice(0, 7)) after.push(`청구 ${billing.lastPeriod}`);
    if (billing.lastPaidAt && wd && billing.lastPaidAt > wd) after.push(`납부 ${billing.lastPaidAt}`);
    set("recent_billing", after.length > 0, `퇴원일(${wd}) 이후의 돈 흔적이 있습니다(${after.join(", ")}) — 실제로는 다니는 중일 수 있어 명부에서 내리지 않습니다`);
  }

  // ── 🔴 퇴원일 ↔ 수강 종료일 모순 ────────────────────────────────────────────
  // 퇴원했는데 수강이 그 뒤까지 열려 있었다면 둘 중 하나가 틀린 것이다(실측: 주상모A 퇴원 03-31 / 종료 07-03).
  if (!student || !enrollmentEnd) skip("withdrawal_inconsistent");
  else
    set(
      "withdrawal_inconsistent",
      !!student.withdrawnAt && enrollmentEnd > student.withdrawnAt,
      `퇴원일(${student.withdrawnAt})보다 수강 종료일(${enrollmentEnd})이 나중입니다 — 어느 쪽이 사실인지 확인이 필요합니다`,
    );

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

// ─────────────────────────────────────────────────────────────────────────────
// Operation A — **보드 삭제 + 배정 해제**(보드 단위, 과목별)
//
// 원장 지시(2026-07-30): *"두 과목 이상 수강하다가 한 과목을 퇴원한 경우 반 삭제 및 반 배정해제하고
// 퇴원처리는 하면 안 됨. 여전히 다른 수업에는 배정되어 있어야 하기 때문."*
//
// 그래서 두 작업의 자격이 다르다:
//   · 보드 삭제·배정 해제 = **그 과목**을 그만뒀으면 가능(전과목 퇴원이든 일부 과목이든)
//   · 명부 퇴원처리      = **전과목 퇴원**만 (evaluateOffboardCandidate가 담당)
// 이 함수는 앞의 것만 판정한다. `alsoOffboard`는 "이 학생은 전과목 퇴원이라 명부 퇴원처리도 대상"이라는 힌트다.
// ─────────────────────────────────────────────────────────────────────────────

export const RELEASE_GUARDS = [
  { code: "protected_account", action: "exclude" }, //  🔴 실발송 테스트 계정 등 절대 보호(최우선)
  // ⚠️ **`subject_active`가 그다음** — "정상, 대상 아님"을 먼저 치워야 목록이 사실을 말한다. 이걸 뒤에 두면
  //    활발히 수강 중인 학생 33건이 "전화 불일치"로 헤드라인이 잡혀(실측) 원장이 엉뚱한 걸 확인하게 된다.
  //    (Op B에서 `enrolled`를 1순위로 둔 것과 같은 원칙.)
  { code: "subject_active", action: "exclude" }, //    그 과목을 아직 수강 중 = 살아있는 보드
  { code: "no_eywa_match", action: "exclude" }, //     보드명 ↔ aywa 학생 매칭 실패(테스트·퇴사강사 보드)
  { code: "ambiguous", action: "exclude" }, //         보드명에 aywa 학생 2명+ (전화로도 안 갈림)
  { code: "phone_mismatch", action: "exclude" }, //    보호자 연락처 불일치 = 다른 집
  { code: "shared_board", action: "exclude" }, //      가족 2+ = 남의 집까지 끊긴다
  { code: "members_unknown", action: "exclude" }, //   연결 가족 수 미확인(API 변경 의심)
  { code: "posts_unknown", action: "exclude" }, //     게시물 이력 불완전 = 무활동을 증명 못 함
  { code: "recent_billing", action: "hold" }, //       🔴 최근 수납·청구가 있음 = 다니는 중일 수 있다(원장 지시)
  { code: "recent_posts", action: "hold" }, //         최근 게시물 있음(원장 기준 45일)
  { code: "teacher_linked", action: "hold" }, //       교사 연결 있음 → ClassNote는 교사 있으면 반 삭제 불가
];

/**
 * 보드 1개에 대한 삭제·배정해제 판정(순수).
 *
 * @param {object} p
 * @param {{id:number,name:string,children:number|null}} p.board
 * @param {number} p.matchedStudentCount  보드 base 이름 ↔ aywa 학생 **정확 일치** 수(전화 대조로 좁힌 뒤)
 * @param {null|{id:string,name:string,status:string,subjectActive:boolean,allSubjectsEnded:boolean}} p.student
 * @param {null|{checked:boolean, match:boolean|null}} p.phone
 * @param {null|{complete:boolean, count:number, lastPostAt:string|null}} p.posts
 * @param {number} p.teachers
 * @param {string} p.today  KST YYYY-MM-DD
 * @param {number} p.dormantDays  무게시 기준(원장: 45일)
 * @returns {{action:"release"|"hold"|"exclude", primaryCode:string, matchedCodes:string[],
 *            notEvaluatedCodes:string[], factsComplete:boolean, reason:string, alsoOffboard:boolean}}
 */
export function evaluateBoardRelease({
  board,
  matchedStudentCount,
  student,
  phone,
  posts,
  teachers,
  today,
  dormantDays,
  studentAnyPost = null,
  anyPostDays = 7,
  billing = null,
  billingDays = 45,
}) {
  const verdicts = new Map();
  const set = (code, hit, reason) => verdicts.set(code, hit ? { hit: true, reason } : { hit: false });
  const skip = (code) => verdicts.set(code, null);

  set(
    "protected_account",
    isProtectedName(board?.name) || isProtectedName(student?.name),
    "보호 대상 계정의 보드입니다(실발송 테스트 계정 등) — 삭제·배정해제하지 않습니다",
  );

  if (typeof matchedStudentCount !== "number") {
    skip("no_eywa_match");
    skip("ambiguous");
  } else {
    set("no_eywa_match", matchedStudentCount === 0, "aywa에 대응하는 학생이 없습니다(테스트·퇴사 강사·외부 보드일 수 있습니다)");
    set("ambiguous", matchedStudentCount > 1, `보드명에 aywa 학생 ${matchedStudentCount}명이 걸립니다 — 전화로도 갈리지 않아 확정할 수 없습니다`);
  }

  if (!phone || phone.checked !== true) skip("phone_mismatch");
  else set("phone_mismatch", phone.match === false, "ClassNote 보호자 연락처가 aywa 전화와 다릅니다 — 다른 집일 수 있습니다");

  if (!student) skip("subject_active");
  else set("subject_active", student.subjectActive === true, "이 학생이 그 과목을 아직 수강 중입니다 — 살아있는 보드입니다");

  const fam = board?.children;
  set("members_unknown", fam == null, "연결 가족 수를 읽지 못했습니다(ClassNote API 변경 의심)");
  set("shared_board", (fam ?? 0) >= 2, `이 보드에 가족이 ${fam}명 연결돼 있습니다 — 배정을 해제하면 남의 집도 함께 끊깁니다`);

  if (!posts) {
    skip("posts_unknown");
    skip("recent_posts");
  } else {
    set("posts_unknown", posts.complete !== true, "게시물 이력을 끝까지 확인하지 못했습니다(100건 초과·조회 실패) — 무활동을 증명할 수 없습니다");
    const since = posts.lastPostAt ? dayDiff(posts.lastPostAt, today) : null;
    if (posts.lastPostAt && since == null) set("recent_posts", true, `마지막 게시물 날짜(${posts.lastPostAt})를 해석할 수 없습니다`);
    else
      set(
        "recent_posts",
        since != null && since < dormantDays,
        `최근 게시물이 있습니다(마지막 ${posts.lastPostAt}, ${since}일 전 — 기준 ${dormantDays}일)`,
      );
  }

  set("teacher_linked", (teachers ?? 0) >= 1, `이 보드에 교사가 ${teachers}명 연결돼 있습니다 — ClassNote는 교사가 있으면 반을 삭제할 수 없습니다(UI에서 먼저 해제)`);

  // 🔴 **최근 수납이 있으면 보드도 지우지 않는다**(원장 지시 2026-07-30: *"최근 수납이 있으면 방어로직으로
  // 한번 걸러버리는 것도 좋겠어 안전하게"*). 돈은 "실제로 다닌다"의 가장 강한 신호다 — 수강·보고서 데이터가
  // 전부 조용해도 최근 납부가 있으면 그 학생은 살아있다(실측: 배한빈, 퇴원 04-06인데 07월 청구·06-30 납부).
  if (!billing) skip("recent_billing");
  else {
    const since = billing.lastPaidAt ? dayDiff(billing.lastPaidAt, today) : null;
    const afterWithdrawal =
      !!student?.withdrawnAt &&
      ((billing.lastPeriod && billing.lastPeriod > student.withdrawnAt.slice(0, 7)) ||
        (billing.lastPaidAt && billing.lastPaidAt > student.withdrawnAt));
    set(
      "recent_billing",
      afterWithdrawal || (since != null && since < billingDays),
      `최근 수납·청구가 있습니다(청구 ${billing.lastPeriod ?? "-"} · 납부 ${billing.lastPaidAt ?? "-"}) — 다니는 중일 수 있어 보드를 지우지 않습니다`,
    );
  }

  const matchedCodes = [];
  const notEvaluatedCodes = [];
  for (const g of RELEASE_GUARDS) {
    const v = verdicts.get(g.code);
    if (v === null || v === undefined) notEvaluatedCodes.push(g.code);
    else if (v.hit) matchedCodes.push(g.code);
  }
  let action = "release";
  let primaryCode = "ok";
  let reason = "그 과목 수강 종료 + 무게시 + 신원 확정 — 배정 해제 후 보드 삭제 가능";
  const rank = { exclude: 3, hold: 2, release: 1 };
  for (const g of RELEASE_GUARDS) {
    const v = verdicts.get(g.code);
    if (!v?.hit) continue;
    if (rank[g.action] > rank[action]) {
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
    // 명부 퇴원처리(Operation B) 대상 힌트. 세 조건을 **모두** 만족해야 한다:
    //  ① 전과목 퇴원(일부 과목만 그만둔 학생은 false — 다른 수업 배정이 살아 있어야 한다)
    //  ② aywa 퇴원 후 유예 경과 — ⚠️ **보드 삭제와 자격이 다르다.** 게시물 없는 빈 보드를 지우는 건 20일차라도
    //     무해하다(재등록하면 프로비저닝이 다시 만든다). 그러나 **명부에서 내리는 건 비가역**이고(복구 =
    //     학부모 재초대+재가입) 실측 재등록 31건이 **전부 30일 내**였다. 그래서 퇴원처리에만 유예를 요구한다.
    //     이걸 빼면 "2026-07-10 대량 퇴원(20일차)"이 그대로 퇴원처리 대상으로 뜬다(실제로 그렇게 나왔다).
    //  ③ 이 보드 판정이 release(위 가드 전부 통과)
    alsoOffboard:
      action === "release" &&
      !!student &&
      student.status === "withdrawn" &&
      student.allSubjectsEnded === true &&
      // 🔴 시스템 일괄 퇴원일은 장부 날짜라 퇴원처리 대상이 아니다(원장 지시) — 보드 삭제는 그대로 가능.
      !isSystemBulkWithdrawal(student.withdrawnAt) &&
      (() => {
        const since = dayDiff(student.withdrawnAt, today);
        if (since == null || since < dormantDays) return false;
        // ⭐ 원장 백스톱: 그 학생의 **어떤 보드든** 최근 7일 내 게시물이 있으면 퇴원처리 불가.
        if (!studentAnyPost || studentAnyPost.complete !== true) return false; // 모르면 안 내린다
        const d = studentAnyPost.lastPostAt ? dayDiff(studentAnyPost.lastPostAt, today) : null;
        return d == null || d >= anyPostDays;
      })(),
  };
}
