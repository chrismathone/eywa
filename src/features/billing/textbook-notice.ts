/**
 * 교재요청 → 학부모 ClassNote 공지 본문 조립(순수 함수 + Vitest).
 *
 * 화면 미리보기와 실제 발송이 **같은 함수**를 쓰도록 조립을 여기 한 곳에만 둔다(WYSIWYG — 미리보기에
 * 보인 글자가 그대로 학부모에게 간다). 발송 레일은 기존 공지(classnote_notices / sendOnescreenNotice)를
 * 그대로 재사용하고, 이 모듈은 "무슨 글자를 보낼지"만 책임진다.
 *
 * ⚠️ textbook_orders.notes(사무실 내부 메모)는 **입력 타입에 아예 없다** — 학부모 노출 금지를 구조로 차단.
 * ⚠️ 토큰 뒤 조사(이/가…)는 `fillMentTemplate`가 받침에 맞춰 고른다 — 템플릿 문자열을 그대로 믿지 말 것.
 *
 * 공지 레일의 본문 조립 규약: 워커가 게시하는 글 = `공통(notice.body)` + "\n\n" + `개별(target.body)`.
 * 그래서 학생마다 달라지는 부분(교재·금액, 치환된 멘트)은 **개별**에, 전원 공통인 문장만 **공통**에 둔다.
 */

import { JOSA_ALTERNATION, pickJosa } from "@/lib/text/josa";

/** 계좌(학원설정 accountForTarget(billing,"textbook")) — 구조적 부분집합이라 AccountSetting을 그대로 받는다. */
export type TextbookNoticeAccount =
  | { bank?: string | null; holder?: string | null; number?: string | null }
  | null
  | undefined;

export type TextbookNoticeInput = {
  /** 강사 멘트(선택). 비면 멘트 줄 없이 교재 정보만. */
  ment?: string | null;
  bookName: string;
  bookDetail?: string | null;
  price: number;
  requestDate?: string | null;
  account?: TextbookNoticeAccount;
};

/** 멘트 치환용 값. 학생·교재·금액은 요청 건마다 다르다. */
export type MentVars = { studentName?: string | null; bookName?: string | null; price?: number | null };

/**
 * 원장 확정 기본 문구. 토큰 = {학생}·{교재명}·{금액}.
 *
 * 🔴 **주어 자리에 조사(이/가)를 쓰지 않는다**(원장 2026-08-03). 받침 판정은 문법적으로 맞았지만
 *    (`이하준` → 받침 ㄴ → `이하준이`) 학부모가 읽기엔 어색하다 — 아이 이름을 부르는 말투로 읽힌다.
 *    → `{학생} 학생의 …` 형태로 바꿔 **조사 자체를 없앤다**(원장 표현: "이/가 무시하고 ~학생의 를 붙이면").
 *    조사 치환 로직(fillMentTemplate)은 그대로 둔다 — 원장이 화면에서 `{학생}은`처럼 고쳐 쓸 때 여전히 필요하다.
 */
export const DEFAULT_TEXTBOOK_MENT =
  "안녕하세요. {학생} 학생의 {교재명} 교재를 신청합니다. 금액은 {금액}원이며 아래 계좌로 납부 부탁드립니다.";

/**
 * **옛 기본 문구들** — 저장값이 이것과 글자 하나 안 다르면 "원장이 고른 커스텀"이 아니라
 * *그때의 기본값이 그대로 굳은 것*이다(발송 다이얼로그가 멘트를 자동 중간저장하므로 손대지 않아도 저장된다).
 *
 * 🔴 이게 없으면 **기본 문구를 고쳐도 아무도 안 바뀐다.** 2026-08-03 실측: 저장값 보유 5명 중 **4명**이
 *    옛 기본값과 완전히 동일한 복사본이었다 — 그대로 두면 그 4명은 계속 옛 문구로 발송한다.
 * ⚠️ DB를 고치지 않고 **읽는 쪽에서** 흡수한다(남의 저장값을 말없이 바꾸지 않는다 · 되돌리기 쉽다).
 * ⚠️ 기본 문구를 또 바꾸면 **직전 문구를 여기 추가**할 것. 안 하면 같은 자리에서 같은 일이 반복된다.
 */
export const LEGACY_TEXTBOOK_MENTS: readonly string[] = [
  "안녕하세요. {학생}이 {교재명} 교재를 신청합니다. 금액은 {금액}원이며 아래 계좌로 납부 부탁드립니다.",
];

/**
 * 저장된 멘트 → 실제로 쓸 멘트. 비었거나 **옛 기본값 그대로**면 현재 기본 문구로.
 * (드물게 옛 문구를 일부러 그대로 타이핑한 사람은 새 문구를 받는다 — 화면에서 다시 고칠 수 있으므로 수용.)
 */
export function resolveTextbookMent(saved: string | null | undefined): string {
  const s = (saved ?? "").trim();
  if (!s || LEGACY_TEXTBOOK_MENTS.includes(s)) return DEFAULT_TEXTBOOK_MENT;
  return s;
}

/** 멘트가 학생마다 달라질 때(치환 토큰 사용) 공통 자리에 쓰는 머리말. */
export const TEXTBOOK_NOTICE_HEADER = "교재 신청 안내";

const MENT_TOKENS = ["{학생}", "{교재명}", "{금액}"] as const;

