/**
 * 퇴원 예약 판정 — 순수 함수(Vitest). 원장 2026-09-28 *"퇴원이 미래인학생은 퇴원당일전까지 '재원'임."*
 * 학생 폼(등록·수정)이 서버 액션에서 부른다(`students/server/actions.ts`).
 */

/**
 * 학생 폼(등록·수정)의 퇴원일 칸 → 저장할 상태·퇴원일. 🔑 퇴원일이 미래 = **퇴원 예약**(상태는 그대로).
 * 등록은 `prevStatus = null`.
 */
export function planFormWithdrawal(a: {
  prevStatus: string | null;
  /** 지금 저장된 퇴원일(수정 폼) — 날짜를 안 바꾼 저장은 지난 날짜여도 막지 않는다(cron이 처리 못 한 예약 등). */
  prevWithdrawnAt?: string | null;
  status: string;
  withdrawnAt: string | null;
  today: string;
}): { kind: "withdraw" | "schedule" | "none"; status: string; withdrawnAt: string | null; error?: string } {
  const { prevStatus, status, withdrawnAt, today } = a;
  const unchanged = !!withdrawnAt && !!a.prevWithdrawnAt && withdrawnAt === String(a.prevWithdrawnAt).slice(0, 10);
  if (status === "withdrawn") {
    if (prevStatus === "withdrawn") {
      if (withdrawnAt && withdrawnAt > today)
        return { kind: "withdraw", status, withdrawnAt, error: "이미 퇴원한 학생의 퇴원일은 오늘 이후로 둘 수 없습니다." };
      return { kind: "withdraw", status, withdrawnAt };
    }
    if (withdrawnAt && withdrawnAt > today) {
      // 예약은 **재원·휴원**만(등록 폼 = null → 재원) — 예비·상담 학생에게 걸면 그날 cron이 예비생을 퇴원시킨다.
      if (prevStatus !== null && prevStatus !== "enrolled" && prevStatus !== "on_hold")
        return { kind: "none", status: prevStatus, withdrawnAt: null, error: "재원·휴원 학생만 퇴원 예약(오늘 이후 퇴원일)을 걸 수 있습니다." };
      return { kind: "schedule", status: prevStatus ?? "enrolled", withdrawnAt };
    }
    return { kind: "withdraw", status, withdrawnAt };
  }
  // 퇴원에서 되돌리는 저장(복구) — 옛 퇴원일은 비운다(종전).
  if (prevStatus === "withdrawn" || !withdrawnAt) return { kind: "none", status, withdrawnAt: null };
  // 예약은 **재원·휴원**만 — 예비·상담 학생의 퇴원일 칸은 뜻이 없어 버린다(그날 cron이 예비생을 퇴원시키지 않게).
  if (status !== "enrolled" && status !== "on_hold") return { kind: "none", status, withdrawnAt: null };
  if (unchanged) return { kind: "schedule", status, withdrawnAt };
  if (withdrawnAt <= today)
    return {
      kind: "none",
      status,
      withdrawnAt: null,
      error: "재원·휴원 학생의 퇴원일은 오늘 이후 날짜(퇴원 예약)만 적을 수 있습니다. 이미 그만뒀다면 상태를 '퇴원'으로 바꿔 주세요.",
    };
  return { kind: "schedule", status, withdrawnAt };
}
