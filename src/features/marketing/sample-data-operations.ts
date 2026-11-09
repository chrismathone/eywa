import { instantiateTasks, type Operation, type OperationDocument, type OperationsData, type TemplateKey, type WorkItem } from "./operations-model";
import type { AnnualPlanning } from "./annual-planning-model";
import type { CampaignChoice, MarketingInputRecord } from "./input-model";
import { SAMPLE_ACTOR, SAMPLE_CAMPAIGNS, SAMPLE_INPUT_RECORDS, SAMPLE_STAFF, SAMPLE_TODAY, sampleId, sampleMarketing } from "./sample-data";

/**
 * 연간 운영계획·행사 업무·입력 검토 시안의 예시 값 — 🔴 DB를 읽지 않는다(marketing_operations·marketing_work_items 표가 이 DB에 없다).
 * 모듈을 읽을 때가 아니라 함수를 부를 때 만든다(sample-data.ts와 서로 가져다 써서).
 */
type OpSeed = [n: number, template: TemplateKey, owner: number, location: string, brief: string, attendees: number | null, enrollments: number | null, retro: string, next: string, planning?: AnnualPlanning];
function opSeeds(): OpSeed[] {
  return [
    [4, "seminar", 1, "본원 3층 강의실", "신학기 내신 대비 전략과 반 편성 안내", 40, 6, "참석 38명. 질문 시간이 짧았다는 의견이 많았음.", "질의응답 20분 확보, 상담 예약 동선을 출구 쪽으로"],
    [7, "seminar", 2, "본원 3층 강의실", "예비 중1 학습 로드맵 소개", 30, 5, "초6 학부모 27명 참석. 레벨테스트 신청 9건.", "레벨테스트를 현장에서 바로 예약받기"],
    [11, "seminar", 1, "본원 3층 강의실", "2026 신학기 내신 전략 · 반 편성 안내", 45, 6, "참석 41명, 현장 상담 신청 12건. 주차 안내가 부족했음.", "주차 안내 문자를 전날 발송"],
    [13, "seminar", 2, "본원 3층 강의실", "여름방학 특강 구성과 시간표 안내", 35, 5, "참석 29명. 기말고사 직후라 참석률이 예년보다 낮음.", "기말고사 일주일 뒤로 일정 조정 검토"],
    [14, "flyer", 3, "대구일중 정문 · 후문", "하교 시간 2개 조로 1,200부 배부", null, 3, "배부 1,100부, QR 문의 6건.", "후문 쪽 배부 인원을 1명 더 배치"],
    [20, "custom", 4, "본원 2층", "형제·친구 동반 공개 수업 2회", 20, 2, "참석 14명, 체험 후 상담 4건.", "공개 수업 뒤 바로 상담 예약 받기"],
    [22, "seminar", 1, "본원 3층 강의실", "예비 중1 설명회 — 중등 수학·영어 학습 로드맵", 40, 6, "참석 33명. 결과 집계 중.", ""],
    [23, "seminar", 2, "본원 3층 강의실", "기말고사 대비 학년별 전략", 30, 3, "", ""],
    [24, "seminar", 1, "본원 3층 강의실", "겨울방학 특강 · 예비 중1 반 편성", 40, 6, "", ""],
    [31, "seminar", 1, "본원 3층 강의실", "2027 신학기 설명회 — 지난 3년 질문을 반영한 Q&A 확대", 45, 7, "", "", { targetYear: 2027, referenceIds: [sampleId(1, 4), sampleId(1, 11)], decision: "improve", reason: "2025·2026 모두 질문 시간이 짧다는 의견 — Q&A를 20분으로 늘리고 주차 안내를 미리 보낸다", considerations: "침산중 개학일 확인, 3층 강의실 대관 일정" }],
  ];
}

export function sampleOperationRows(): Operation[] {
  return opSeeds().map(([n, template, owner, location, brief, targetAttendees, targetEnrollments, retrospective, nextAction, annualPlanning]) => {
    const document: OperationDocument = { template, ownerId: SAMPLE_STAFF[owner - 1]!.id, location, brief, targetAttendees, targetEnrollments, retrospective, nextAction, resources: n % 2 ? [{ title: "행사 기획안", url: `https://example.com/aywa-sample/plan-${n}` }] : [], ...(annualPlanning ? { annualPlanning } : {}) };
    return { campaign_id: sampleId(1, n), document, version: 2, template_version: 1 };
  });
}

