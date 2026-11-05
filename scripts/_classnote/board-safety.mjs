// scripts/_classnote/board-safety.mjs — ClassNote 발송 직전 보드 안전 판정(순수 함수, 의존성 0).
//
// 오발송(=한 ClassNote 보드에 서로 다른 2가족+가 연결돼 한 학생 보고서가 남의 가족에게도 감) 방지.
// 발송 워커(classnote-core.mjs)와 반 공지 워커(classnote-notice-core.mjs)가 **같은 이 함수**로 판정 →
// 두 경로가 갈라져 한쪽만 취약해지는 것을 구조적으로 차단. Vitest 단위테스트(board-safety.test.mjs).
//
// ⚠️ 순수 유지 — @playwright/test 등 무거운 모듈 import 금지(테스트가 그걸 끌어오면 안 됨). norm은 여기 정의.

/** 공백 전부 제거 — Cloud Run 게시 함수·워커의 보드 매칭 규칙과 동일(공백제거 완전일치). */
export function normBoard(s) {
  return (s || "").replace(/\s/g, "");
}

/**
 * 1인 보드 꼴 이름인가 — `(수학)이름`·`(영어)이름`(공백 무시). 🔴 이런 보드는 **만들지도, 원아를 배정하지도 않는다**
 * (원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"* · 1.0.14). 반 보드 적용(math-class-boards-apply.mjs)이 이 판정으로 건너뛴다.
 */
export function isPersonalBoardName(name) {
  return /^\((수학|영어)\)/.test(normBoard(String(name ?? "")));
}

// 🔴 아래 사유 문구는 실패 알림 벨의 힌트 함수(SQL `classnote_failure_hint` · 앱 미러 `humanizeClassnoteError`)의 말
//    ('보드 없음'·'프로비저닝'·'미가입'·'학생 없음'·'보드 미배정'·'배정 필요'·'409')에 걸리면 안 된다 — 걸리면 벨이
//    "알림장 생성 후 다시 발송"·"학부모를 초대한 뒤"처럼 1인 보드를 만들거나 채우라고 안내한다(2026-11-04 금지된 일).
//    시험 = no-personal-board-writes.test.mjs.

/**
 * 보드가 없어 **보고서**를 못 보냈을 때의 사유(한글) — 1인 보드는 더 만들지 않는다(원장 2026-11-04).
 * 할 일이 과목마다 달라 접두로 가른다(읽는 사람 = 선생님·관리자 — 할 수 있는 일만 적는다).
 */
export function noBoardReason(className) {
  const n = normBoard(String(className ?? ""));
  if (n.startsWith("(영어)"))
    return `ClassNote에 "${className}" 1인 보드가 없어 보내지 못했습니다 — 1인 보드는 더 만들지 않습니다. 이 학생의 영어 반이 ClassNote 반 방에 연결돼야 보낼 수 있으니 관리자에게 알려 주세요`;
  if (n.startsWith("(수학)"))
    return `ClassNote에 "${className}" 1인 보드가 없어 보내지 못했습니다 — 1인 보드는 더 만들지 않습니다. 수학은 반 보드로 보냅니다(학원 설정의 수학 발송 경로가 '반별 발송'인지 관리자에게 확인해 주세요)`;
  return `ClassNote에 "${className}" 보드가 없어 보내지 못했습니다 — 관리자에게 알려 주세요`;
}

