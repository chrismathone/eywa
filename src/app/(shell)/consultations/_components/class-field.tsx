"use client";

import { useEffect, useState } from "react";
import { getConsultationClassOptions } from "@/features/consultations/server/class-actions";
import type { ClassOptionsResult } from "@/features/consultations/server/class-save";

type Result = ClassOptionsResult | { error: string };

/**
 * 상담 폼의 **반** 칸(원장 2026-09-30 *"상담 추가 시에도 반 매핑 가능하게"* · *"관리자 상담 등록 시에 미매핑할 수도 있게"*).
 *
 * 학생·상담사·일시·과목이 정해지면 서버가 그날 그 학생의 수강 반과 자동 판정을 돌려준다(저장과 같은 함수, class-save.ts).
 *   · 자동(기본): 반이 하나로 좁혀지면 그 반, 아니면 '미매핑' — 관리자처럼 수업을 안 하는 상담사는 자연히 미매핑.
 *   · 사람이 고르면 그 값이 이긴다(이후 입력이 바뀌어도 자동 판정이 덮지 않는다). '자동으로'로 되돌린다.
 * 서버로 보내는 값 = `classPick`(auto·manual) + `classId`(빈 값 = 미매핑). 자동이면 서버가 **다시 판정**한다(화면 값을 믿지 않는다).
 * ⚠️ 부모가 `key={학생 id}`로 다시 마운트한다 — 학생을 바꾸면 고른 반도 비운다(다른 학생의 반은 뜻이 없다).
 * ⚠️ 선택은 렌더에서 도출한다(자동 = 마지막 응답의 판정) — effect에서 선택 상태를 맞추지 않는다([[#25]]).
 */
export function ConsultationClassField({
  studentId,
  consultedAt,
  counselorId,
  subject,
  initialPick,
  initialClassId,
  initialClassName,
}: {
  studentId: string;
  /** 폼의 `datetime-local` 값(KST 벽시계). */
  consultedAt: string;
  /** 빈 값 = 본인. */
  counselorId: string;
  subject: string;
  initialPick: "auto" | "manual";
  initialClassId: string | null;
  initialClassName: string | null;
}) {
  const reqKey = `${studentId}|${consultedAt.slice(0, 10)}|${counselorId}|${subject.trim()}`;
  const [result, setResult] = useState<{ key: string; res: Result } | null>(null);
  const [pick, setPick] = useState<"auto" | "manual">(initialPick);
  const [manualId, setManualId] = useState(initialPick === "manual" ? (initialClassId ?? "") : "");

  useEffect(() => {
    if (!studentId) return;
    let alive = true;
    // 타이핑(과목)·스크롤(일시) 중엔 부르지 않는다 — 멈춘 뒤 한 번.
    const timer = window.setTimeout(() => {
      getConsultationClassOptions({ studentId, consultedAt, counselorId: counselorId || null, subject: subject || null })
        .then((res) => {
          if (alive) setResult({ key: reqKey, res });
        })
        .catch(() => {
          if (alive) setResult({ key: reqKey, res: { error: "반 목록을 불러오지 못했습니다" } });
        });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [reqKey, studentId, consultedAt, counselorId, subject]);

  const current = result && result.key === reqKey ? result.res : null;
  // 칸이 DB에 없으면(0318a 전) 이 칸 자체를 그리지 않는다 — 부모도 그 경우엔 애초에 안 그린다([[#95]]).
  if (current && "supported" in current && !current.supported) return null;
  const loaded = current && "supported" in current && current.supported ? current : null;
  const options = loaded?.options ?? [];
  const autoId = loaded?.auto.classId ?? "";
  const value = pick === "manual" ? manualId : autoId;
  // 고른 반이 그날 선택지에 없으면(일시를 바꿨다 등) 그 반을 그대로 보이되 저장이 막힌다고 알린다(서버도 막는다).
  const strayManual = pick === "manual" && manualId && loaded && !options.some((o) => o.id === manualId);

  let hint: string;
  if (!studentId) hint = "학생을 고르면 그날 수강 반이 나옵니다";
  else if (current && "error" in current) hint = current.error;
  else if (!loaded) hint = "반을 확인하는 중…";
  else if (pick === "manual") hint = strayManual ? "고른 반이 그날 이 학생의 수강 반이 아닙니다 — 저장되지 않습니다" : "직접 고름";
  else hint = loaded.auto.classId ? `자동 · ${loaded.auto.reasonLabel}` : `자동 · ${loaded.auto.reasonLabel} → 반 없음`;

  return (
    <div className="space-y-1.5">
      <label htmlFor="classSelect" className="text-foreground block text-sm font-medium break-keep">
        반
      </label>
      <input type="hidden" name="classPick" value={pick} />
      <input type="hidden" name="classId" value={value} />
      <select
        id="classSelect"
        value={value}
        disabled={!studentId}
        onChange={(e) => {
          setPick("manual");
          setManualId(e.target.value);
        }}
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-60"
      >
        <option value="">반 없음 (—)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {strayManual ? <option value={manualId}>{initialClassName ?? "고른 반"} (그날 수강 반 아님)</option> : null}
      </select>
      <p className={`text-xs break-keep ${strayManual || (current && "error" in current) ? "text-danger" : "text-muted-foreground"}`}>
        {hint}
        {pick === "manual" ? (
          <button type="button" onClick={() => setPick("auto")} className="text-primary ml-2 font-medium hover:underline">
            자동으로
          </button>
        ) : null}
      </p>
    </div>
  );
}
