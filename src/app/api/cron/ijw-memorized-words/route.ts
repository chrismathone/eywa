import { NextResponse } from "next/server";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { fillMemorizedWords, memorizedFillNotice } from "@/features/ijw/server/memorized-words";
import { getPublicSeatDay } from "@/features/attendance/seat/server/queries";

/**
 * JJ실 '누적 암기 단어수' **하루 한 번 자동 채우기** cron — 매일 04:00 KST(= 19:00 UTC).
 *
 * 🔑 시각: 인재원 **학습일이 새벽 3시에 바뀐다**(설명서 ①) — 그 직후에 채워야 오늘 칸이 "어제까지의 학습"이
 *    아니라 지금 값으로 선다. 선생님이 출근해 시트를 열 때 이미 적혀 있게 하는 것이 이 크론의 목적이다.
 * 🔑 대상은 **그 날 JJ실 명단**이다(자리 하루치 조회 그대로) — 세션이 없으므로 공개 PIN 화면이 쓰는
 *    admin 경로(`getPublicSeatDay`)를 쓴다. 명단이 없는 날(수업 없음)은 아무것도 하지 않는다.
 * 🔴 빈 칸은 채우고 · **숫자만 든 칸은 최신값으로 갱신**하고 · 글자가 섞인 칸은 손대지 않고 · 짝 없는
 *    학생은 건너뛴다 — 판단은 전부 [`fillMemorizedWords`](@/features/ijw/server/memorized-words) 한 곳이고
 *    수동 버튼 둘(자리 출석부·영어 강사 시트)과 **같은 함수**다.
 * 🔑 **갱신이 있어야 '자동'이 성립한다**: '내용 복사 (지난 수업)'가 이 칸을 지난 값으로 미리 채워 두면
 *    종전 규칙("빈 칸만")으로는 영영 안 고쳐져 시트에 낡은 숫자가 굳었다(실측 2026-09-28). 이 크론이
 *    그 날 아침에 그것을 지금 값으로 바로잡는다.
 * 🔴 `updated_by`는 null이다 — 사람이 적었다고 지어내지 않는다(키오스크·자리 출결과 같은 규약).
 * ⚠️ 인재원 연동은 한 학원(IJW_TENANT_ID)에 묶여 있다 — 설정이 없으면 조용히 건너뛴다(실패가 아니다).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenantId = (process.env.IJW_TENANT_ID ?? "").trim();
  if (!tenantId || !ijwConfigFor(tenantId)) {
    return NextResponse.json({ ok: true, skipped: "인재원 연동 미설정" });
  }

  const date = kstToday();
  try {
    const day = await getPublicSeatDay(tenantId, "jj", date);
    const targets = Object.entries(day.rosterByPeriod).flatMap(([slot, classes]) =>
      classes.flatMap((c) => c.students.map((s) => ({ classId: c.classId, studentId: s.id, slotStart: slot }))),
    );
    if (!targets.length) return NextResponse.json({ ok: true, date, skipped: "그 날 JJ실 수업 없음" });

    const res = await fillMemorizedWords({ tenantId, date, targets, actorId: null });
    if (!res.ok) {
      reportError(new Error(res.message), { scope: "cron.ijw-memorized-words", step: "fill" });
      return NextResponse.json({ ok: false, date, error: res.message, detail: res.detail }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      date,
      summary: memorizedFillNotice(res),
      mode: res.mode,
      filled: res.filled,
      updated: res.updated,
      same: res.same,
      kept: res.kept,
      unlinked: res.unlinked,
      noData: res.noData,
      targets: res.targets,
    });
  } catch (e) {
    reportError(e, { scope: "cron.ijw-memorized-words", step: "run" });
    return NextResponse.json({ ok: false, date, error: "자동 채우기에 실패했습니다" }, { status: 500 });
  }
}