// 영어 개별 공지·교재요청서는 2026-11-04(1.0.15)부터 삼자 일치로 정한 영어 반(오늘 다니는 반)에 반 방이 이어져 있으면 반 방으로 간다
// (notice-class-route.mjs). 1인 보드로 오는 까닭은 여럿이다 — 반 방 미연결 · 수업 시작 전·휴원(오늘 다니는 반이 없다) · 미발송 반 ·
// 강사 본인 발송인데 그 학생의 영어 반을 맡지 않음 · 발송 PC가 아직 옛 판 등. 워커는 그 까닭을 모르므로 **까닭을 단정하지 않고**
// 반 방으로 가는 조건만 적는다(한 까닭만 적으면 이미 연결된 반을 다시 확인하게 만든다 — 리뷰 2026-11-04·11-05). 벨 힌트 말은 담지 않는다.
const ENGLISH_NOTICE_TAIL =
  "영어 개별 공지는 그 학생이 지금 다니는 영어 반이 ClassNote 반 방에 연결돼 있을 때 반 방으로 갑니다(강사가 직접 보내면 그 선생님이 맡은 반만 · 수업 시작 전·휴원·미발송 반은 반 방으로 보내지 않습니다) · 관리자에게 알려 주세요";

/** 보드가 없어 **개별 공지**를 못 보냈을 때의 짧은 사유 — 영어는 반 방으로 가지 못한 공지만 1인 보드로 온다(까닭은 위 꼬리 주석). */
export function noBoardNoticeNote(boardName) {
  if (normBoard(String(boardName ?? "")).startsWith("(영어)"))
    return `1인 보드가 없어 보내지 못했습니다 — 1인 보드는 더 만들지 않습니다(${ENGLISH_NOTICE_TAIL})`;
  return "1인 보드가 없어 보내지 못했습니다 — 1인 보드는 더 만들지 않습니다(관리자에게 알려 주세요)";
}

/** 1인 보드에 원아가 없어 **개별 공지**를 못 보냈을 때의 짧은 사유 — 그 보드에 원아를 넣어 줄 주체가 더는 없다(2026-11-04). */
export function emptyBoardNoticeNote(boardName) {
  if (normBoard(String(boardName ?? "")).startsWith("(영어)"))
    return `1인 보드에 학생이 없어 보내지 못했습니다 — 1인 보드에는 더 넣지 않습니다(${ENGLISH_NOTICE_TAIL})`;
  return "1인 보드에 학생이 없어 보내지 못했습니다 — 1인 보드에는 더 넣지 않습니다(관리자에게 알려 주세요)";
}

// ─────────────────────────────────────────────────────────────────────────────
// 매핑 검증 — "이 보드의 원아가 정말 이 학생인가"
//
// **근본 원인**(원장 2026-07-15): aywa는 동명이인을 `박서준`/`박서준C`처럼 **이름 뒤 알파벳**으로 구분하는데,
// **학부모는 ClassNote에 가입할 때 알파벳을 안 붙인다**(그냥 "박서준"). 그래서 보드명 `(수학)박서준` 하나가
// 초6 박서준과 중3 박서준C를 **동시에 가리킬 수 있고**, 학원이 반에 초대를 넣을 때 헷갈리면 그대로 오발송이 된다.
// 실제 사고: `(수학)박서준`에 초6·중3 두 가족이 동거 → 초6 성적표가 중3 집에 노출.
//
// **계정 수로는 못 막는다**(2026-07-15 실측): 모호한 보드 39개가 **전부 계정 1개**라 "2개 이상이면 차단"은
// 이 위험을 **한 건도** 못 잡았고, 대신 같은 학생의 다계정(영어·수학 따로 가입 / 학부모·학생 각자 가입) 4건만
// 오탐으로 막았다. 계정 수는 위험과 겹치지 않는 지표다.
//
// **쓸 수 있는 신호 = 원아 생년월일**. ClassNote가 원아 생일을 준다. 초6과 중3은 3년 차이라 생일로 갈린다.
// aywa엔 생일이 없지만(807명 중 1명) **학년은 전원 있다** → 학년에서 출생연도를 역산해 대조한다.
// 실측: 정상 보드 11개 전부 오차 0년(오탐 0), 진짜 오류 2건 검출(김서윤·김채은 — 보드에 퇴원 동명이인 가족이 붙어 있었다).
// ─────────────────────────────────────────────────────────────────────────────

