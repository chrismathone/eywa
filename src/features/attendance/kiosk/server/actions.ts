"use server";

import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { assignAttendanceCode } from "../codes";
import { KIOSK_COOKIE } from "../constants";
import { parseForwardedFor } from "../device-info";

async function requireMaster() {
  const user = await getCurrentUser();
  if (!user || !canAccess(user.systemRole, "kiosk_settings")) {
    throw new Error("권한이 없습니다");
  }
  return user;
}

export type KioskActionState = { error?: string; ok?: string } | undefined;

/** 이 브라우저(태블릿)를 키오스크 기기로 등록 — 토큰 발급 + 해시 저장 + httpOnly 쿠키 set. */
export async function registerKioskDevice(
  _prev: KioskActionState,
  formData: FormData,
): Promise<KioskActionState> {
  const user = await requireMaster();
  const name = String(formData.get("name") ?? "").trim() || "키오스크";

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // 등록 기기 메타 — 요청 헤더에서 IP/UA 캡처(Vercel은 x-forwarded-for). 로컬 dev는 보통 null.
  const h = await headers();
  const ip = parseForwardedFor(h.get("x-forwarded-for"), h.get("x-real-ip"));
  const ua = h.get("user-agent");

  const supabase = await createClient();
  const { error } = await supabase.from("kiosk_devices").insert({
    tenant_id: user.tenantId,
    name,
    token_hash: tokenHash,
    is_active: true,
    registered_ip: ip,
    last_seen_ip: ip,
    user_agent: ua,
  });
  if (error) return { error: error.message };

  // 평문 토큰은 이 기기 쿠키에만(서버엔 해시만). httpOnly → JS 추출 불가.
  const jar = await cookies();
  jar.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/kiosk-settings");
  return { ok: "이 기기가 키오스크로 등록되었습니다." };
}

/** 기기 폐기(분실/도난 대응) — is_active=false. tenant 스코프. */
export async function revokeKioskDevice(
  _prev: KioskActionState,
  formData: FormData,
): Promise<KioskActionState> {
  const user = await requireMaster();
  const id = String(formData.get("deviceId") ?? "").trim();
  if (!id) return { error: "기기 ID가 필요합니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kiosk_devices")
    .update({ is_active: false })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) return { error: error.message };

  revalidatePath("/kiosk-settings");
  return { ok: "기기를 폐기했습니다." };
}

/** 출석번호 일괄 발급 — attendance_code가 비어 있는 재원 학생만. 멱등. */
export async function assignAttendanceCodesAction(
  _prev: KioskActionState,
  _formData: FormData,
): Promise<KioskActionState> {
  const user = await requireMaster();
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("students")
    .select("id, student_phone, parent_phone, attendance_code")
    .eq("tenant_id", user.tenantId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };

  const taken = new Set<string>();
  for (const r of rows ?? []) if (r.attendance_code) taken.add(r.attendance_code);

  let assigned = 0;
  let skipped = 0;
  for (const r of rows ?? []) {
    if (r.attendance_code) continue;
    let code: string | null;
    try {
      code = assignAttendanceCode({
        studentPhone: r.student_phone,
        parentPhone: r.parent_phone,
        takenCodes: taken,
      });
    } catch {
      skipped++;
      continue;
    }
    if (!code) {
      skipped++;
      continue;
    }
    taken.add(code);
    const { error: uErr } = await supabase
      .from("students")
      .update({ attendance_code: code })
      .eq("id", r.id)
      .eq("tenant_id", user.tenantId)
      .is("attendance_code", null);
    if (!uErr) assigned++;
  }

  revalidatePath("/kiosk-settings");
  return { ok: `출석번호 ${assigned}명 발급${skipped ? `, ${skipped}명 스킵(전화번호 없음)` : ""}.` };
}
