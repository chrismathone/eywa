/**
 * 학교명 정규화 — 학교알리미 공시명("대구칠성초등학교")과 aywa 입력값("칠성초")을 **같은 키**로 만든다.
 *
 * 두 소스를 잇는 키가 이름뿐이라 이 함수가 곧 매칭 정확도다. 학교코드는 못 쓴다:
 * 학교알리미 `정보공시 학교코드`(S000003493) ≠ NEIS `SD_SCHUL_CODE`(7261042)로 서로 다른 체계다.
 *
 * 🔴 치환 순서가 규칙이다. `여자중학교`를 `중학교`보다 **먼저** 지워야 한다 — 반대로 하면
 * "경명여자중학교"가 "경명여자"가 되어 aywa의 "경명여중"과 영영 안 붙는다(실측: 여학교 6종
 * 23+12+6+4+1+1 = 47명이 통째로 매칭에서 빠졌던 원인).
 *
 * ⚠️ 지역 접두("대구")도 지운다 — aywa엔 같은 학교가 "일중"(15명)과 "대구일중"(24명) 두 표기로
 * 들어가 있어 점유율이 1.5%/2.5%로 쪼개지고 있었다. 지우면 둘 다 "일중"으로 합쳐진다(39명=4.0%).
 * 과거 데이터를 고치지 않고 읽는 쪽에서 흡수하는 방식이라 되돌릴 수 있다.
 *
 * ⚠️ 이 규칙의 **사본**이 [`scripts/_poc_migration/import-school-enrollment.cjs`](../../../scripts/_poc_migration/import-school-enrollment.cjs)에
 * 있다(공시 적재 시 `name_key` 계산). 여기를 고치면 거기도 고치고 **임포터를 다시 돌려야** 키가 맞는다.
 */

// 긴 것부터. 순서를 바꾸면 조용히 오매칭된다.
const SUFFIX_RULES: [RegExp, string][] = [
  [/여자상업고등학교$/, "여상"],
  [/여자정보고등학교$/, "여고"],
  [/여자중학교$/, "여중"],
  [/여자고등학교$/, "여고"],
  [/여자초등학교$/, "여초"],
  [/초등학교$/, "초"],
  [/중학교$/, "중"],
  [/고등학교$/, "고"],
  // "칠성초등"처럼 '학교'가 빠진 표기(실측 1건). '초등학교$'보다 뒤에 둬야 한다.
  [/초등$/, "초"],
  [/중등$/, "중"],
  [/고등$/, "고"],
];

/** 급만 남은 꼴 — 학교를 특정하지 못한다. 지역 접두를 지울지 판단할 때와, 소비처의 '기타' 판정에 쓴다. */
const BARE_KIND_RE = /^(초|중|고|여초|여중|여고|여상)$/;

/**
 * 학원장이 지정한 예외 별칭(2026-08-05). **자동 추론이 아니라 사람이 확정한 매핑만** 넣는다.
 * "달산"은 급이 없어 원칙상 '기타'지만 대구에 달산초등학교가 실재하고 다른 후보가 없어 원장이 확정했다.
 * ⚠️ 여기에 추측을 넣지 말 것 — 애매한 건 '기타'로 두는 편이 분포를 덜 왜곡한다.
 */
const ALIASES: Record<string, string> = { 달산: "달산초" };

function applySuffix(s: string): string {
  for (const [re, to] of SUFFIX_RULES) if (re.test(s)) return s.replace(re, to);
  return s;
}

/**
 * 🔴 지역 접두를 지웠더니 **학교급만 남는** 이름이 있다 — `대구초등학교`·`대구중학교`·`대구고등학교`·
 * `대구여자고등학교`가 각각 `초`·`중`·`고`·`여고`가 됐다(전부 실재하는 대구 학교다).
 *
 * 그 결과 상담 입력의 쓰레기 값 `초`(43건)·`중`(17건) — 그냥 "초등학생"이라는 뜻 —이 **대구초등학교
 * (전교생 444명)·대구중학교에 그대로 붙어** 화면에 "대구초등학교 43건"으로 떴다. 존재하지 않는 점유율이다.
 * 그래서 지운 뒤 급만 남으면 **안 지운다**(`대구초`로 남긴다).
 */
