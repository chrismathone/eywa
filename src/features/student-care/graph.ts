import type { CareRecord } from "./model";

/** 권한 확인이 끝난 기록만 넘긴다. 증거 연결은 인과 추론이나 자동 완료 판정이 아니다. */
export function careGraph(tenantId: string, records: readonly CareRecord[]) {
  const nodes = new Map<string, { id: string; kind: string; sourceId: string; attributes?: Record<string, string | number> }>();
  const edges: { from: string; to: string; kind: string; commitmentId: string; revision: number; state: string; basis: "recorded" }[] = [];
  const node = (kind: string, sourceId: string) => {
    const id = `${tenantId}:${kind}:${sourceId}`;
    nodes.set(id, { id, kind, sourceId });
    return id;
  };
  for (const record of records) {
    const doc = record.document;
    const promise = node("commitment", record.id);
    nodes.get(promise)!.attributes = { need: doc.content.need, promise: doc.content.promise, criterion: doc.content.criterion,
      dueOn: doc.content.dueOn, subject: doc.content.subject, revision: doc.revision, state: doc.state, version: record.version };
    const add = (from: string, to: string, kind: string) => edges.push({ from, to, kind, commitmentId: record.id, revision: doc.revision, state: doc.state, basis: "recorded" });
    if (record.studentId) add(node("student", record.studentId), promise, "hasCommitment");
    add(promise, node("staff", doc.content.ownerId), "assignedTo");
    if (doc.content.sourceId) add(promise, node("enrollment_consultation", doc.content.sourceId), "documentedFrom");
    if (doc.acknowledged) add(node("staff", doc.acknowledged.by), promise, "acknowledged");
    for (const item of doc.evidence.filter((e) => e.revision === doc.revision)) {
      // 수학 시트와 수업보고서는 같은 원본 ID를 공유한다. 그래프에서 다른 사실로 중복 생성하지 않는다.
      const kind = item.kind === "english_sheet" ? "class_sheet_student_mark" : item.kind === "math_sheet" ? "lesson_report" : item.kind;
      add(promise, node(kind, item.recordId), "supportedBy");
    }
  }
  return { schema: "aywa-care-v1", nodes: [...nodes.values()], edges };
}
