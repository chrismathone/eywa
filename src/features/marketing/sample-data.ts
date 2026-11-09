import { blankCampaign, type Bill, type Campaign, type CampaignDocument, type Intake, type MarketingData, type Person, type Touch } from "./model";
import type { MarketingInputRecord } from "./input-model";
import { sampleOperationRows, sampleWorkItems } from "./sample-data-operations";

/**
 * 홍보·마케팅 시안의 예시 값 — 🔴 DB를 읽지 않는다(marketing_* 표가 이 DB에 없다).
 * 이름·학교·금액은 지어낸 값이다. 무작위가 아니라 번호로 정해져 새로고침해도 같다.
 */
export const SAMPLE_TODAY = "2026-11-09";
const OBSERVED_AT = "2026-11-09T09:00:00.000Z";

/** 예시 고유번호 — 스키마가 uuid 모양을 기대해서 모양만 맞춘다. */
export const sampleId = (group: number, n: number) => `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(n).padStart(12, "0")}`;

export const SAMPLE_STAFF = [
  { id: sampleId(9, 1), name: "김하늘" }, { id: sampleId(9, 2), name: "이도윤" }, { id: sampleId(9, 3), name: "박서준" },
  { id: sampleId(9, 4), name: "최유나" }, { id: sampleId(9, 5), name: "정민호" }, { id: sampleId(9, 6), name: "한지우" },
];
export const SAMPLE_ACTOR = SAMPLE_STAFF[0]!.id;

type Seed = [n: number, title: string, channel: CampaignDocument["channel"], start: string, end: string, state: CampaignDocument["state"], season: CampaignDocument["season"], audience: string, cost: number | null, closed: boolean, objective?: CampaignDocument["objective"]];
const SEEDS: Seed[] = [
  [1, "2024 신학기 입시 설명회", "seminar", "2024-03-09", "2024-03-09", "held", "new_term", "침산중 · 중1~2", 900_000, true],
  [2, "2024 여름방학 특강 설명회", "seminar", "2024-06-15", "2024-06-15", "held", "summer", "대구일중 · 중2", 700_000, true],
  [3, "2024 겨울방학 설명회", "seminar", "2024-12-14", "2024-12-14", "held", "winter", "예비 중1", 800_000, true],
  [4, "2025 신학기 입시 설명회", "seminar", "2025-03-08", "2025-03-08", "held", "new_term", "침산중 · 중1~2", 1_000_000, true],
  [5, "2025 여름방학 특강 설명회", "seminar", "2025-06-14", "2025-06-14", "held", "summer", "대구일중 · 중2", 800_000, true],
  [6, "학교 앞 전단지 — 칠성중", "flyer", "2025-07-05", "2025-07-05", "held", "summer", "칠성중 · 중1~3", 300_000, true],
  [7, "예비 중1 설명회", "seminar", "2025-10-25", "2025-10-25", "held", "transition", "초6 학부모", 900_000, true],
  [8, "2025 겨울방학 설명회", "seminar", "2025-12-13", "2025-12-13", "held", "winter", "예비 중1", 850_000, true],
  [11, "2026 신학기 입시 설명회", "seminar", "2026-03-07", "2026-03-07", "held", "new_term", "침산중 · 중1~2", 1_200_000, true],
  [12, "침산중 앞 전단 배부", "flyer", "2026-03-02", "2026-03-02", "held", "new_term", "침산중 · 중1", 320_000, true],
  [13, "여름방학 특강 설명회", "seminar", "2026-06-13", "2026-06-13", "held", "summer", "대구일중 · 중2", 900_000, true],
  [14, "학교 앞 전단지 — 대구일중", "flyer", "2026-06-20", "2026-06-20", "held", "summer", "대구일중 · 중1~3", 350_000, true],
  [15, "엘리베이터 광고 (7월)", "elevator", "2026-07-01", "2026-07-31", "held", "summer", "침산동 아파트 3개 단지", 600_000, true],
  [16, "재원생 학부모 간담회", "seminar", "2026-07-18", "2026-07-18", "held", "summer", "재원생 학부모", 200_000, true, "retention"],
  [17, "침산 사거리 현수막", "banner", "2026-08-05", "2026-08-25", "held", "summer", "침산동 일대", 250_000, false],
  [18, "블로그 수업 후기 연재", "blog", "2026-08-22", "2026-09-30", "held", "always", "온라인 · 중등 학부모", null, false, "brand"],
  [19, "SNS 광고 (중간고사 대비)", "social", "2026-09-05", "2026-09-19", "cancelled", "midterm", "중2~3 학부모", null, false],
  [20, "중간고사 대비 공개 수업", "event", "2026-09-12", "2026-09-12", "held", "midterm", "재원생 · 형제 소개", 300_000, false],
  [21, "택배차 광고 (10월)", "delivery", "2026-10-01", "2026-10-31", "held", "always", "침산동 · 칠성동", 800_000, false],
  [22, "예비 중1 설명회", "seminar", "2026-10-25", "2026-10-25", "held", "transition", "초6 학부모", 1_000_000, false],
  [23, "기말고사 대비 설명회", "seminar", "2026-11-21", "2026-11-21", "planned", "final", "중1~2 학부모", null, false],
  [24, "겨울방학 특강 설명회", "seminar", "2026-12-12", "2026-12-12", "planned", "winter", "예비 중1 · 중2", null, false],
  [31, "2027 신학기 입시 설명회", "seminar", "2027-03-06", "2027-03-06", "planned", "new_term", "침산중 · 중1~2", null, false],
];

