"use client";

// 학생 ↔ ClassNote 원아 고정 연결 버튼.
//
// ⚠️ 이 버튼은 **발송 대상을 정한다** — 잘못 누르면 남의 집에 보고서가 간다.
//    그래서 ① 생년이 맞는 후보만 목록에 오르고(서버가 다시 검증) ② 무엇을 무엇에 붙이는지 문장으로
//    쓰고 ③ 확인 창을 한 번 거친다. 서버는 이 화면을 믿지 않고 관문 7개를 다시 통과시킨다.

import { useState, useTransition } from "react";
import type { PinCandidate } from "@/features/report-admin/board-roster-diff";
import { linkClassnoteChild, unlinkClassnoteChild } from "@/features/report-admin/server/board-roster-actions";

export function PinButtons({
  studentId,
  studentName,
  boardId,
  candidates,
}: {
  studentId: string;
  studentName: string;
  boardId: number;
  candidates: PinCandidate[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  function link(c: PinCandidate) {
    // 되돌릴 수 있지만 그 사이 오발송이 날 수 있어 확인을 한 번 받는다.
    const ok = window.confirm(
      `ClassNote 원아 "${c.childName}"(${c.birthYear}년생)을 ${studentName} 학생으로 연결합니다.\n\n` +
        `앞으로 이 반의 보고서가 이 원아에게 갑니다. 같은 학생이 맞습니까?`,
    );
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await linkClassnoteChild({ studentId, boardId, childId: c.childId });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-text-faint text-xs">연결 가능:</span>
      {candidates.map((c) => (
        <button
          key={c.childId}
          type="button"
          disabled={pending}
          onClick={() => link(c)}
          className="border-line hover:bg-bg-soft rounded-full border px-2 py-0.5 text-xs font-bold disabled:opacity-50"
          title={`생년 ${c.birthYear} — 학년과 맞아 후보로 올랐습니다`}
        >
          {c.childName}
          <span className="text-text-faint font-normal"> {c.birthYear}년생</span>
          {c.nameHint ? <span className="text-primary"> · 이름 유사</span> : null}
        </button>
      ))}
      {error ? <span className="text-danger text-xs break-keep">{error}</span> : null}
    </div>
  );
}

export function UnpinButton({ studentId, boardId, childName }: { studentId: string; boardId: number; childName: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`"${childName}" 연결을 해제합니다. 이 학생은 다시 미배정으로 표시됩니다.`)) return;
          setError(null);
          start(async () => {
            const res = await unlinkClassnoteChild({ studentId, boardId });
            if (!res.ok) setError(res.error);
          });
        }}
        className="text-text-faint hover:text-danger ml-1 text-xs underline disabled:opacity-50"
      >
        연결 해제
      </button>
      {error ? <span className="text-danger ml-1 text-xs">{error}</span> : null}
    </>
  );
}