function stripRegionPrefix(s: string): string {
  const stripped = s.replace(/^대구광역시/, "").replace(/^대구/, "");
  if (stripped === s) return s;
  if (!stripped || BARE_KIND_RE.test(applySuffix(stripped))) return s;
  return stripped;
}

export function normalizeSchoolName(raw: string | null | undefined): string {
  let s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  // 괄호 주석("(분교)" 등)은 매칭에 방해만 된다.
  s = s.replace(/\（.*?\）|\(.*?\)/g, "");
  // 학년 꼬리("달성초1"·"종로초6") — 학교명은 숫자로 끝나지 않는다.
  s = s.replace(/\d+$/, "");
  s = stripRegionPrefix(s);
  s = applySuffix(s);
  return ALIASES[s] ?? s;
}

/**
 * 학원장이 확정한 **저장 표기 별칭**(2026-09-01: *"지금 일중 -> 대구일중으로 전부 db 변경"* +
 * *"일중으로 저장하려고 하면 … 그냥 강제로 대구일중 저장"*).
 *
 * ⚠️ 위 `ALIASES`(매칭 키)와 **방향이 반대다.** 매칭 키는 지역 접두를 지워 `대구일중`·`일중`을 한 학교로
 *    묶고(그래야 점유율이 안 쪼개진다), 저장 표기는 사람이 읽는 쪽이라 **긴 이름으로 통일**한다.
 *    둘이 싸우지 않는다 — 저장이 `대구일중`이어도 매칭 키는 여전히 `일중`이다.
 * 🔴 추측을 넣지 말 것. 원장이 확정한 것만.
 */
export type SchoolSaveAlias = { from: string; to: string };

/**
 * 첫 학원(침산)의 저장 별칭 — 🔴 **학원설정 값**(`operations.schoolSaveAliases`)이 진실이고, 이 상수는 침산 프리셋
 * 기본값의 원본일 뿐이다(defaults.ts). 새 학원(일반판)은 빈 목록이라 `일중`을 `대구일중`으로 바꾸지 않는다
 * (다른 지역의 '일중'까지 대구로 저장되던 것 — 2026-09-22 일반판 분리).
 */
export const CHINSAN_SCHOOL_SAVE_ALIASES: readonly SchoolSaveAlias[] = [{ from: "일중", to: "대구일중" }];

/**
 * **저장할 학교 표기**로 강제 정규화 — 화면·DB에 남는 값이 이 함수를 통과한 형태 하나뿐이게 한다.
 *
 * 원장 2026-09-01: *"~초등학교도 -> ~초 로 변경해야함. db에서 수정하고 이런경우도 저장할때 강제
 * 변경시키고 저장."* 그전까지 같은 학교가 `옥산초`와 `옥산초등학교` 두 표기로 들어와 카드·목록에서
 * 나란히 서고 통계는 정규화로만 겨우 합치고 있었다(병행표기 금지 — 원장 2026-08-05).
 *
 * 🔴 `normalizeSchoolName`(매칭 **키**)과 다른 물건이다:
 *    · 키   = 비교용. 지역 접두를 지우고 학년 꼬리·괄호까지 털어낸다(되돌릴 수 없는 축약).
 *    · 저장 = 사람이 읽는 값. **접두는 지키고**(대구일중) 긴 접미만 줄인다(초등학교→초).
 * ⚠️ 학교가 아닌 값(`7세`·`예비중1`·`영어문의`)은 규칙에 안 걸려 **그대로 통과**한다 — 접수 원문을
 *    함부로 고치지 않는다(무엇이 학교인지 모르는 값까지 손대면 되돌릴 수 없다).
 * 🔴 **가운데 공백을 지우지 않는다**(양끝 trim만). 실데이터 드라이런에서 잡혔다: 이 칸엔 학교가 아닌
 *    메모가 섞여 있어(`달산초6, 예비일중`·`국제학교 (중국)`·`구미 해마루중`) 공백을 지우면 읽을 수
 *    없는 값이 된다 — 최악은 `칠성초2 7세` → `칠성초27세`. 매칭 **키**(normalizeSchoolName)는 공백을
 *    지워도 되지만(비교용, 원본 보존) 저장 표기는 사람이 읽는 값이라 안 된다.
 * ⚠️ 빈 값은 `null`(빈 문자열로 저장하지 않는다 — 소비처가 전부 null 폴백을 쓴다).
 */