function campaign([n, title, channel, start, end, state, season, audience, cost, closed, objective = "acquisition"]: Seed): Campaign {
  const document: CampaignDocument = {
    ...blankCampaign(start), title, channel, objective, start, end, state, season, audience,
    budget: cost === null ? (state === "planned" ? 1_000_000 : null) : Math.round(cost * 1.1 / 10_000) * 10_000,
    actualCost: cost, costBasis: cost === null ? "" : `예시 전표 ${start.replaceAll("-", "")}-${n} · 인쇄·대관·다과 포함`,
    variableCost: closed && cost !== null ? Math.round(cost * 1.5 / 10_000) * 10_000 : null, measurementClosed: closed,
    note: state === "planned" ? "담당자 배정 후 준비 업무 진행" : "",
    sources: n % 3 === 0 ? [] : [{ provider: n % 2 ? "calendar" : "notion", key: `sample-${n}`, title: `${title} 일정 원본`, url: `https://example.com/aywa-sample/${n}`, excerpt: `${start} ${title} · ${audience}`, observedAt: OBSERVED_AT }],
  };
  return { id: sampleId(1, n), origin_key: `sample:${n}`, version: 1 + (n % 3), document, updated_at: `${start}T10:00:00.000Z` };
}

const duplicate = campaign([25, "여름방학 특강 설명회 (캘린더 사본)", "seminar", "2026-06-13", "2026-06-13", "duplicate", "summer", "대구일중 · 중2", null, false]);
export const SAMPLE_CAMPAIGNS: Campaign[] = [...SEEDS.map(campaign), { ...duplicate, document: { ...duplicate.document, duplicateOf: sampleId(1, 13) } }];

const FAMILY = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
const GIVEN = ["서연", "도윤", "하은", "지호", "민준", "수아", "예준", "지우", "서진", "하린", "시우", "유나", "준서", "채원", "건우"];
const SCHOOLS = ["침산중", "대구일중", "칠성중", "경명여중"];
const name = (n: number) => `${FAMILY[n % FAMILY.length]}${GIVEN[(n * 7) % GIVEN.length]}`;
const addDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/** [캠페인 번호, 문의 학생 수, 등록 학생 수] — 등록 학생은 접점 뒤 2~5주에 등록한다. */
const FUNNEL: [number, number, number][] = [[1, 4, 2], [2, 4, 2], [3, 4, 2], [4, 6, 3], [6, 3, 1], [8, 5, 2], [11, 8, 4], [12, 5, 2], [13, 7, 4], [14, 5, 2], [15, 4, 1], [17, 3, 1], [20, 3, 1], [21, 4, 1], [22, 6, 2], [5, 5, 3], [7, 5, 2]];