/** 금액 표기 — 천단위 콤마. 음수·NaN은 0으로(돈에 음수 표기 금지). Intl 로케일 의존 없이 결정적. */
export function formatWon(price: number | null | undefined): string {
  const n = Number(price);
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 멘트에 치환 토큰이 있는가 = 학생마다 문장이 달라지는가. */
export function mentHasTokens(template: string | null | undefined): boolean {
  const t = template ?? "";
  return MENT_TOKENS.some((tok) => t.includes(tok));
}

/**
 * 토큰 + **바로 뒤 조사**. 조사는 뒤에 한글이 안 올 때만 조사로 본다 — `{교재명}과학`의 `과`를
 * 조사로 오인해 `…와학`으로 망가뜨리지 않기 위한 안전장치(못 알아보면 원문 유지 = 무해).
 */
const TOKEN_JOSA_RE = new RegExp(`\\{(학생|교재명|금액)\\}(?:(${JOSA_ALTERNATION})(?![가-힣]))?`, "g");

/**
 * 멘트 템플릿 치환 — {학생}/{교재명}/{금액}. **토큰이 없으면 원문 그대로**(강사가 자유 문장을 써도 안 깨짐).
 * 값이 비면 빈 문자열로 치환하고 남는 연속 공백만 정리한다(raw 토큰이 학부모에게 노출되지 않게).
 *
 * 🔴 **토큰 뒤 조사는 치환된 값의 받침에 맞춘다**(2026-07-31 원장 제보). 예전엔 템플릿에 적힌 `이`가
 *    그대로 나가 **"김지우이 … 신청합니다"**가 학부모에게 발송됐다. 이제 `김지우` → `가`, `김민수` → `이`.
 *    `김태희A`처럼 동명이인 접미 알파벳이 붙어도 한국어 읽기(A=에이)로 판정한다(josa.ts).
 *    ⚠️ 원장이 화면에서 템플릿을 `{학생}은`으로 바꿔도 같은 규칙이 적용된다 — 짝의 어느 쪽을 적든 무관.
 */
export function fillMentTemplate(template: string, vars: MentVars): string {
  const valueOf = (token: string): string =>
    token === "학생"
      ? (vars.studentName ?? "").trim()
      : token === "교재명"
        ? (vars.bookName ?? "").trim()
        : formatWon(vars.price);
  const filled = (template ?? "").replace(TOKEN_JOSA_RE, (_m, token: string, josa?: string) => {
    const value = valueOf(token);
    return josa ? `${value}${pickJosa(value, josa)}` : value;
  });
  return filled.replace(/[^\S\n]{2,}/g, " ");
}

/** 계좌 줄 — 은행·번호가 하나도 없으면(계좌 특정 불가) 줄 자체를 만들지 않는다(빈 값 노출 금지). */
function accountLine(account: TextbookNoticeAccount): string | null {
  const bank = (account?.bank ?? "").trim();
  const number = (account?.number ?? "").trim();
  const holder = (account?.holder ?? "").trim();
  if (!bank && !number) return null;
  const head = [bank, number].filter(Boolean).join(" ");
  return `[입금 계좌] ${head}${holder ? ` (예금주 ${holder})` : ""}`;
}

/**
 * 학부모용 본문 한 덩이 — 멘트 + 교재명(+상세) + 금액 + 계좌 + 요청일.
 * 없는 항목(빈 멘트·상세 없음·계좌 없음·금액 0 이하·요청일 없음)은 **줄 자체를 생략**한다.
 */
export function buildTextbookNoticeBody(input: TextbookNoticeInput): string {
  const ment = (input.ment ?? "").trim();
  const book = (input.bookName ?? "").trim();
  const detail = (input.bookDetail ?? "").trim();
  const price = Number(input.price);
  const date = (input.requestDate ?? "").trim();

  const info: string[] = [];
  if (book) info.push(`[교재] ${book}${detail ? ` (${detail})` : ""}`);
  if (Number.isFinite(price) && price > 0) info.push(`[금액] ${formatWon(price)}원`);
  const acc = accountLine(input.account);
  if (acc) info.push(acc);
  if (date) info.push(`[요청일] ${date}`);

  return [ment, info.join("\n")].filter(Boolean).join("\n\n");
}

/** 공통 body(전원 동일) — 멘트에 토큰이 있으면 학생마다 달라지므로 머리말만, 없으면 멘트 그대로. */
export function textbookNoticeCommon(ment: string | null | undefined): string {
  const raw = (ment ?? "").trim();
  return !raw || mentHasTokens(raw) ? TEXTBOOK_NOTICE_HEADER : raw;
}

/**
 * 학생별 개별 body — 교재 정보 + (공통에 못 넣는) 치환된 멘트.
 * 멘트가 공통으로 나가는 경우(토큰 없음)엔 개별에 넣지 않는다 → 같은 문장이 두 번 나오지 않는다.
 */
export function textbookNoticeIndividual(
  ment: string | null | undefined,
  item: TextbookNoticeInput & { studentName?: string | null },
): string {
  const raw = (ment ?? "").trim();
  const perStudent = mentHasTokens(raw);
  return buildTextbookNoticeBody({
    ment: perStudent
      ? fillMentTemplate(raw, { studentName: item.studentName, bookName: item.bookName, price: item.price })
      : "",
    bookName: item.bookName,
    bookDetail: item.bookDetail,
    price: item.price,
    requestDate: item.requestDate,
    account: item.account,
  });
}

/**
 * 미리보기·테스트용 편의 — 공통/개별/합본(학부모가 실제로 보는 글)을 한 번에.
 * full = 워커가 게시하는 형태(`공통 + "\n\n" + 개별`)와 동일해야 한다.
 */
export function composeTextbookNotice(
  ment: string | null | undefined,
  item: TextbookNoticeInput & { studentName?: string | null },
): { common: string; individual: string; full: string } {
  const common = textbookNoticeCommon(ment);
  const individual = textbookNoticeIndividual(ment, item);
  return { common, individual, full: [common, individual].filter(Boolean).join("\n\n") };
}
