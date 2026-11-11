import type { Graph } from "./graph";

/**
 * 직원 이름 가리기 — 합친 그래프의 **마지막**에 한 번 건다(2026-11-11 · Codex 협의).
 * 바탕 그래프(server-core.ts)에서만 직원을 빼면, 조직·OKR · 학생/강사 통합 · 직접 기록처럼 다른 출처가 실어 온 직원 노드의 실명이
 * 합친 그래프와 JSON에 그대로 남는다(선택지는 비었는데 이름은 보이는 상태). 관계(누가 맡았다 · 누가 썼다)는 남기고 이름과 링크만 가린다.
 *  ① 직원 노드(`<지점>:staff:<직원 id>` — graph.ts canonicalId) = `shown`에 없으면 이름·링크를 가린다(본인은 늘 보인다).
 *  ② 글 속 이름 = 시스템이 제목·상세·**속성**(attributes — 학생 통합 그래프는 같은 상세 글을 attributes.detail에도 싣는다)·값에
 *     붙여 넣은 직원 이름("작성 홍길동 · 확인됨" · "30일 · 양호 · 홍길동")도 가린다. 가린 직원 노드는 상세·속성을 통째로 뺀다.
 *     `hiddenNames`(볼 수 없는 직원의 이름)를 낱말 경계로 찾는다 — 앞뒤가 글자·숫자면(다른 낱말의 일부 · 조사가 붙은 본문) 건드리지 않는다.
 *     학생·학교 노드의 이름은 건드리지 않는다(직원과 이름이 같은 학생이 가려지지 않게).
 * `shown` = 직원관리 권한·과목 범위로 볼 수 있는 직원.
 */
export const HIDDEN_STAFF_LABEL = "직원";
const KEEP_TEXT: ReadonlySet<string> = new Set(["Staff", "Student", "School"]);

/** 숨길 이름 → 글에서 가리는 함수. 2자 미만 이름은 다른 낱말과 겹치기 쉬워 뺀다. 가릴 이름이 없으면 null. */
export function staffNameScrubber(hiddenNames: readonly string[]): ((text: string) => string) | null {
  const names = [...new Set(hiddenNames.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (!names.length) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // tsconfig 대상(ES2017)은 뒤돌아보기·\p{…} 리터럴을 못 쓴다 — 문자열로 만든다(서버에서만 돈다 · Node는 지원).
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return (text) => text.replace(pattern, HIDDEN_STAFF_LABEL);
}

/** 속성처럼 깊이가 있는 값 속의 글도 가린다(문자열만 바꾼다 · 숫자·불리언·null은 그대로). */
function deepScrub(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((v) => deepScrub(v, scrub));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, deepScrub(v, scrub)]));
  return value;
}

export function maskStaffNames(graph: Graph, selfId: string, shown: ReadonlySet<string>, hiddenNames: readonly string[] = []): Graph {
  const prefix = `${graph.tenant}:staff:`, scrub = staffNameScrubber(hiddenNames);
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.type === "Staff" && n.id.startsWith(prefix)) {
        const id = n.id.slice(prefix.length);
        return id === selfId || shown.has(id) ? n : { ...n, label: HIDDEN_STAFF_LABEL, href: undefined, detail: undefined, attributes: undefined, value: undefined };
      }
      if (!scrub || KEEP_TEXT.has(n.type)) return n;
      return { ...n, label: scrub(n.label), detail: n.detail === undefined ? undefined : scrub(n.detail),
        attributes: n.attributes === undefined ? undefined : deepScrub(n.attributes, scrub) as Record<string, unknown>,
        value: typeof n.value === "string" ? scrub(n.value) : n.value };
    }),
    edges: scrub ? graph.edges.map((e) => { const basis = scrub(e.basis); return basis === e.basis ? e : { ...e, basis }; }) : graph.edges,
  };
}
