/**
 * 유입경로 원문 → 집계 버킷.
 *
 * `consultation_path`는 자유 텍스트라 실측 **210종**이다(681건 중 1건짜리가 160종). 그대로 group by 하면
 * 210줄짜리 표가 나와 아무 판단도 안 된다. 원문은 보존하고(누가 소개했는지 같은 정보가 들어 있다)
 * **표시·집계만** 이 함수로 묶는다.
 *
 * 🔴 순서가 규칙이다. "인터넷 김나윤 친구"처럼 두 단서가 섞인 값이 있어 먼저 걸린 쪽으로 간다.
 *    사람이 실제로 쓴 표기(실측)를 근거로 **소개 > 설명회 > 인터넷 > 간판·광고** 순으로 본다:
 *    소개는 명시적으로 적어야만 나타나는 신호라 가장 신뢰도가 높고, 간판·광고는 "인터넷, 간판"처럼
 *    곁들여 적히는 경우가 많아 뒤로 뺀다.
 *
 * ⚠️ **상담 본문에서 경로를 추측하지 말 것.** 2026-08-04에 시도했다가 접었다: 본문을 키워드로 훑으면
 *    "소개·추천 단서 573건"이 나오는데 열어보면 `-추천: 화수금 4:20-6:10`처럼 **"추천"이 반 추천**이었다
 *    (380건 중 228건). 실제 유입경로 표현은 9건뿐. 지어낸 경로는 미기재보다 나쁘다 — 미기재는 눈에
 *    보이지만 틀린 값은 아무도 못 알아본다. 이 함수는 **경로 칸에 사람이 적은 값만** 본다.
 */
export const PATH_BUCKETS = [
  "소개·추천",
  "설명회",
  "인터넷",
  "간판·광고",
  "워크인·주변",
  "기타",
  "미기재",
] as const;

export type PathBucket = (typeof PATH_BUCKETS)[number];

/** 버킷별 색 — globals.css 토큰만(리터럴 hex 금지, 도넛/막대가 같은 색을 쓰도록 한 곳에서). */
export const PATH_BUCKET_COLOR: Record<PathBucket, string> = {
  "소개·추천": "var(--color-chart-2)",
  설명회: "var(--color-primary)",
  인터넷: "var(--color-blue)",
  "간판·광고": "var(--color-gold)",
  "워크인·주변": "var(--color-purple)",
  기타: "var(--color-amber)",
  미기재: "var(--color-text-faint)",
};

// 실측 표기를 근거로 한 규칙. 새 표기가 늘면 여기 추가하고 테스트도 함께 늘린다.
const RULES: { bucket: PathBucket; re: RegExp }[] = [
  // 소개 — "재원생 하수빈 소개", "김민승동생", "오빠 수강중", "친구추천(입시관)", "지인소개"
  { bucket: "소개·추천", re: /소개|지인|친구|재원생|수강생|수강중|동생|누나|형제|자매|오빠|언니|추천/ },
  { bucket: "설명회", re: /설명회|간담회/ },
  // 인터넷 — "인터넷 검색", "검색", "블로그", "인터넷 블로그", "맘카페"
  { bucket: "인터넷", re: /인터넷|검색|블로그|카페|네이버|온라인|홈페이지|당근/ },
  // 간판·광고 — "간 판"처럼 띄어쓴 것도 있어 공백을 지운 뒤 본다
  { bucket: "간판·광고", re: /간판|현수막|전단|엘리베이터|광고|배너|버스/ },
  { bucket: "워크인·주변", re: /워크인|방문|지나|근처|주변|동네/ },
];

/**
 * 원문 → 버킷. null·빈 문자열은 "미기재"(집계에서 빼지 않는다 — 미상이 69%라 숨기면 다른 숫자가 다 거짓말이 된다).
 */
export function pathBucket(raw: string | null | undefined): PathBucket {
  const s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "미기재";
  for (const { bucket, re } of RULES) if (re.test(s)) return bucket;
  return "기타";
}

export type PathStatRow = {
  path: string | null;
  total: number;
  enrolled: number;
  paidSum: number;
  /** 등록 건 중 **금액이 적힌** 건수. 0179a 적용 전엔 null(그땐 건당 평균을 안 그린다). */
  paidCount: number | null;
};
export type BucketStat = {
  bucket: PathBucket;
  total: number;
  enrolled: number;
  paidSum: number;
  /** 금액이 적힌 등록 건수 — 건당 평균의 분모. null이면 알 수 없음(표시 생략). */
  paidCount: number | null;
  /**
   * 건당 평균(원). 🔴 분모는 `enrolled`가 아니라 `paidCount`다 — 금액 기재율이 경로마다 달라
   * (실측 소개 74% vs 인터넷 51%) 등록 건수로 나누면 건당이 실제보다 낮게 나온다(소개 34% 과소).
   */
  avgPaid: number | null;
  /** 등록 전환율(%). 분모가 0이면 null — 0%로 적으면 "다 놓쳤다"로 읽힌다. */
  rate: number | null;
  /** 이 버킷에 묶인 원문들(많은 순) — 화면에서 "무엇이 이렇게 묶였나"를 펼쳐 볼 수 있게. */
  samples: { path: string; total: number }[];
};

/** 원문 집계 행 → 버킷 집계. 합계는 항상 입력 총합과 같다(어디로도 사라지지 않는다). */
export function bucketizePathStats(rows: PathStatRow[]): BucketStat[] {
  const map = new Map<PathBucket, BucketStat>();
  for (const b of PATH_BUCKETS)
    map.set(b, {
      bucket: b,
      total: 0,
      enrolled: 0,
      paidSum: 0,
      paidCount: null,
      avgPaid: null,
      rate: null,
      samples: [],
    });

  for (const r of rows) {
    const b = map.get(pathBucket(r.path))!;
    b.total += r.total;
    b.enrolled += r.enrolled;
    b.paidSum += r.paidSum;
    // 하나라도 숫자를 알면 합산 시작. 전부 null(0179a 미적용)이면 null로 남아 화면이 건당을 안 그린다.
    if (r.paidCount !== null) b.paidCount = (b.paidCount ?? 0) + r.paidCount;
    if (r.path) b.samples.push({ path: r.path, total: r.total });
  }
  for (const b of map.values()) {
    b.rate = b.total > 0 ? Math.round((b.enrolled / b.total) * 100) : null;
    b.avgPaid = b.paidCount && b.paidCount > 0 ? Math.round(b.paidSum / b.paidCount) : null;
    b.samples.sort((a, c) => c.total - a.total);
  }
  // 건수 많은 순. '미기재'는 값이 있어도 항상 끝으로 — 지표가 아니라 데이터 품질 표시다.
  return [...map.values()]
    .filter((b) => b.total > 0)
    .sort((a, c) =>
      a.bucket === "미기재" ? 1 : c.bucket === "미기재" ? -1 : c.total - a.total,
    );
}