export function sampleWorkItems(): WorkItem[] {
  return sampleOperationRows().flatMap((o, oi) => {
    const start = SAMPLE_CAMPAIGNS.find((c) => c.id === o.campaign_id)!.document.start;
    return instantiateTasks(o.document.template, start, o.document.ownerId).map((t, ti) => {
      const assigneeId = SAMPLE_STAFF[(oi + ti) % SAMPLE_STAFF.length]!.id, done = t.due < "2026-11-03";
      return { id: sampleId(8, oi * 100 + ti), campaign_id: o.campaign_id, version: 1, document: { ...t, assigneeId, status: done ? "done" as const : "open" as const, result: done ? "예시 결과 — 일정대로 완료" : "" } };
    });
  });
}

function references(): OperationsData["annualReferences"] {
  const ops = sampleOperationRows();
  return SAMPLE_CAMPAIGNS.filter((c) => c.document.state !== "duplicate").map((c) => {
    const d = c.document, o = ops.find((x) => x.campaign_id === c.id)?.document;
    return { id: c.id, document: { title: d.title, start: d.start, end: d.end, channel: d.channel, state: d.state, audience: d.audience, objective: d.objective, season: d.season, budget: d.budget, actualCost: d.actualCost }, retrospective: o?.retrospective ?? "", nextAction: o?.nextAction ?? "", planning: o?.annualPlanning ?? null };
  });
}

/** 연간 운영계획 화면이 받던 모양 — 원장 계정으로 본다고 가정(기획·분석 권한 모두 켬). */
export function sampleOperations(selectedId?: string): OperationsData {
  const ops = sampleOperationRows(), tasks = sampleWorkItems(), adopted = new Set(ops.map((o) => o.campaign_id));
  const selected = SAMPLE_CAMPAIGNS.find((c) => c.id === selectedId && c.document.state !== "duplicate");
  let detail: OperationsData["selected"] = null;
  if (selected) {
    const m = sampleMarketing(Number(selected.document.start.slice(0, 4)));
    const people = [
      ...m.people.slice(0, 40).map((p) => ({ id: p.id, type: "student" as const, name: p.name, detail: [p.school, p.grade].filter(Boolean).join(" · ") })),
      ...m.intakes.filter((i) => !i.studentId).slice(0, 20).map((i) => ({ id: i.id, type: "consultation" as const, name: i.name, detail: "신규 상담" })),
    ];
    detail = { campaign: selected, operation: ops.find((o) => o.campaign_id === selected.id) ?? null, tasks: tasks.filter((t) => t.campaign_id === selected.id), people, inputs: SAMPLE_INPUT_RECORDS.filter((r) => r.campaign_id === selected.id), touches: m.touches.filter((t) => t.document.campaignId === selected.id), canRecordStudents: true, canRecordIntakes: true };
  }
  return {
    today: SAMPLE_TODAY, actorId: SAMPLE_ACTOR, canPlan: true, canWork: true, canAnalyze: true, canEditCost: true, annualReferences: references(), tasks, staff: SAMPLE_STAFF, selected: detail,
    campaigns: SAMPLE_CAMPAIGNS.filter((c) => c.document.state !== "duplicate").map((c) => ({ id: c.id, version: c.version, updated_at: c.updated_at, adopted: adopted.has(c.id), document: { title: c.document.title, start: c.document.start, end: c.document.end, channel: c.document.channel, state: c.document.state, audience: c.document.audience } })),
  };
}

/** 입력·검토 화면이 받던 모양. */
export function sampleMarketingReview(): { campaigns: CampaignChoice[]; records: (MarketingInputRecord & { subjectLabel: string; actorLabel: string })[]; pending: number } {
  const m = sampleMarketing(2026), subjects = new Map<string, string>([...m.people.map((p) => [p.id, p.name] as const), ...m.intakes.map((i) => [i.id, i.name] as const)]);
  const campaigns = SAMPLE_CAMPAIGNS.filter((c) => !["duplicate", "cancelled"].includes(c.document.state)).map((c) => ({ id: c.id, title: c.document.title, channel: c.document.channel, start: c.document.start, end: c.document.end })).sort((a, b) => b.start.localeCompare(a.start));
  const records = SAMPLE_INPUT_RECORDS.map((r) => ({ ...r, subjectLabel: subjects.get(r.consultation_id ?? r.student_id ?? "") ?? "윤채원(예시)", actorLabel: SAMPLE_STAFF.find((u) => u.id === r.actor_id)?.name ?? "담당자" }));
  return { campaigns, records, pending: records.filter((r) => r.status === "submitted").length };
}