function buildFunnel() {
  const people: Person[] = [], intakes: Intake[] = [], touches: Touch[] = [];
  let k = 0;
  for (const [n, inquiries, enrolled] of FUNNEL) {
    const c = SAMPLE_CAMPAIGNS.find((x) => x.id === sampleId(1, n))!.document;
    for (let i = 0; i < inquiries; i++, k++) {
      const touchDate = addDays(c.start, i % 4), enrolledAt = i < enrolled ? addDays(touchDate, 14 + (i % 3) * 7) : null;
      const studentId = enrolledAt && enrolledAt <= SAMPLE_TODAY ? sampleId(2, k) : null, consultationId = sampleId(3, k);
      if (studentId) people.push({ id: studentId, name: name(k), school: SCHOOLS[k % 4]!, grade: `중${1 + (k % 3)}`, enrolledAt, firstClass: addDays(enrolledAt!, 2) });
      intakes.push({ id: consultationId, studentId, name: name(k), date: touchDate, path: k % 5 === 0 ? "지인 소개" : "설명회·광고" });
      touches.push({ id: sampleId(4, k), version: 1, updated_at: `${touchDate}T12:00:00.000Z`, document: { campaignId: sampleId(1, n), studentId, consultationId, date: touchDate, kind: c.channel === "seminar" ? "attended" : "inquiry", basis: i % 2 ? "qr" : "self_report", reference: `예시 기록 · 상담 시 ${c.title} 확인`, verified: i !== inquiries - 1 || n > 20 ? true : false, active: true } });
      if (c.channel === "seminar") touches.push({ id: sampleId(5, k), version: 1, updated_at: `${touchDate}T12:00:00.000Z`, document: { campaignId: sampleId(1, n), studentId, consultationId, date: touchDate, kind: "inquiry", basis: "staff_record", reference: "설명회 현장 상담 신청", verified: true, active: true } });
    }
  }
  return { people, intakes, touches };
}

const MONTHS = Array.from({ length: 35 }, (_, i) => new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 7)).filter((m) => m <= SAMPLE_TODAY.slice(0, 7));

function buildBills(people: Person[]) {
  const bills: Bill[] = [], background: Person[] = Array.from({ length: 18 }, (_, i) => ({ id: sampleId(6, i), name: name(i + 40), school: SCHOOLS[i % 4]!, grade: `중${1 + (i % 3)}`, enrolledAt: "2023-03-02", firstClass: "2023-03-04" }));
  for (const p of background) for (const [mi, month] of MONTHS.entries()) {
    const seasonal = [1, 2, 6, 7].includes(Number(month.slice(5))) ? 1.15 : 1;
    bills.push({ id: `${p.id}:${month}`, studentId: p.id, month, net: Math.round((2_400_000 + mi * 28_000 + (p.id.charCodeAt(35) % 5) * 90_000) * seasonal / 1000) * 1000, status: "paid" });
  }
  for (const p of people) for (const month of MONTHS.filter((m) => m >= p.enrolledAt!.slice(0, 7)))
    bills.push({ id: `${p.id}:${month}`, studentId: p.id, month, net: 380_000 + (p.id.charCodeAt(35) % 4) * 40_000, status: month === "2026-09" && p.id.endsWith("7") ? "refunded" : "paid" });
  return { bills, background };
}

