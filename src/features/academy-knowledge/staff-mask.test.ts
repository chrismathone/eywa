import { describe, expect, it } from "vitest";
import { unifyGraphs, type Graph } from "./graph";
import { HIDDEN_STAFF_LABEL, maskStaffNames, staffNameScrubber } from "./staff-mask";

const graph: Graph = {
  version: "t", tenant: "T", observedAt: "2026-11-11T00:00:00Z", issues: [],
  nodes: [
    { id: "T:staff:me", type: "Staff", label: "나", source: "s", href: "/class-review/knowledge?teacher=me" },
    { id: "T:staff:math", type: "Staff", label: "수학 선생님", source: "s", href: "/class-review/knowledge?teacher=math" },
    { id: "T:staff:okr-owner", type: "Staff", label: "목표 담당자 실명", source: "organization-okr", href: "/class-review/knowledge?teacher=okr-owner" },
    { id: "T:student:s1", type: "Student", label: "학생 이름", source: "s" },
  ],
  edges: [{ from: "T:okr:g", to: "T:staff:okr-owner", relation: "ASSIGNED_TO", sourceRelation: "ASSIGNED_TO", basis: "목표 담당자", evidence: [], asOf: "2026-11-11" }],
};

describe("직원 이름 가리기 — 합친 그래프의 마지막에 한 번", () => {
  it("🔴 다른 출처(조직·OKR)가 실어 온 직원 노드도 범위 밖이면 이름·링크를 가린다 — 관계는 남는다", () => {
    const out = maskStaffNames(graph, "me", new Set(["math"]));
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    expect(byId.get("T:staff:okr-owner")).toMatchObject({ label: HIDDEN_STAFF_LABEL, href: undefined });
    expect(JSON.stringify(out)).not.toContain("목표 담당자 실명");
    expect(out.edges).toEqual(graph.edges);
  });
  it("본인과 볼 수 있는 직원 · 직원이 아닌 노드는 그대로", () => {
    const out = maskStaffNames(graph, "me", new Set(["math"]));
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    expect(byId.get("T:staff:me")?.label).toBe("나");
    expect(byId.get("T:staff:math")?.label).toBe("수학 선생님");
    expect(byId.get("T:student:s1")?.label).toBe("학생 이름");
  });
  it("🔴 시스템이 제목·상세에 붙인 직원 이름도 가린다 — 학생 이름·다른 낱말의 일부·조사가 붙은 본문은 그대로", () => {
    const withText: Graph = { ...graph, nodes: [...graph.nodes,
      { id: "T:knowledge:o1", type: "Observation", label: "30일 · 양호 · 김민", source: "s", detail: "작성 김민 · 마지막 수정 영어 선생님 · 확인됨\n관찰 사실: 김민준 학생이 김민이 준 숙제를 함" },
      { id: "T:student:s2", type: "Student", label: "김민", source: "s" },
    ], edges: [{ ...graph.edges[0]!, basis: "담당 김민" }] };
    const out = maskStaffNames(withText, "me", new Set(["math"]), ["김민", "영어 선생님", "나"]);
    const obs = out.nodes.find((n) => n.id === "T:knowledge:o1")!;
    expect(obs.label).toBe(`30일 · 양호 · ${HIDDEN_STAFF_LABEL}`);
    expect(obs.detail).toBe(`작성 ${HIDDEN_STAFF_LABEL} · 마지막 수정 ${HIDDEN_STAFF_LABEL} · 확인됨\n관찰 사실: 김민준 학생이 김민이 준 숙제를 함`);
    expect(out.nodes.find((n) => n.id === "T:student:s2")!.label).toBe("김민"); // 이름이 같은 학생은 그대로
    expect(out.edges[0]!.basis).toBe(`담당 ${HIDDEN_STAFF_LABEL}`);
  });
  it("🔴 속성(attributes)에 복제된 상세 글과 가린 직원 노드의 속성에도 이름이 남지 않는다 — 직렬화 결과 전체로 확인", () => {
    const hub: Graph = { ...graph, nodes: [...graph.nodes,
      { id: "T:knowledge-version:v1", type: "Evidence", label: "출석 확인", source: "student", detail: "작성 홍길동 · 확인됨", value: "담당 홍길동",
        attributes: { date: "2026-11-03", detail: "작성 홍길동 · 확인됨", section: "field-observations", nested: [{ note: "마지막 수정 홍길동 · v2" }], count: 3 } },
      { id: "T:staff:hidden", type: "Staff", label: "홍길동", source: "teacher", detail: "홍길동 선생님 메모", attributes: { name: "홍길동" } },
    ] };
    const out = maskStaffNames(hub, "me", new Set(["math"]), ["홍길동", "목표 담당자 실명"]);
    expect(JSON.stringify(out)).not.toContain("홍길동");
    const evidence = out.nodes.find((n) => n.id === "T:knowledge-version:v1")!;
    expect(evidence.attributes).toEqual({ date: "2026-11-03", detail: `작성 ${HIDDEN_STAFF_LABEL} · 확인됨`, section: "field-observations", nested: [{ note: `마지막 수정 ${HIDDEN_STAFF_LABEL} · v2` }], count: 3 });
  });
  it("🔴 학생 통합 그래프 모양(상세를 attributes.detail에 싣는 노드)을 실제로 합친 뒤에도 직렬화 결과에 숨긴 이름이 없다", () => {
    const hubSource = { nodes: [
      { id: "student:s1", kind: "student", label: "학생 이름", source: "students" },
      { id: "field-observations:r1", kind: "section_item", label: "출석 확인", source: "academy_knowledge_records", attributes: { date: "2026-11-03", detail: "작성 홍길동 · 확인됨\n관찰 사실: 10회 중 8회 출석", section: "field-observations" } },
      { id: "onboardingFeedback:f1", kind: "section_item", label: "30일 · 양호 · 홍길동", source: "student_onboarding_feedback", attributes: { detail: "적응 양호" } },
    ], edges: [] };
    const merged = unifyGraphs("T", "2026-11-11T00:00:00Z", [{ name: "student", graph: hubSource }]);
    expect(JSON.stringify(merged)).toContain("홍길동"); // 합치기만 하면 이름이 남는다(detail · attributes.detail · label)
    const out = maskStaffNames(merged, "me", new Set(), ["홍길동"]);
    expect(JSON.stringify(out)).not.toContain("홍길동");
    expect(JSON.stringify(out)).toContain("10회 중 8회 출석"); // 본문은 그대로
  });
  it("가릴 이름이 없으면 글은 손대지 않는다 · 한 글자 이름은 가리지 않는다", () => {
    expect(staffNameScrubber([])).toBeNull();
    expect(staffNameScrubber(["김"])).toBeNull();
    expect(staffNameScrubber(["Kelly"])!("작성 Kelly · Kellyanne")).toBe(`작성 ${HIDDEN_STAFF_LABEL} · Kellyanne`);
  });
  it("직원관리 권한이 없으면(볼 수 있는 직원 0명) 본인만 남는다", () => {
    const out = maskStaffNames(graph, "me", new Set());
    expect(out.nodes.filter((n) => n.type === "Staff").map((n) => n.label)).toEqual(["나", HIDDEN_STAFF_LABEL, HIDDEN_STAFF_LABEL]);
  });
});
