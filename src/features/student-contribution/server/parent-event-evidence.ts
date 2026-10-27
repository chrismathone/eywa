"use server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireContributionWrite } from "./access";
import { getContributionReadIdentity } from "./identity-query";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";

/** Original Drive links are available only behind the configuration/write gate. No raw contact payload leaves the server. */
export async function getParentEventEvidence(sourceId: string, studentId: string) {
  try {
    const gate = await requireContributionWrite();
    z.string().regex(/^[a-f0-9]{64}$/).parse(sourceId); z.string().uuid().parse(studentId);
    const identity = await getContributionReadIdentity();
    if (!identity.ids.includes(studentId)) throw new Error("학생 기록을 확인할 수 없습니다");
    const ids = identity.ids.filter(id => identity.canonical(id) === identity.canonical(studentId));
    const db = createAdminClient();
    const links = await fetchAllPagedInChunks<{ event_id: string }>(ids, (chunk, a, b) => db.from("student_parent_event_recognitions").select("event_id")
      .eq("tenant_id", gate.tenantId).in("student_id", chunk).contains("source_ids", [sourceId]).order("event_id").order("student_id").range(a, b));
    if (!links.length) throw new Error("학생에게 연결된 설명회 근거를 찾지 못했습니다");
    const { data, error } = await db.from("student_parent_event_registrations").select("event_id, source_file, source_sheet, source_row, state, import_id")
      .eq("tenant_id", gate.tenantId).eq("id", sourceId).maybeSingle();
    if (error || !data || !links.some(l => l.event_id === data.event_id) || !/^[a-zA-Z0-9_-]+$/.test(data.source_file)) throw new Error("설명회 원본 위치를 확인하지 못했습니다");
    const run = await db.from("student_parent_event_imports").select("status").eq("tenant_id", gate.tenantId).eq("id", data.import_id).maybeSingle();
    if (run.error || run.data?.status !== "applied") throw new Error("취소된 연결입니다");
    return { url: `https://docs.google.com/spreadsheets/d/${data.source_file}/edit#gid=${Number(data.source_sheet)}&range=A${Number(data.source_row)}`,
      row: Number(data.source_row), cancelled: data.state === "cancelled" };
  } catch { console.warn("[student-parent-events] evidence access failed"); return { error: "설명회 원본을 열 수 없습니다. 권한과 연결 상태를 확인해 주세요." }; }
}
