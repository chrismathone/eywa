"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { isLast4, type SiteChoice, type SiteLookupResult, type SiteOpenResult } from "@/features/video-submit/site";

type Phase =
  | { kind: "ask" }
  | { kind: "looking" }
  | { kind: "choose"; last4: string; choices: SiteChoice[] }
  | { kind: "opening"; last4: string; choices: SiteChoice[]; picked: string };

const NETWORK = "연결이 끊겼습니다. 잠시 후 다시 해 주세요.";

async function post<T>(body: unknown): Promise<T | null> {
  try {
    const res = await fetch("/api/video-submit/site", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 숙제 영상 올리기 사이트 — 학생 폰이 기본(한 열·큰 버튼). 뒷 4자리 → 내 이름·반 고르기 → 제출 화면으로.
 * 문구는 전부 한글, 원문 오류는 내보내지 않는다. 이름은 서버가 가운데를 가려 보낸다.
 */
export function VideoSiteForm({ academyName, maxLabel }: { academyName: string; maxLabel: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!isLast4(digits)) {
      setError("휴대폰 번호 뒷 4자리(숫자 4개)를 입력해 주세요.");
      return;
    }
    setError(null);
    setPhase({ kind: "looking" });
    const res = await post<SiteLookupResult>({ op: "lookup", last4: digits });
    if (!res || !res.ok) {
      setError(res ? res.error : NETWORK);
      setPhase({ kind: "ask" });
      return;
    }
    setPhase({ kind: "choose", last4: digits, choices: res.choices });
  }

  async function open(last4: string, choices: SiteChoice[], id: string) {
    setError(null);
    setPhase({ kind: "opening", last4, choices, picked: id });
    const res = await post<SiteOpenResult>({ op: "open", last4, choice: id });
    if (!res || !res.ok) {
      setError(res ? res.error : NETWORK);
      // 후보가 더는 맞지 않는다(날짜가 바뀌었거나 명단이 달라짐) — 낡은 목록을 다시 누르게 두지 않고 처음으로 돌린다.
      setPhase(res && res.code === "invalid" ? { kind: "ask" } : { kind: "choose", last4, choices });
      return;
    }
    // 제출 화면으로 — 문서 이동(뒤로 가기로 이 화면에 돌아오면 처음부터 다시 한다).
    window.location.assign(res.url);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 pt-8 pb-8 lg:pb-10">
      <header className="space-y-1">
        <p className="text-text-dim text-sm">{academyName}</p>
        <h1 className="text-foreground text-2xl font-bold">숙제 영상 올리기</h1>
      </header>
      <section className="bg-card border-line space-y-4 rounded-2xl border p-5">
        {phase.kind === "ask" || phase.kind === "looking" ? (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
            <label className="block space-y-2">
              <span className="text-foreground block text-base font-bold break-keep">휴대폰 번호 뒷 4자리</span>
              {/* 16px 이상 — iOS가 입력 때 화면을 확대하지 않게. 숫자 키패드 · 자동완성은 끈다(남의 번호가 남지 않게). */}
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4} value={digits}
                onChange={(event) => { setDigits(event.target.value.replace(/\D/g, "").slice(0, 4)); setError(null); }}
                placeholder="뒷 4자리" aria-label="휴대폰 번호 뒷 4자리"
                className="border-line bg-background focus:border-primary h-14 w-full rounded-lg border px-4 text-center text-2xl font-bold tracking-[0.4em] outline-none"
              />
            </label>
            <Button type="submit" size="lg" className="w-full" disabled={phase.kind === "looking" || digits.length !== 4}>
              {phase.kind === "looking" ? "찾는 중…" : "다음"}
            </Button>
            <ul className="text-text-dim space-y-1 text-sm break-keep">
              <li>내 번호가 없으면 학원에 알려 준 부모님 번호 뒷 4자리를 넣어 주세요.</li>
              <li>영상 한 개에 {maxLabel}까지 올릴 수 있습니다.</li>
              <li>올린 영상은 담당 선생님만 봅니다.</li>
            </ul>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-foreground text-base font-bold break-keep">내 이름과 반을 골라 주세요</p>
            <ul className="space-y-2">
              {phase.choices.map((choice) => (
                <li key={choice.id}>
                  <Button
                    type="button" variant="outline" size="lg" className="h-auto w-full justify-start py-3 text-left"
                    disabled={phase.kind === "opening"}
                    onClick={() => void open(phase.last4, phase.choices, choice.id)}
                  >
                    <span className="min-w-0 break-keep">
                      <span className="text-foreground block text-base font-bold">{choice.studentLabel}</span>
                      <span className="text-text-dim block text-sm">{choice.className}</span>
                    </span>
                    {phase.kind === "opening" && phase.picked === choice.id ? <span className="text-text-dim ml-auto shrink-0 text-sm">여는 중…</span> : null}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-text-dim text-sm break-keep">내 이름이 없으면 번호를 다시 확인하거나 담당 선생님께 알려 주세요.</p>
            <Button type="button" variant="ghost" className="w-full" disabled={phase.kind === "opening"}
              onClick={() => { setPhase({ kind: "ask" }); setError(null); }}>
              번호 다시 넣기
            </Button>
          </div>
        )}
        {error ? <p className="text-danger text-sm font-bold break-keep" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
