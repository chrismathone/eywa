import { DATASETS, type AnalysisOptions } from "./contract";
import { SAMPLE_CSV, canonicalMapping } from "./sample";

export function sampleOptions(): AnalysisOptions {
  return { from: "2026-09-01", to: "2026-09-30", asOf: "2026-09-30", completeHistory: true, sameTenant: true, encoding: "utf-8", mapping: canonicalMapping() };
}
export function sampleForm(tenantId = "tenant-a"): FormData {
  const form = new FormData();
  form.set("tenantId", tenantId);
  form.set("options", JSON.stringify(sampleOptions()));
  for (const d of DATASETS) form.set(d, new File([SAMPLE_CSV[d]], `${d}.csv`, { type: "text/csv" }));
  return form;
}
