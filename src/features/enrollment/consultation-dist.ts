/**
 * 등록상담 분포(학년·지역·학교)의 순수 계산부.
 *
 * 🔴 여기는 **등록상담 화면**이다 — 재원생/퇴원생 분포를 넣었다가 원장 지적을 받았다(2026-08-05:
 * *"재원생 퇴원생 분석은 여기서 하는게 아니지. 지금 대분류가 등록상담인데"*). 재원생 기준은 연도
 * 선택과도 무관해 화면이 거짓말을 했다(연도를 바꿔도 숫자가 그대로였다). 상담 기준이면 연도가 산다.
 */
import { normalizeSchoolName } from "@/features/schools/school-name";

export type DistBar = { label: string; n: number; enrolled: number };

/** 학년 라벨 정규화 결과. 급을 모르면 숫자만 남는다(추측해서 붙이지 않는다). */
export function gradeLabel(rawGrade: string | null, school: string | null): string {
  const g = String(rawGrade ?? "").trim();
  if (!g) return "미상";
  // 이미 급이 붙어 있으면 그대로("중2"·"초4"·"예비중1").
  if (/[초중고]/.test(g)) return g.replace(/\s+/g, "");
  const n = g.match(/\d+/)?.[0];
  if (!n) return g; // "7세"처럼 숫자 학년이 아닌 표기
  // 🔴 급은 **학교명에서** 가져온다. 상담엔 학년이 "2"처럼 숫자만 적힌 게 많은데(2026년 35건),
  // 학교가 99% 채워져 있어 거기서 급을 알 수 있다. 학교가 없으면 급 없이 숫자만 둔다 —
  // 초2와 중2를 한 칸에 합치면 분포가 통째로 거짓말이 된다.
  const s = String(school ?? "");
  const kind = /고/.test(s) ? "고" : /중/.test(s) ? "중" : /초/.test(s) ? "초" : null;
  return kind ? `${kind}${n}` : `${n}학년`;
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
    if (ia === -1) return 1; // 급을 모르는 표기·미상은 뒤로
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export type ConsultRow = {
  school: string | null;
  grade: string | null;
  enrolled: boolean;
};

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
    const key = normalizeSchoolName(r.school);
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
      // 공시명이 있으면 정식 명칭으로("침산초" → "대구침산초등학교") — 같은 학교를 한 이름으로 부른다.
      label: t?.name ?? v.label,
      kind: (t?.kind as "초" | "중" | "고" | undefined) ?? null,
      n: v.n,
      enrolled: v.enrolled,
      total: t?.total ?? null,
      rate: t?.total ? Math.round((v.n / t.total) * 1000) / 10 : null,
    });
  }
  return out;
}
