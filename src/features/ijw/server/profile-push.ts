import "server-only";

/**
 * aywa → 인재원 **학생 학교·학년·생년월일 보내기**(원장 2026-10-08 *"전부 보내줘"* — 인재원이 학년 대비 레벨·같은 학년 평균을
 * 내려고 받는다. 인재원 설명서 `EYWA-API.md` 끝 "EYWA → 인재원"). 이 입구만 방향이 반대다(aywa가 보낸다).
 *
 * 🔑 **aywa 학생 정보가 원본**이고 인재원은 받은 값을 저장만 한다 — 그래서 값을 고르지 않고 `students.school·grade·birth_date`를
 *    그대로 보낸다(빈 값 = 인재원에서도 지운다, 설명서 규칙). 짝(`ijw_student_id`)이 없는 학생은 보내지 않는다.
 * 🔑 보내는 때: 짝 맞춘 학생 **전원**(사람이 누르는 버튼 · 하루 한 번 cron) + 학생 정보 저장·짝 잇기 때 **그 학생**.
 * 🔴 **던지지 않는다** — 학생 저장·짝 잇기는 이미 끝났다. 결과를 돌려주고, 실패는 서버 로그만 남긴다.
 * 🔴 세션 없이 돈다(after·cron) → admin 클라이언트 + `tenant_id`. 인재원 연동은 한 학원(IJW_TENANT_ID)뿐이라
 *    `ijwConfigFor`가 다른 지점이면 null → 아무것도 안 보낸다.
 * ⚠️ 생년월일은 학생 개인정보다 — 원장이 2026-10-08 명시로 승인했다(인재원 = 학원이 운영하는 학습 앱). 다른 칸을 더 보내려면
 *    다시 물을 것.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { isMissingIjwColumn } from "../db-errors";
import { ijwConfigFor } from "./client";
import { profilePayloadOf, type IjwProfileRow } from "../profile-payload";

const PATH = "/ext/eywa/students/profile";
/** 인재원 입구 상한(한 번에 1000명). */
const BATCH = 1000;
const TIMEOUT_MS = 15_000;

export type IjwProfilePushResult =
  | { ok: true; sent: number; updated: number; notFound: string[]; invalid: { ijwId: string; field: string; value: unknown }[] }
  | { ok: false; reason: "not_configured" | "failed"; message: string };

type Row = IjwProfileRow;

/**
 * 짝 맞춘 학생의 학교·학년·생년월일을 인재원에 보낸다. `studentIds`를 주면 그 학생들만(짝 없는 학생은 저절로 빠진다).
 * 보낼 학생이 없으면 `sent: 0`으로 성공.
 */
export async function pushIjwProfiles(tenantId: string, opts: { studentIds?: readonly string[] } = {}): Promise<IjwProfilePushResult> {
  const conf = ijwConfigFor(tenantId);
  if (!conf) return { ok: false, reason: "not_configured", message: "인재원 연동이 설정되지 않은 학원입니다." };
  try {
    const db = createAdminClient();
    const cols = "ijw_student_id, school, grade, birth_date";
    let rows: Row[];
    if (opts.studentIds) {
      if (opts.studentIds.length === 0) return { ok: true, sent: 0, updated: 0, notFound: [], invalid: [] };
      rows = await fetchInChunks<Row>([...opts.studentIds], (chunk) =>
        db.from("students").select(cols).eq("tenant_id", tenantId).in("id", chunk).not("ijw_student_id", "is", null),
      );
    } else {
      rows = await fetchAllPaged<Row>((from, to) =>
        db
          .from("students")
          .select(cols)
          .eq("tenant_id", tenantId)
          .not("ijw_student_id", "is", null)
          .order("id")
          .range(from, to),
      );
    }
    const students = rows.map(profilePayloadOf).filter((x): x is NonNullable<typeof x> => !!x);
    let updated = 0;
    const notFound: string[] = [];
    const invalid: { ijwId: string; field: string; value: unknown }[] = [];
    for (let i = 0; i < students.length; i += BATCH) {
      const res = await fetch(`${conf.url}${PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${conf.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ students: students.slice(i, i + BATCH) }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        updated?: number;
        notFound?: string[];
        invalid?: { ijwId: string; field: string; value: unknown }[];
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        const said = typeof body?.error === "string" ? ` · ${body.error}` : "";
        throw new Error(`인재원 응답 HTTP ${res.status}${said}`);
      }
      updated += Number(body.updated) || 0;
      notFound.push(...(body.notFound ?? []));
      invalid.push(...(body.invalid ?? []));
    }
    return { ok: true, sent: students.length, updated, notFound, invalid };
  } catch (e) {
    if (isMissingIjwColumn(e as { code?: string; message?: string })) {
      return { ok: false, reason: "not_configured", message: "짝 칸이 아직 준비되지 않았습니다(DB 적용 전)." };
    }
    reportError(e, { scope: "ijw", step: "profile-push" });
    return { ok: false, reason: "failed", message: "인재원에 학생 정보를 보내지 못했습니다 — 잠시 후 다시 시도해 주세요." };
  }
}