/** 학년 → (학년도 − 출생연도). 초1 = 만 6세 되는 해 3월 입학 → 2026학년도 초1 = 2019생(2026−2019=7). */
const GRADE_AGE_OFFSET = {
  초1: 7, 초2: 8, 초3: 9, 초4: 10, 초5: 11, 초6: 12,
  중1: 13, 중2: 14, 중3: 15,
  고1: 16, 고2: 17, 고3: 18,
};

/** 생일 대조 허용 오차(년). 조기입학·유급·학부모 오입력(실측: 자기 생일을 1년 틀리게 넣은 사례)을 흡수. */
const BIRTH_YEAR_TOLERANCE = 1;

/** aywa 학년 → 기대 출생연도. 모르는 학년이면 null(=대조 불가). */
export function expectedBirthYear(grade, schoolYear) {
  const off = GRADE_AGE_OFFSET[String(grade ?? "").trim()];
  // ⚠️ `Number(null)`은 0이고 0은 유한수다 — null 체크를 따로 안 하면 학년도 없이 "-12년생"이 나온다(테스트가 잡음).
  if (off == null || schoolYear == null) return null;
  const y = Number(schoolYear);
  return Number.isFinite(y) && y > 1900 ? y - off : null;
}

/** KST 기준 학년도 — 3월 시작(1~2월은 전 학년도). @param {Date} [now] */
export function kstSchoolYear(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  return m >= 3 ? y : y - 1;
}

/**
 * 이 보드명이 **여러 학생을 가리킬 수 있는가**(= 매핑 검증이 필요한가).
 *
 * 두 경우가 모호하다:
 *  ① 같은 유효이름이 2명 이상 — ⚠️ **퇴원생을 반드시 포함**해서 센다. 앱의 동명이인 게이트
 *     (hasClassnoteNameCollision)는 `status<>'withdrawn'`이라 **퇴원하는 순간 풀리는데**, ClassNote 보드엔
 *     그 퇴원 가족이 그대로 남아 있다. 실측: 김서윤(중1) 07-10 퇴원 → 고2 김서윤 보드가 무방비가 됨.
 *  ② `이름+알파벳 한 글자`(A~G) 형제가 있음 — aywa `박서준` vs `박서준C`. aywa 이름이 **다르므로**
 *     동명이인 게이트를 통과하는데, ClassNote 보드명엔 접미사가 없어 같은 이름을 공유한다(박서준 사고 경로).
 *     ⚠️ `이윤` vs `이윤건`처럼 **여러 글자 차이는 다른 이름**이라 모호하지 않다(학부모가 "이윤건"으로 가입).
 *
 * @param {string} baseName - 보드명에서 `(과목)`을 뗀 학생 유효이름(정규화됨)
 * @param {string[]} allNames - **퇴원·예비 포함 전 학생**의 정규화된 유효이름
 */
export function boardNameAmbiguity(baseName, allNames) {
  const key = normBoard(baseName);
  if (!key) return { ambiguous: false, sameName: 0, siblings: [] };
  let sameName = 0;
  const siblings = [];
  for (const raw of allNames ?? []) {
    const n = normBoard(raw);
    if (n === key) sameName++;
    else if (n.length === key.length + 1 && n.startsWith(key) && /^[A-G]$/.test(n.slice(-1))) siblings.push(n);
  }
  return { ambiguous: sameName > 1 || siblings.length > 0, sameName, siblings };
}

/**
 * 모호한 보드의 **매핑 검증** — 원아 생일이 이 학생의 학년과 맞는가.
 * @param {{ grade: string|null, children: Array<{name?:string, date_birth?:string|null}>, schoolYear: number }} p
 * @returns {{ok:boolean, code:string, reason?:string}}
 */
