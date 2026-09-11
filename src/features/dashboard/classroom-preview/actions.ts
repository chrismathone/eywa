"use server";

import { loadClassroomPreview } from "./server";

export async function refreshClassroomPreview() {
  return loadClassroomPreview();
}
