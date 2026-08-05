/**
 * 등록상담 분포(학년·지역·학교)의 순수 계산부.
 *
 * 🔴 여기는 **등록상담 화면**이다 — 재원생/퇴원생 분포를 넣었다가 원장 지적을 받았다(2026-08-05:
 * *"재원생 퇴원생 분석은 여기서 하는게 아니지. 지금 대분류가 등록상담인데"*). 재원생 기준은 연도
 * 선택과도 무관해 화면이 거짓말을 했다(연도를 바꿔도 숫자가 그대로였다). 상담 기준이면 연도가 산다.
 */
import { normalizeSchoolName } from "@/features/schools/school-name";

export type DistBar = { label: string; n: number; enrolled: number };

/**
 * 확실하지 않은 학년이 모두 모이는 칸. 화면 맨 뒤에 흐리게 두고 "왜 분류가 안 됐는지"를 함께 적는다.
 * 🔴 원장 지시(2026-08-05): *"매핑하기 애매한것들은 전부 무시하고 보조 설명 달아둬. 애매하게
 * 매핑하는것보다 무시하는것들이 더 정확성이 높을듯."*
 */
export const GRADE_UNKNOWN = "분류 불가";

/** 급별 유효 학년 — 이 밖의 조합은 만들지 않는다. */
const MAX_GRADE: Record<string, number> = { 초: 6, 중: 3, 고: 3 };

/**
 * 학년 라벨 정규화. **확실할 때만** `초4`·`중2` 같은 라벨을 만들고, 조금이라도 애매하면 `분류 불가`다.
 *
 * 🔴 급+숫자를 검증 없이 이어 붙였다가 **`초7`이 나왔다**(실측 2026년 1건). 초등학교 7학년은 없다 —
 * 없는 학년을 만들어 분포에 끼워 넣는 건 미상으로 두는 것보다 나쁘다. 그래서 급별 상한을 본다.
 *
 * 급은 **학교명에서** 가져온다(상담엔 학년이 "2"처럼 숫자만 적힌 게 2026년 35건). 학교가 없으면
 * 급을 모르는 것이므로 분류하지 않는다 — 초2와 중2를 한 칸에 합치면 분포가 통째로 거짓말이 된다.
 */
export function gradeLabel(rawGrade: string | null, school: string | null): string {
  const g = String(rawGrade ?? "").replace(/\s+/g, "");
  if (!g || /^(미상|기타|미정|없음)$/.test(g)) return GRADE_UNKNOWN;

  // 이미 급이 붙어 있으면 그 조합이 유효할 때만 인정한다("예비중1"·"초7" 같은 건 분류하지 않는다).
  const withKind = g.match(/^([초중고])(\d+)$/);
  if (withKind) {
    const [, kind, num] = withKind;
    return Number(num) >= 1 && Number(num) <= MAX_GRADE[kind!]! ? `${kind}${Number(num)}` : GRADE_UNKNOWN;
  }
  if (/[초중고]/.test(g)) return GRADE_UNKNOWN; // "예비중1"·"중등부" 등 — 어느 학년인지 단정 못 한다

  const n = Number(g.match(/^\d+$/)?.[0]);
  if (!n) return GRADE_UNKNOWN; // "7세"처럼 학년이 아닌 표기

  const s = String(school ?? "");
  const kind = /고/.test(s) ? "고" : /중/.test(s) ? "중" : /초/.test(s) ? "초" : null;
  if (!kind) return GRADE_UNKNOWN; // 학교를 몰라 급을 모른다
  return n >= 1 && n <= MAX_GRADE[kind]! ? `${kind}${n}` : GRADE_UNKNOWN;
}

/** 학년 흐름 순(초1→고3). 문자 정렬은 "고1 < 중1 < 초1"이 되어 뒤집힌다. */
const GRADE_ORDER = [
  ...[1, 2, 3, 4, 5, 6].map((n) => `초${n}`),
  ...[1, 2, 3].map((n) => `중${n}`),
  ...[1, 2, 3].map((n) => `고${n}`),
];

