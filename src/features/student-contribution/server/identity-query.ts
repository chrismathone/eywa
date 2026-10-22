import "server-only";
import { cache } from "react";
import { studentIdentity } from "@/features/students/ontology/identity";
import { getContributionStudents } from "./directory";
export const getContributionIdentity = cache(async () => {
  const rows = await getContributionStudents();
  return { canonical: studentIdentity(rows), ids: rows.map((r) => r.id) };
});
