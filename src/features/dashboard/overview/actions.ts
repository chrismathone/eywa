"use server";

import { loadOverview } from "./server";

export async function refreshOverview() {
  return loadOverview();
}

export async function refreshSubjectOverview(subject: string) {
  return loadOverview({ subject: typeof subject === "string" ? subject : undefined });
}