export function evaluateBoardMapping({ grade, children, schoolYear }) {
  const want = expectedBirthYear(grade, schoolYear);
  if (want == null)
    return { ok: false, code: "mapping_unknown", reason: `학년(${grade ?? "없음"})을 알 수 없어 원아가 이 학생이 맞는지 확인할 수 없습니다` };
  const kids = children ?? [];
  if (!kids.length) return { ok: true, code: "ok" }; // 아직 아무도 안 붙음 = 오발송 대상 없음

  const bad = [];
  for (const k of kids) {
    const y = Number(String(k?.date_birth ?? "").slice(0, 4));
    if (!Number.isFinite(y) || y < 1900)
      return {
        ok: false,
        code: "mapping_unknown",
        reason: `원아 "${k?.name ?? "?"}"의 생년월일이 없어 이 학생이 맞는지 확인할 수 없습니다(동명이인이 있는 이름이라 확인 없이는 보낼 수 없습니다)`,
      };
    if (Math.abs(y - want) > BIRTH_YEAR_TOLERANCE) bad.push({ name: k?.name ?? "?", y });
  }
  if (bad.length)
    return {
      ok: false,
      code: "grade_mismatch",
      reason:
        `⚠️ 다른 학생의 가족일 수 있습니다 — 이 학생은 aywa에서 ${grade}(${want}년생)인데, 보드에 연결된 원아는 ` +
        bad.map((b) => `"${b.name}" ${b.y}년생`).join(", ") +
        ` 입니다. 동명이인이 있는 이름이라(학부모는 클래스노트 가입 시 이름 뒤 알파벳을 안 붙입니다) 반 초대가 엉뚱한 집에 갔을 수 있습니다. ` +
        `클래스노트 운영관리에서 확인 후, 맞는 집이면 수업보고서 > 보고서 설정 > '공유 보드 발송 예외'에 등록, 아니면 연결을 바로잡아 주세요.`,
    };
  return { ok: true, code: "ok" };
}

/**
 * 발송 직전 보드 안전 판정.
 *
 * ⚠️ **계정 수(2가족+)로 막던 것을 폐기**하고 **매핑 검증**으로 대체했다(원장 결정 2026-07-15). 근거:
 *  ① 위험의 실체는 "계정이 여럿"이 아니라 **"이 보드의 원아가 다른 학생"**이다(위 매핑 검증 절).
 *  ② 실측: 모호한 보드 39개가 **전부 계정 1개** → 계정 수 게이트는 진짜 위험을 **한 건도** 못 잡았고,
 *     같은 학생의 다계정(영어·수학 따로 가입 / 학부모·학생 각자 가입) 4건만 **오탐**으로 막았다.
 *     심지어 계정이 1개여도 그게 **엉뚱한 집**이면 그대로 오발송이라(김서윤·김채은 실사례) 계정 수는 위험과 겹치지도 않는다.
 *  ③ 반 초대는 **학원이 직접** 넣으므로 무관한 가족이 붙을 일은 사실상 없다(원장 확인). 헷갈리는 유일한 지점이
 *     **동명이인**이고, 그건 매핑 검증이 직접 잡는다.
 * **계정 수 기준으로 되돌리지 말 것.**
 *
 * @param {object} p
 * @param {string} p.className  대상 보드명 "(과목)학생명"(boardClassName 결과)
 * @param {Array<{id:number,name:string,children?:number|null}>} p.boards  전체 보드
 * @param {string[]} [p.allowlist]  원장이 육안 확인해 통과시킨 보드명 — 매핑 검증의 **사람 탈출구**(막다른 길 방지)
 * @param {null|{grade:string|null, children:Array<{name?:string,date_birth?:string|null}>, schoolYear:number}} [p.mapping]
 *   **모호한 보드일 때만** 넘긴다(`boardNameAmbiguity`로 판정 후 `fetchBoardChildren`). null = 검증 불필요(비모호).
 * @returns {{ok:boolean, code:string, reason?:string, boardId?:number}}
 *   ok=true면 발송 진행. ok=false면 blocked_shared로 보류(발송 안 함) + reason을 classnote_error에 저장.
 */
