/**
 * 학교명 정규화 — 학교알리미 공시명("대구칠성초등학교")과 eywa 입력값("칠성초")을 **같은 키**로 만든다.
 *
 * 두 소스를 잇는 키가 이름뿐이라 이 함수가 곧 매칭 정확도다. 학교코드는 못 쓴다:
 * 학교알리미 `정보공시 학교코드`(S000003493) ≠ NEIS `SD_SCHUL_CODE`(7261042)로 서로 다른 체계다.
 *
 * 🔴 치환 순서가 규칙이다. `여자중학교`를 `중학교`보다 **먼저** 지워야 한다 — 반대로 하면
 * "경명여자중학교"가 "경명여자"가 되어 eywa의 "경명여중"과 영영 안 붙는다(실측: 여학교 6종
 * 23+12+6+4+1+1 = 47명이 통째로 매칭에서 빠졌던 원인).
 *
 * ⚠️ 지역 접두("대구")도 지운다 — eywa엔 같은 학교가 "일중"(15명)과 "대구일중"(24명) 두 표기로
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
