import type { StudentFact, StudentRelation, SourceCoverage } from "@/features/students/ontology/types";
import type { BuiltMonth } from "./build";
import type { BillingSeed } from "./billing";
import type { Metric, Raws } from "./config";
import type { CorrectionDetail } from "./corrections";

export type ContributionPayload = {
  evidenceIds: string[];
  facts: StudentFact[];
  relations: StudentRelation[];
  coverage: SourceCoverage[];
  /** 지난 마감과 현재 원본의 차이. 원자료 종류별 증감과 사유를 표시한다. */
  correctionReasons: { metric: Metric; delta: number; reason: string }[];
  corrections?: CorrectionDetail[];
  subjects: string[];
};
export type StoredContributionMonth = BuiltMonth & {
  studentId: string; computedAt: string; historical: BillingSeed[]; unavailable: Metric[]; payload: ContributionPayload;
};
export type ContributionTotal = { studentId: string; raws: Raws; recent: Raws; computedAt: string; unavailable: Metric[] };
export const emptyPayload = (): ContributionPayload => ({ evidenceIds: [], facts: [], relations: [], coverage: [], correctionReasons: [], subjects: [] });
