import "server-only";
import { loadStudentSiblings } from "@/features/students/server/siblings";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, type LiveContext } from "./live-context";

export function readLiveFamily(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=overview`;
  return readSection("family", "보호자·형제", href, async () => {
    const { data, error } = await c.db.from("students").select("id, name, parent_name, parent_phone, parent2_phone, parent_relation")
      .eq("tenant_id", c.tenant).eq("id", c.studentId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Student source unavailable");
    const { siblings, ready } = await loadStudentSiblings(c.db, c.tenant, data);
    const items: LiveItem[] = [];
    if (data.parent_name) items.push({ id: `guardian:${data.id}`, title: data.parent_name,
      detail: `보호자 · ${data.parent_relation || "관계 미입력"} · 학생 프로필에 기록된 정보`,
      evidence: [{ source: "students", id: data.id, studentId: c.studentId, href }] });
    for (const sibling of siblings) if (c.readable === null || c.readable.has(sibling.id)) items.push({
      id: `sibling:${sibling.id}`, title: sibling.name, detail: sibling.basis === "manual" ? "직접 연결한 형제" : "프로필의 형제 판정 기준으로 연결",
      evidence: [{ source: "students", id: sibling.id, studentId: sibling.id, href: `/students/${sibling.id}` }] });
    return { ...sectionResult("family", "보호자·형제", href, items.slice(0, 5), items.length),
      state: ready ? "ready" as const : "partial" as const, note: "연락처는 학생 프로필에서 확인할 수 있습니다." };
  });
}