export const SAMPLE_INPUT_RECORDS: MarketingInputRecord[] = [
  { id: sampleId(7, 1), campaign_id: sampleId(1, 22), student_id: null, consultation_id: sampleId(3, 60), actor_id: SAMPLE_STAFF[2]!.id, document: { kind: "inquiry", channel: "seminar", date: "2026-10-28", basis: "self_report", reference: "학부모가 예비 중1 설명회에서 받은 안내문을 보고 연락", unknownReason: "" }, status: "submitted", version: 1, created_at: "2026-10-28T08:20:00.000Z", reviewed_at: null, reviewer_id: null, review_note: null, touch_id: null },
  { id: sampleId(7, 2), campaign_id: sampleId(1, 21), student_id: sampleId(2, 52), consultation_id: null, actor_id: SAMPLE_STAFF[3]!.id, document: { kind: "attended", channel: "delivery", date: "2026-10-15", basis: "staff_record", reference: "택배차 광고 보고 체험 수업 참석 — 담임 확인", unknownReason: "" }, status: "submitted", version: 1, created_at: "2026-10-15T09:00:00.000Z", reviewed_at: null, reviewer_id: null, review_note: null, touch_id: null },
  { id: sampleId(7, 3), campaign_id: null, student_id: null, consultation_id: sampleId(3, 61), actor_id: SAMPLE_STAFF[5]!.id, document: { kind: "inquiry", channel: "other", date: "2026-11-02", basis: "self_report", reference: "전화 문의 — 어디서 보셨는지 기억하지 못함", unknownReason: "학부모 응답 없음" }, status: "submitted", version: 1, created_at: "2026-11-02T05:10:00.000Z", reviewed_at: null, reviewer_id: null, review_note: null, touch_id: null },
  { id: sampleId(7, 4), campaign_id: sampleId(1, 13), student_id: null, consultation_id: sampleId(3, 18), actor_id: SAMPLE_STAFF[2]!.id, document: { kind: "inquiry", channel: "seminar", date: "2026-06-14", basis: "qr", reference: "설명회 QR 신청서 응답", unknownReason: "" }, status: "approved", version: 2, created_at: "2026-06-14T03:00:00.000Z", reviewed_at: "2026-06-16T02:00:00.000Z", reviewer_id: SAMPLE_ACTOR, review_note: "QR 응답 시각과 상담일 일치", touch_id: sampleId(5, 18) },
  { id: sampleId(7, 5), campaign_id: sampleId(1, 15), student_id: null, consultation_id: sampleId(3, 34), actor_id: SAMPLE_STAFF[5]!.id, document: { kind: "inquiry", channel: "banner", date: "2026-07-09", basis: "self_report", reference: "현수막 보고 왔다고 함", unknownReason: "" }, status: "rejected", version: 2, created_at: "2026-07-09T06:00:00.000Z", reviewed_at: "2026-07-10T01:00:00.000Z", reviewer_id: SAMPLE_ACTOR, review_note: "7월에는 현수막을 걸지 않았음 — 엘리베이터 광고 여부 다시 확인", touch_id: null },
];

/** 홍보·마케팅 성과 화면이 받던 모양 그대로(연도만 바꿔 끼운다). */
export function sampleMarketing(year: number): MarketingData {
  const { people, intakes, touches } = buildFunnel(), { bills, background } = buildBills(people);
  const years = [...new Set([2024, 2025, 2026, year, ...SAMPLE_CAMPAIGNS.map((c) => Number(c.document.start.slice(0, 4)))])].sort();
  return {
    today: SAMPLE_TODAY, observedAt: OBSERVED_AT, year, campaigns: SAMPLE_CAMPAIGNS, touches, people: [...people, ...background], intakes, bills,
    inputRecords: SAMPLE_INPUT_RECORDS, operations: sampleOperationRows(), workItems: sampleWorkItems(),
    yearCoverage: years.map((y) => { const rows = bills.filter((b) => b.month.startsWith(String(y))); return { year: y, months: new Set(rows.map((b) => b.month)).size, net: rows.reduce((s, b) => s + (b.status === "refunded" ? 0 : b.net), 0) }; }),
  };
}
