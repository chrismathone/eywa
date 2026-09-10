"use server";

import { loadOverview } from "./server";

export async function refreshOverview() {
  return loadOverview();
}