export function evaluateBoardSafety({ className, boards, allowlist = [], mapping = null }) {
  const key = normBoard(className);
  if (!key) return { ok: false, code: "no_class", reason: "발송 대상 보드명이 비어 있습니다" };

  const matched = (boards || []).filter((b) => normBoard(b.name) === key);
  if (matched.length === 0)
    return {
      ok: false,
      code: "no_board",
      reason: noBoardReason(className),
    };
  if (matched.length > 1)
    return {
      ok: false,
      code: "dup_board",
      reason: `ClassNote 보드 중복 — "${className}" 이름의 보드가 ${matched.length}개라 대상을 특정할 수 없습니다`,
    };

  const board = matched[0];
  // 원장이 육안 확인해 등재한 보드 = 검증 면제(사람 판단이 최종). 이 탈출구가 없으면 확인해도 못 푸는 막다른 길이 된다.
  // ⚠️ 옛 `보드명|N`(인원 지정) 입력이 남아 있어도 동작하게 숫자는 떼고 이름만 본다 — 계정 수 개념은 폐기됐다.
  const allowed = new Set((allowlist || []).map((e) => normBoard(String(e ?? "").replace(/\s*\|\s*\d+\s*$/, ""))));
  // allowlisted = 뒤따르는 추가 검증(동명이인 전화 대조 G5 등)도 이 사람 판단을 존중해 건너뛰게 표시한다.
  if (allowed.has(key)) return { ok: true, code: "ok", boardId: board.id, allowlisted: true };

  if (mapping) {
    const v = evaluateBoardMapping(mapping);
    if (!v.ok) return { ...v, boardId: board.id };
  }
  return { ok: true, code: "ok", boardId: board.id };
}

/**
 * **보드가 곧 매핑이다** — 1인 보드 `(과목)이름`에 배정된 원아를 이 학생으로 인정할지 판정(순수).
 *
 * 배경(원장 2026-07-23): 1인 보드는 학생 1명에 보드 1개다. aywa가 보드명으로 그 보드를 특정한 순간
 * **매핑은 이미 끝났다** — 그 보드에 배정된 원아가 곧 그 학생이다. 그런데 발송 워커는 그 뒤에 다시
 * **원아 이름이 aywa 이름과 같은지**까지 봤고, 학부모가 ClassNote에서 원아 이름을 바꾸면
 * (`박서연E` → `서연`) 배정이 멀쩡한데도 "보드 미배정"으로 오판해 발송이 막혔다.
 * 실측 2026-07-23: 원아가 있는 1인 보드 378개 중 이름 불일치 7개(재원생 2명 — 박서연E·엄채율).
 *
 * ⚠️ 이름 검사를 걷어내는 대신 **생년 대조를 반드시 통과**시킨다. 이름은 학부모가 바꿀 수 있는 표시값이지만
 *    생년은 그 아이의 사실이라, "엉뚱한 집이 이 보드에 붙어 있는가"(박서준 사고 경로)는 생년이 더 정확히 잡는다.
 *    생년을 모르면(원아 생년 없음·aywa 학년 없음) **거부**한다 — 확인 못 하면 안 보낸다.
 *
 * @param {{members: Array<{id?:number,name?:string,date_birth?:string|null}>, grade: string|null, schoolYear: number}} p
 * @returns {{ok:boolean, code:string, reason?:string, members?:Array<object>}}
 */
export function acceptBoardMembers({ members, grade, schoolYear }) {
  const kids = members ?? [];
  if (!kids.length)
    return {
      ok: false,
      code: "no_member",
      reason: "ClassNote 보드에 연결된 원아가 없습니다 — 학부모 초대·반 배정이 필요합니다",
    };
  const v = evaluateBoardMapping({ grade, children: kids, schoolYear });
  if (!v.ok) return v;
  return { ok: true, code: "ok", members: kids };
}
