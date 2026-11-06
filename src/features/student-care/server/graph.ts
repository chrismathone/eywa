import "server-only";
import { careAccess } from "./access";
import { getStudentCare } from "./queries";
import { careGraph } from "../graph";

/** AI 소비자용 읽기 경계. 실제 화면과 같은 조회·담당 범위이며 자동 실행 권한을 주지 않는다. */
export async function getStudentCareGraph(studentId: string) {
  const access = await careAccess(studentId);
  const view = await getStudentCare(studentId);
  if (view.error) return { status: "unavailable" as const, error: view.error, graph: null };
  const allowedSources = new Set(view.references.sources.map((source) => source.id));
  const records = view.records.map((record) => ({ ...record, document: { ...record.document,
    content: { ...record.document.content, sourceId: record.document.content.sourceId && allowedSources.has(record.document.content.sourceId) ? record.document.content.sourceId : null },
    evidence: record.document.evidence.filter((evidence) => (evidence.kind === "english_sheet" || evidence.kind === "math_sheet" ? view.references.evidence.some((r) => r.kind === evidence.kind && r.id === evidence.recordId) : view.references.evidenceKinds.includes(evidence.kind))),
  } }));
  const omitted = records.some((record, i) => record.document.evidence.length !== view.records[i].document.evidence.length);
  return { status: view.more || view.references.warning || omitted ? "partial" as const : "ready" as const, error: null, graph: careGraph(access.user.tenantId, records) };
}
