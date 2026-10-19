import { DATASETS, FIELDS, type ColumnMapping, type Dataset } from "./contract";

// Entirely synthetic identifiers. These fixtures are also downloadable CSV templates.
export const SAMPLE_CSV: Record<Dataset, string> = {
  enrollments: "student_id,started_on,ended_on\nS001,2025-09-01,\nS002,2026-09-05,\nS003,2026-08-01,2026-09-15\nS004,2026-07-01,2026-08-31\nS004,2026-09-10,\nS005,2026-09-30,\n",
  payments: "transaction_id,student_id,paid_on,amount,kind\nP001,S001,2026-09-01,300000,수납\nP002,S002,2026-09-05,300000,수납\nP003,S003,2026-09-15,100000,환불\nP004,S004,2026-09-10,250000,수납\nP005,S005,2026-09-30,300000,수납\nP005,S005,2026-09-30,300000,수납\n",
  consultations: "consultation_id,student_id,consulted_on\nC001,S002,2026-09-01\nC002,S005,2026-09-28\nC003,S006,2026-09-10\nC004,S006,2026-09-12\nC005,S001,2026-09-02\n",
};
export function canonicalMapping(): ColumnMapping {
  return Object.fromEntries(DATASETS.map((d) => [d, Object.fromEntries(Object.keys(FIELDS[d]).map((f) => [f, f]))])) as ColumnMapping;
}
