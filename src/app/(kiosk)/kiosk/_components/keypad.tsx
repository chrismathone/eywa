"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";

// 무인 키오스크 숫자패드 — 출석번호(4~5자리) 셀프입력 → 체크인 API → 등/하원 결과 + 발송 시뮬 배너.
// 자동제출 대신 '확인' 버튼(4자리/5자리 공존 시 prefix 모호성 회피). 결과 후 자동 리셋.
// 네이티브 키보드 미사용(커스텀 버튼). Wake Lock으로 화면 유지.

type CheckinResponse =
  | {
      ok: true;
      action: "check_in" | "check_out" | "noop";
      studentName: string;
      time: string;
      message: string | null;
      recipientMasked: string | null;
      reflectedClassName?: string | null;
    }
  | { ok: false; reason: string };

type View =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "result"; res: CheckinResponse };

const RESULT_MS = 4500;
const ERROR_MS = 3000;

export function KioskKeypad({ academyName }: { academyName: string }) {
  const [code, setCode] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 화면 유지(Wake Lock) — 지원 브라우저만. 탭 비가시화 시 해제되므로 visibilitychange에 재요청.
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } })
          .wakeLock;
        if (wl && !cancelled) sentinel = await wl.request("screen");
      } catch {
        /* 저전력/미지원 — 무시 */
      }
    };
    void request();
    const onVis = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const reset = useCallback(() => {
    setCode("");
    setView({ kind: "idle" });
  }, []);

  const scheduleReset = useCallback((ms: number) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setCode("");
      setView({ kind: "idle" });
    }, ms);
  }, []);

  const press = useCallback(
    (digit: string) => {
      if (view.kind === "result") reset();
      setCode((c) => (c.length >= 5 ? c : c + digit));
    },
    [view.kind, reset],
  );

  const backspace = useCallback(() => {
    if (view.kind === "result") {
      reset();
      return;
    }
    setCode((c) => c.slice(0, -1));
  }, [view.kind, reset]);

  const submit = useCallback(async () => {
    if (code.length < 4) return;
    setView({ kind: "submitting" });
    try {
      const r = await fetch("/api/attendance/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const res = (await r.json()) as CheckinResponse;
      setView({ kind: "result", res });
      scheduleReset(res.ok ? RESULT_MS : ERROR_MS);
    } catch {
      setView({ kind: "result", res: { ok: false, reason: "network" } });
      scheduleReset(ERROR_MS);
    }
  }, [code, scheduleReset]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-8">
      <div className="mb-6 text-center">
        <div className="text-text-faint micro">{academyName}</div>
        <h1 className="text-foreground mt-1 text-2xl font-bold">출석 체크</h1>
        <p className="text-text-dim mt-1 text-[13px]">출석번호를 입력하고 확인을 눌러주세요</p>
      </div>

      {view.kind === "result" ? (
        <ResultCard res={view.res} onDismiss={reset} />
      ) : (
        <div className="w-full max-w-xs">
          {/* 입력 표시 */}
          <div className="border-border bg-card mb-5 flex h-16 items-center justify-center rounded-lg border">
            <span className="text-foreground font-mono text-3xl tracking-[0.4em]">
              {code.padEnd(4, "·").slice(0, Math.max(4, code.length))}
            </span>
          </div>

          {/* 숫자패드 */}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeyButton key={d} onClick={() => press(d)} disabled={view.kind === "submitting"}>
                {d}
              </KeyButton>
            ))}
            <KeyButton onClick={backspace} disabled={view.kind === "submitting"} variant="muted">
              ⌫
            </KeyButton>
            <KeyButton onClick={() => press("0")} disabled={view.kind === "submitting"}>
              0
            </KeyButton>
            <KeyButton
              onClick={submit}
              disabled={code.length < 4 || view.kind === "submitting"}
              variant="primary"
            >
              {view.kind === "submitting" ? "…" : "확인"}
            </KeyButton>
          </div>
        </div>
      )}
    </main>
  );
}

function KeyButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "muted";
}) {
  const base =
    "h-16 rounded-lg text-2xl font-bold transition-colors select-none disabled:opacity-40 active:scale-[0.97]";
  const styles =
    variant === "primary"
      ? "bg-primary text-white hover:opacity-90"
      : variant === "muted"
        ? "border-border text-text-dim border hover:bg-bg-soft"
        : "border-border text-foreground border hover:bg-bg-soft";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

function ResultCard({ res, onDismiss }: { res: CheckinResponse; onDismiss: () => void }) {
  if (res.ok && res.action !== "noop") {
    const isIn = res.action === "check_in";
    return (
      <button
        type="button"
        onClick={onDismiss}
        className="border-border bg-card w-full max-w-xs rounded-xl border p-6 text-center"
      >
        <div className={`text-4xl font-bold ${isIn ? "text-primary" : "text-blue"}`}>
          {isIn ? "등원" : "하원"}
        </div>
        <div className="text-foreground mt-2 text-xl font-bold">{res.studentName} 학생</div>
        <div className="text-text-dim mt-1 text-sm">{res.time}</div>
        <div className="border-border mt-4 border-t pt-3">
          <div className="text-gold micro">알림톡 발송됨 (시뮬레이션)</div>
          <p className="text-text-dim mt-1 text-[12px] leading-relaxed">{res.message}</p>
          {res.recipientMasked ? (
            <p className="text-text-faint mt-1 inline-flex items-center gap-1 text-[11px]">
              <EyIcon name="send" size={12} />
              {res.recipientMasked}
            </p>
          ) : null}
          {isIn && res.reflectedClassName ? (
            <p className="text-primary mt-2 flex items-center justify-center gap-1 text-[11px]">
              <EyIcon name="check" size={12} />
              {res.reflectedClassName} 출석부 기록
            </p>
          ) : null}
        </div>
      </button>
    );
  }

  if (res.ok && res.action === "noop") {
    return (
      <button
        type="button"
        onClick={onDismiss}
        className="border-border bg-card w-full max-w-xs rounded-xl border p-6 text-center"
      >
        <div className="text-text-dim text-lg font-bold">{res.studentName} 학생</div>
        <p className="text-text-faint mt-2 text-sm">오늘 등원·하원이 이미 완료되었습니다.</p>
      </button>
    );
  }

  const reason = !res.ok ? res.reason : "";
  const msg =
    reason === "not_found"
      ? "출석번호를 확인해주세요."
      : reason === "rate_limited"
        ? "잠시 후 다시 시도해주세요."
        : reason === "invalid_code"
          ? "4~5자리 숫자를 입력해주세요."
          : "오류가 발생했습니다. 다시 시도해주세요.";
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="border-danger/30 bg-danger/5 w-full max-w-xs rounded-xl border p-6 text-center"
    >
      <div className="text-danger text-lg font-bold">{msg}</div>
    </button>
  );
}
