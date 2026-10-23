import "server-only";
import { cache } from "react";
import { studentIdentity } from "@/features/students/ontology/identity";
import { buildStudentIdentityIndex } from "@/features/students/ontology/identity-index";
import { getContributionStudents } from "./directory";
export const getContributionIdentity = cache(async () => {
  const rows = await getContributionStudents();
  return { canonical: studentIdentity(rows), ids: rows.map((r) => r.id) };
});

/** Display-only resolver; write/refresh paths retain getContributionIdentity's strict checks. */
export const getContributionReadIdentity = cache(async () => {
  const index = buildStudentIdentityIndex(await getContributionStudents());
  return { ...index, canonical: (id: string) => {
    const resolved = index.resolve(id);
    if (!resolved) throw new Error("원생의 연결을 확인해 주세요");
    return resolved;
  } };
});
