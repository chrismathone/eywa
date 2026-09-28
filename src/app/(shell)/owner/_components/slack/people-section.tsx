"use client";

import { useState, useTransition } from "react";
import { linkSlackByEmail, loadSlackPeople, unlinkSlackUser, type SlackPersonRow } from "@/features/slack/server/link-actions";
import { Button } from "@/components/ui/button";

/**
 * 사람 연결 — 1:1·@멘션은 슬랙 계정이 연결된 직원에게만 간다. 이메일 일치는 **후보**로만 보여 주고
 * 원장이 체크해 확인한 것만 연결한다. 본인 확인 연결은 각자 '내 정보'에서(코드).
 * 슬랙 목록은 외부 API라 버튼을 눌렀을 때만 불러온다.
 */
const LINK_LABEL = { code: "본인 확인", owner_email: "원장 확인" } as const;

export function PeopleSection() {
  const [rows, setRows] = useState<SlackPersonRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    start(async () => {
      setErr(null);
      const r = await loadSlackPeople();
      if (r.error) return setErr(r.error);
      setRows(r.rows ?? []);
      setPicked(new Set((r.rows ?? []).filter((x) => x.candidate).map((x) => x.userId)));
    });
  const act = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      setErr(null);
      setMsg(null);
      const r = await fn();
      if (r.error) return setErr(r.error);
      setMsg(r.message ?? "완료");
      const again = await loadSlackPeople();
      setRows(again.rows ?? rows);
      setPicked(new Set());
    });

  const linked = rows?.filter((r) => r.linked).length ?? 0;
  const candidates = rows?.filter((r) => r.candidate) ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-foreground text-sm font-bold">사람 연결</p>
        <span className="text-text-dim text-xs">1:1 메시지와 이름 불러 울리기는 슬랙 계정이 연결된 사람에게만 됩니다. 직원은 &lsquo;내 정보&rsquo;에서 직접 연결할 수도 있습니다.</span>
        <Button variant="outline" onClick={load} disabled={pending} className="ml-auto">
          {rows ? "다시 불러오기" : "직원 목록 불러오기"}
        </Button>
      </div>
      {rows ? (
        <>
          <p className="text-text-dim text-xs">
            연결됨 {linked}명 / 전체 {rows.length}명 · 이메일이 같은 슬랙 계정 후보 {candidates.length}명
          </p>
          {candidates.length ? (
            <Button onClick={() => act(() => linkSlackByEmail([...picked]))} disabled={pending || picked.size === 0}>
              체크한 후보 {picked.size}명 연결
            </Button>
          ) : null}
          <ul className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <li key={r.userId} className="flex items-center gap-2">
                {r.candidate ? (
                  <input
                    type="checkbox"
                    checked={picked.has(r.userId)}
                    onChange={() => setPicked((p) => (p.has(r.userId) ? new Set([...p].filter((x) => x !== r.userId)) : new Set([...p, r.userId])))}
                    className="accent-primary size-4"
                    aria-label={`${r.name} 연결 후보`}
                  />
                ) : null}
                <span className="text-foreground shrink-0">{r.name}</span>
                <span className={`min-w-0 truncate ${r.linked ? "text-primary" : "text-text-dim"}`}>
                  {r.linked ? `연결됨(${LINK_LABEL[r.linked]})` : r.candidate ? `후보: ${r.candidate.slackName}` : "슬랙에 같은 이메일 없음"}
                </span>
                {r.linked ? (
                  <button type="button" onClick={() => act(() => unlinkSlackUser(r.userId, r.name))} disabled={pending} className="text-text-dim hover:text-foreground ml-auto underline">
                    해제
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {msg ? <p className="text-primary text-xs">{msg}</p> : null}
      {err ? <p className="text-danger text-xs">{err}</p> : null}
    </div>
  );
}
