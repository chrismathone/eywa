import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { latestStudentSourceFacts, visibleStudentFacts } from "@/features/students/ontology/visible-facts";
import { canReadFactSource, canResolveFactSource } from "@/features/students/ontology/read-policy";
import { assertRaws } from "../model/calc";
import { emptyRaws, type Metric, type Raws } from "../model/config";
import { emptyPayload, type ContributionPayload, type StoredContributionMonth } from "../model/stored";
import { MONTHS_TABLE } from "./store";

type Summary = { student_id: string; month: string; raws: Raws; correction: Raws; unavailable: Metric[];
  closed_at: string | null; reconstructed: boolean; computed_at: string; correction_reasons: ContributionPayload["correctionReasons"] | null };
export type DisplayContributionMonth = StoredContributionMonth & { withheldFacts?: number };

/** 추이에는 월별 수치만, 원본 근거에는 선택한 달만 읽는다. 집계 엔진의 마감 원본 로더와 분리한다. */
export async function loadStudentDisplayMonths(db: SupabaseClient, tenant: string, studentId: string, sourceIds: string[],
  requestedMonth: string | undefined, canonical: (id: string) => string, readable: ReadonlySet<string> | null): Promise<DisplayContributionMonth[]> {
  const rows = await fetchAllPagedInChunks<Summary>(sourceIds, (chunk, a, b) => db.from(MONTHS_TABLE)
    .select("student_id, month, raws, correction, unavailable, closed_at, reconstructed, computed_at, correction_reasons:payload->correctionReasons")
    .eq("tenant_id", tenant).in("student_id", chunk).order("student_id").order("month").range(a, b).returns<Summary[]>());
  const months = new Map<string, DisplayContributionMonth>();
  for (const r of rows.filter((row) => row.student_id === studentId)) {
    assertRaws(r.raws); assertRaws(r.correction);
    months.set(r.month, { studentId, month: r.month, raws: r.raws, correction: r.correction,
      unavailable: r.unavailable ?? [], closedAt: r.closed_at, reconstructed: r.reconstructed, computedAt: r.computed_at,
      historical: [], evidenceIds: [], payload: { ...emptyPayload(), correctionReasons: r.correction_reasons ?? [] } });
  }
  // 병합 전 원생에게만 있던 달도 선택할 수 있다. 이전 원생의 점수를 다시 더하지 않는다.
  for (const r of rows) if (!months.has(r.month)) months.set(r.month, {
    studentId, month: r.month, raws: emptyRaws(), correction: emptyRaws(), closedAt: null, reconstructed: false,
    computedAt: "", historical: [], unavailable: [], evidenceIds: [], payload: emptyPayload(),
  });
  const all = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const selected = months.get(requestedMonth ?? "") ?? all.at(-1);
  if (!selected) return all;
  const snapshots = await fetchAllPagedInChunks<Omit<Summary, "correction_reasons"> & { payload: Partial<ContributionPayload> }>(sourceIds,
    (chunk, a, b) => db.from(MONTHS_TABLE).select("student_id, month, raws, correction, unavailable, closed_at, reconstructed, computed_at, payload")
      .eq("tenant_id", tenant).eq("month", selected.month).in("student_id", chunk).order("student_id").range(a, b));
  const own = snapshots.find((r) => r.student_id === studentId);
  // 요약 조회와 근거 조회 사이에 집계가 끝나도 선택한 달의 수치와 근거는 같은 저장본을 쓴다.
  if (own) {
    assertRaws(own.raws); assertRaws(own.correction);
    Object.assign(selected, { raws: own.raws, correction: own.correction, unavailable: own.unavailable ?? [],
      closedAt: own.closed_at, reconstructed: own.reconstructed, computedAt: own.computed_at });
  } else if (selected.computedAt) throw new Error("월 기록이 바뀌었습니다. 다시 불러와 주세요");
  const latest = latestStudentSourceFacts(tenant, snapshots.map((r) => ({ computedAt: r.computed_at, facts: r.payload.facts ?? [] })));
  const safe = latest.filter((f) => canReadFactSource(f, readable) && canResolveFactSource(f, canonical));
  const facts = visibleStudentFacts(tenant, [{ computedAt: "", facts: safe }], canonical);
  selected.withheldFacts = latest.length - safe.length;
  // Never spread private frozen payload fields into a display response.
  selected.payload = { ...emptyPayload(), facts, coverage: own?.payload.coverage ?? [],
    subjects: own?.payload.subjects ?? [], correctionReasons: own?.payload.correctionReasons ?? [],
    corrections: readable === null || sourceIds.every((id) => readable.has(id)) ? own?.payload.corrections : [],
    evidenceIds: [...new Set(facts.flatMap((f) => f.evidence.map((e) => `${e.source}:${e.id}`)))] };
  selected.evidenceIds = selected.payload.evidenceIds;
  return all;
}
