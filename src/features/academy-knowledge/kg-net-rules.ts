import { relations } from "./catalog";
import type { Graph, Node } from "./graph";

/** 지식그래프 판(`kg-net.ts`)의 규칙 도우미 — 순수 함수(서버·클라 겸용 · `"use client"`/`server-only` 금지). */

/** 관계 이름 — 직접 확인한 참고 연결 · 관계 사전의 한글 이름 · 그 밖은 원본 관계명(관계 목록 표와 같은 말). */
export function relationLabel(e: Pick<Graph["edges"][number], "relation" | "sourceRelation">): string {
  if (e.sourceRelation.startsWith("manual-reference:")) return "직접 확인한 참고 연결";
  return Object.hasOwn(relations, e.relation) ? relations[e.relation].label : e.sourceRelation;
}

/** 기록마다 관계 수 — 같은 두 기록은 한 번(관계 이름이 달라도) · 학원 점과의 소속 관계는 빼고(영역 선이 이미 말한다) · 자기 자신만 가리키는 관계도 빼고. 0이면 '다른 기록과 관계 없음'. */
export function degrees(graph: Graph): Map<string, number> {
  const type = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const a = type.get(e.from);
    const b = type.get(e.to);
    if (e.from === e.to || !a || !b || a === "Academy" || b === "Academy") continue;
    const key = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.set(e.from, (out.get(e.from) ?? 0) + 1);
    out.set(e.to, (out.get(e.to) ?? 0) + 1);
  }
  return out;
}
const relatedIds = (graph: Graph) => new Set(degrees(graph).keys());

/** 다른 기록과 관계가 하나도 없는 기록 수(학원 점 제외) — '지도 읽는 법'의 안내 수(미입력 확정이 아니다). */
export function isolatedCount(graph: Graph): number {
  const related = relatedIds(graph);
  return graph.nodes.filter((n) => n.type !== "Academy" && !related.has(n.id)).length;
}

/**
 * 상세 자료를 주소(`?student=` · `?teacher=`)로 불러올 수 있는 학생·강사 — 그 화면의 목록에 있는 사람만(목록 밖 사람을 주소에 실으면 서버가
 * 거절해 화면이 열리지 않는다 · 직원 목록은 직원관리 열람 권한이 있어야 찬다). 그 밖은 null(화면 안에서 가운데만 바꾼다).
 */
export function kgDetailParam(n: Pick<Node, "id" | "type">, tenant: string, students: readonly { id: string }[], staff: readonly { id: string }[]): { student: string } | { teacher: string } | null {
  const key = n.id.slice(n.id.lastIndexOf(":") + 1);
  if (n.type === "Student" && n.id === `${tenant}:student:${key}` && students.some((p) => p.id === key)) return { student: key };
  if (n.type === "Staff" && n.id === `${tenant}:staff:${key}` && staff.some((p) => p.id === key)) return { teacher: key };
  return null;
}

