/** 영어 템플릿 모드 훅들(use-english-templates·use-english-output·use-english-generate)이 함께 쓰는 모양. */
import type { ReportTemplate } from "@/features/report-templates/defaults";
import type { OneScreenStudent, Subject } from "../types";
import type { EnglishRowFacts } from "../english-draft";
import type { JjDayCache } from "../jj-day";
import type { SubjectReport } from "./report-card";

/** 템플릿 목록 쪽(use-english-templates.ts)이 내는 것 중 판정·만들기가 읽는 것. 비동기 경로는 ref를 읽는다. */
export type EnglishTemplateList = {
  templatesLoaded: boolean;
  templateListFailed: boolean;
  englishTemplatesRef: { readonly current: ReportTemplate[] };
  templatesLoadedRef: { readonly current: boolean };
  templateListFailedRef: { readonly current: boolean };
  findTemplate: (templateId: string | undefined, list?: readonly ReportTemplate[]) => ReportTemplate | null;
};

export type EnglishFactsOf = (student: OneScreenStudent, su: Subject, rep?: SubjectReport, jjCache?: JjDayCache) => EnglishRowFacts;

export type PatchReport = (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