export function sortGradeBars(bars: DistBar[]): DistBar[] {
  return [...bars].sort((a, b) => {
    const ia = GRADE_ORDER.indexOf(a.label);
    const ib = GRADE_ORDER.indexOf(b.label);
    if (ia === -1 && ib === -1) return b.n - a.n;
    if (ia === -1) return 1; // '분류 불가'는 항상 뒤 — 지표가 아니라 데이터 품질 표시다
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export type ConsultRow = {
  school: string | null;
  grade: string | null;
  enrolled: boolean;
};

/**
 * 학교를 특정할 수 없는 표기를 **버킷 하나로** 모은다(원장 2026-08-05: *"예비초는 하나로 묶고,
 * 미상(기타)도 하나로 묶자. 예비중등도 하나로 묶고 그런식으로"*).
 *
 * 안 묶으면 `예비칠성초`·`예비침산초`·`XX초`·`아무개`·`.`가 **각각 한 줄씩** 차지해 진짜 학교가
 * 목록 아래로 밀린다(실측: 매칭 실패 74종 220건, 그중 `XX초` 하나가 62건).
 *
 * ⚠️ **실제 학교는 절대 여기로 보내지 않는다** — `사대부초`(7건)·`대구공고`(3건)처럼 약칭이라
 * 공시에 못 붙는 것들은 그대로 남겨야 한다. 묶어 버리면 진짜 학교가 '미상'에 숨는다.
 * 그래서 판정은 **이름 모양**으로만 한다(예비/미취학/익명 자리표시), "공시에 없으면 미상"이 아니다.
 */
export function schoolBucket(raw: string | null): string | null {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s || s === "." || /^[.\-_]+$/.test(s)) return "학교 미상";
  // 미취학 — 7세·6세·유치·유아
  if (/^\d세$/.test(s) || /^(유치|유아|미취학)/.test(s)) return "미취학";
  // 예비(입학 예정) — 급까지 갈라 준다
  if (s.startsWith("예비")) {
    const rest = s.slice(2);
    if (/고/.test(rest)) return "예비 고등";
    if (/중/.test(rest)) return "예비 중등";
    if (/초/.test(rest)) return "예비 초등";
    return "예비 (급 미상)";
  }
  // 익명 자리표시 — "XX초"·"xx중"·"아무개". 급이 붙어 있어도 학교를 모르는 건 마찬가지다.
  if (/^(xx|XX|ㅇㅇ|00|--)/.test(s) || /^아무개/.test(s)) return "학교 미상";
  // 급만 적힌 것 — "초등"·"중등"(어느 학교인지 없다)
  if (/^(초등|중등|고등)$/.test(s)) return "학교 미상";
  return null; // 실제 학교로 본다
}

/** 묶음 버킷은 지표가 아니라 데이터 품질 표시 — 목록 맨 뒤로 보낸다. */
export const SCHOOL_BUCKETS = new Set([
  "학교 미상",
  "미취학",
  "예비 초등",
  "예비 중등",
  "예비 고등",
  "예비 (급 미상)",
]);

export type SchoolBar = {
  key: string;
  label: string;
  kind: "초" | "중" | "고" | null;
  n: number;
  enrolled: number;
  /** 전교생 수 — 공시 연도와 보는 연도가 같을 때만 채운다(아래 buildSchoolBars 주석). */
  total: number | null;
  rate: number | null;
};

/**
 * 상담 → 학교별 막대.
 *
 * 🔴 학교명을 정규화해 합친다 — 실측 2026년에 `침산초` 19건과 `침산초등학교` 11건이 **따로** 세어져
 * 있었다. 같은 학교가 둘로 갈리면 순위도 전환율도 틀린다.
 *
 * ⚠️ `totals`(전교생)는 **공시 연도와 보는 연도가 같을 때만** 넘겨야 한다. 우리가 가진 공시는 2026년
 * 한 해뿐이라, 2023년 상담을 2026년 전교생으로 나누면 그럴듯하지만 틀린 비율이 나온다.
 */
export function buildSchoolBars(
  rows: ConsultRow[],
  totals: Map<string, { name: string; kind: string; total: number }> | null,
): SchoolBar[] {
  const acc = new Map<string, { label: string; n: number; enrolled: number }>();
  for (const r of rows) {
    // 예비/미취학/익명 자리표시는 버킷 하나로 — 안 묶으면 각각 한 줄씩 차지해 진짜 학교를 밀어낸다.
    const key = schoolBucket(r.school) ?? normalizeSchoolName(r.school);
    if (!key) continue;
    const cur = acc.get(key);
    if (cur) {
      cur.n += 1;
      if (r.enrolled) cur.enrolled += 1;
    } else {
      acc.set(key, { label: r.school ?? key, n: 1, enrolled: r.enrolled ? 1 : 0 });
    }
  }
  const out: SchoolBar[] = [];
  for (const [key, v] of acc) {
    const t = totals?.get(key) ?? null;
    out.push({
      key,
      // 🔴 공시가 없을 땐 **원문이 아니라 정규화 키**를 쓴다. 원문을 쓰면 같은 목록에 `침산초등학교`와
      // `달성초`가 섞여 나온다 — 집계는 이미 합쳐져 있는데 이름만 그때그때 처음 본 표기를 따라간 것
      // (원장 2026-08-05 지적). 키는 항상 짧은 형태(`침산초`)라 목록이 한 규칙으로 읽힌다.
      // 공시가 있으면 정식 명칭이 더 정확하므로 그걸 우선한다.
      label: t?.name ?? (SCHOOL_BUCKETS.has(key) ? key : key),
      // 공시가 없어도 급은 이름 끝 글자로 안다 — 안 그러면 막대가 전부 회색이 된다.
      kind: (t?.kind as "초" | "중" | "고" | undefined) ?? kindFromKey(key),
      n: v.n,
      enrolled: v.enrolled,
      total: t?.total ?? null,
      rate: t?.total ? Math.round((v.n / t.total) * 1000) / 10 : null,
    });
  }
  // 묶음 버킷(미상·예비·미취학)은 지표가 아니라 데이터 품질 표시 — 항상 맨 뒤로.
  return out.sort((a, b) => {
    const ab = SCHOOL_BUCKETS.has(a.key) ? 1 : 0;
    const bb = SCHOOL_BUCKETS.has(b.key) ? 1 : 0;
    return ab - bb;
  });
}

/** 정규화 키 끝 글자로 학교급 추론(`침산초`→초). 묶음 버킷·판단 불가는 null. */
function kindFromKey(key: string): "초" | "중" | "고" | null {
  if (SCHOOL_BUCKETS.has(key)) return null;
  const last = key.at(-1);
  if (last === "초") return "초";
  if (last === "중") return "중";
  if (last === "고" || key.endsWith("여상")) return "고";
  return null;
}
