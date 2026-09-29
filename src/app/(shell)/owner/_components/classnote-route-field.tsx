"use client";

import { EyIcon } from "@/components/icons/aywa-icons";

type Route = "personal" | "class" | "pilot";

const OPTIONS: { value: Route; label: string; hint: string }[] = [
  { value: "personal", label: "기존 방식", hint: "학생마다 만든 '(수학)이름' 반으로 보냅니다" },
  { value: "class", label: "반별 발송", hint: "aywa 반과 이름이 같은 ClassNote 반에서, 그 학생에게만 1:1로 보냅니다" },
  { value: "pilot", label: "일부 선생님만 반별", hint: "고른 선생님의 보고서만 반별로, 나머지는 기존 방식으로 보냅니다" },
];

/**
 * 보고서 설정 > 수학 발송 경로(원장 2026-09-29 — "기존 (수학) 이름 / 변경된 반 / 일부 선생님만 테스트").
 * 소비처 = 발송 워커(`getClassnoteMathRoute`, classnote-core.mjs). 이 칸만 바꿔도 다음 발송부터 경로가 바뀐다.
 * 🔴 반별 발송은 **매칭 기록이 초록(C.N)인 학생만** 나간다 — 빨간 학생은 발송 실패로 멈추고 사유를 남긴다.
 */
export function ClassnoteRouteField({
  route,
  pilot,
  mathTeachers,
  onChange,
}: {
  route: Route;
  pilot: string[];
  /** 수학 반 담당 강사 표시 이름(활성 직원). */
  mathTeachers: string[];
  onChange: (patch: { classnoteMathRoute?: Route; classnoteMathRoutePilot?: string[] }) => void;
}) {
  const togglePilot = (name: string) =>
    onChange({ classnoteMathRoutePilot: pilot.includes(name) ? pilot.filter((n) => n !== name) : [...pilot, name] });
  // 저장돼 있지만 지금 수학 담당 목록에 없는 이름(퇴사·담당 변경) — 풀 수 있게 따로 보인다.
  const orphans = pilot.filter((n) => !mathTeachers.includes(n));
  return (
    <div className="border-line mt-3 border-t pt-3">
      <p className="text-foreground text-sm font-bold">수학 발송 경로</p>
      <p className="text-text-dim mt-0.5 text-xs">
        반별 발송은 원스크린에서 <b>C.N이 초록</b>인 학생만 나갑니다. 빨간 학생은 발송하지 않고 사유를 남깁니다.
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="classnoteMathRoute"
              className="accent-primary mt-1"
              checked={route === o.value}
              onChange={() => onChange({ classnoteMathRoute: o.value })}
            />
            <span>
              <span className="text-foreground font-bold">{o.label}</span>
              <span className="text-text-dim ml-1.5 text-xs">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {route === "pilot" ? (
        <div className="mt-2">
          <div className="flex flex-wrap gap-2">
            {[...mathTeachers, ...orphans].map((name) => {
              const on = pilot.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => togglePilot(name)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    on ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {pilot.length === 0 ? (
            <p className="text-danger mt-2 flex items-start gap-1.5 text-xs">
              <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>선생님을 고르지 않으면 모두 기존 방식으로 발송됩니다.</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
