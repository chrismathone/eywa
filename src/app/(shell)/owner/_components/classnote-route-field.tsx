"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { ClassnoteSyncNowButton } from "@/features/report-admin/components/classnote-sync-now-button";

type Route = "personal" | "class" | "pilot";

// 🔴 '기존 방식'·'일부 선생님만 반별'은 더 고를 수 없다(retired) — 2026-11-04부터 '(수학)이름' 1인 보드에 원아를 배정하지 않아
//    그 길로는 보낼 곳이 없다(원장 "앞으로 1인보드에 배정 시키지마 절대"). 지금 값이 그것이면 보이되 '반별 발송'으로만 바꿀 수 있다.
const OPTIONS: { value: Route; label: string; hint: string; retired?: boolean }[] = [
  { value: "personal", label: "기존 방식", hint: "학생마다 만든 '(수학)이름' 반으로 보냅니다 — 더 쓰지 않습니다", retired: true },
  { value: "class", label: "반별 발송", hint: "aywa 반과 이름이 같은 ClassNote 반에서, 그 학생에게만 1:1로 보냅니다" },
  { value: "pilot", label: "일부 선생님만 반별", hint: "고른 선생님의 보고서만 반별로, 나머지는 기존 방식으로 보냅니다 — 더 쓰지 않습니다", retired: true },
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
      {OPTIONS.some((o) => o.retired && o.value === route) ? (
        <p className="text-danger mt-1 text-xs">
          지금 경로는 더 쓰지 않는 방식입니다. 학생마다 만든 1인 반에는 학생을 배정하지 않아 보낼 곳이 없으니 &lsquo;반별 발송&rsquo;으로 바꿔 주세요.
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-1.5">
        {OPTIONS.map((o) => (
          <label key={o.value} className={`flex items-start gap-2 text-sm ${o.retired ? "opacity-60" : "cursor-pointer"}`}>
            <input
              type="radio"
              name="classnoteMathRoute"
              className="accent-primary mt-1"
              checked={route === o.value}
              // 지금 값인 옛 선택지는 켜 둔다 — 선택+비활성이면 키보드(Tab)가 그룹 전체를 건너뛰어 '반별 발송'으로 못 바꾼다.
              disabled={o.retired && route !== o.value}
              onChange={() => onChange({ classnoteMathRoute: o.value })}
            />
            <span>
              <span className="text-foreground font-bold">{o.label}</span>
              <span className="text-text-dim ml-1.5 text-xs">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {/* 지금 반 보드 동기화(0313a) — 반별 발송을 쓸 때만. 새 반·신입이 새벽 동기화 전이라 '보낼 반 없음'일 때 바로 맞춘다.
          모듈이 꺼졌거나 권한·SQL·반 보드가 없으면 버튼이 스스로 아무것도 안 그린다. */}
      {route !== "personal" ? <ClassnoteSyncNowButton source="owner_report_route" className="mt-2" /> : null}
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
              <span>선생님을 고르지 않으면 모두 기존 방식(1인 반)으로 가는데, 1인 반은 더 쓰지 않아 보낼 곳이 없습니다 — &lsquo;반별 발송&rsquo;으로 바꿔 주세요.</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