export function canonicalSchoolName(
  raw: string | null | undefined,
  // 🔴 앱 코드는 **학원설정 값을 반드시 넘긴다**(`settings.operations.schoolSaveAliases`) — 기본값은 테스트용 침산 목록이다.
  //    가드(school-alias-wiring.test.ts)가 두 번째 인자를 빼먹은 호출을 잡는다.
  aliases: readonly SchoolSaveAlias[] = CHINSAN_SCHOOL_SAVE_ALIASES,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const compressed = applySuffix(s);
  return aliases.find((a) => a.from === compressed)?.to ?? compressed;
}

/**
 * 학교급이 빠진 표기(`칠성`·`경명여`·`침산`)에 **학년의 급**을 붙인 후보(2026-10-20 김지유 건 — 상담에 `칠성`으로
 * 적힌 것이 원생 전환까지 그대로 내려가 `칠성초`(128명)와 따로 섰다). `canonicalSchoolName`은 긴 접미를 줄이기만
 * 해서 급이 없는 값은 통과시킨다.
 *
 * 🔴 후보일 뿐이다 — 저장 쪽(`completeSchoolKind`)이 그 지점 **학교알리미 목록에 실제로 있는 학교**일 때만 쓴다
 *    (`아무개`+초 → `아무개초`처럼 없는 학교를 만들지 않는다 · 추측 금지 원칙은 위 ALIASES와 같다).
 * ⚠️ 한글만으로 된 값만 — 숫자·공백·괄호가 섞인 값(`예비초1`·`달산초6, 예비일중`)은 메모라 손대지 않는다.
 * ⚠️ 학년이 `초5`·`중2`·`고1`처럼 급으로 시작할 때만(`1`·`7세`는 급을 모른다).
 */
export function schoolKindCandidate(school: string | null | undefined, grade: string | null | undefined): string | null {
  const s = String(school ?? "").trim();
  if (!/^[가-힣]+$/.test(s)) return null;
  // 지역 이름만 적은 값(`대구`)은 학교가 아니다 — 급을 붙이면 실재하는 `대구초`가 되어 버린다.
  if (/^대구(광역시)?$/.test(s)) return null;
  if (isSchoolLikeKey(normalizeSchoolName(s))) return null;
  const kind = /^(초|중|고)/.exec(String(grade ?? "").trim())?.[1];
  // 지역 접두는 뗀다(`대구칠성` → `칠성초`) — 같은 학교가 이미 `칠성초`로 저장돼 있다. `대구일중`처럼 접두를 지키는
  // 학교는 저장 별칭이 되돌린다(`completeSchoolKind`).
  return kind ? stripRegionPrefix(s) + kind : null;
}

/** 정규화 키가 학교 이름 꼴인가(= 급으로 끝나고, 급만 있는 게 아닌가). */
export function isSchoolLikeKey(key: string): boolean {
  if (!key || BARE_KIND_RE.test(key)) return false;
  return /(초|중|고|여상)$/.test(key);
}

/** 정규화 키 끝 글자로 학교급 추론(`침산초`→초). 학교 꼴이 아니면 null. */
export function kindFromKey(key: string): "초" | "중" | "고" | null {
  if (!isSchoolLikeKey(key)) return null;
  if (key.endsWith("여상")) return "고";
  const last = key.at(-1);
  return last === "초" || last === "중" || last === "고" ? last : null;
}

/** 학교급 코드(학교알리미) → 사람이 읽는 급. */
export const SCHOOL_KIND: Record<string, "초" | "중" | "고"> = {
  "02": "초",
  "03": "중",
  "04": "고",
};
