"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RiderContact } from "@/features/shuttle/server/rider-contacts";

/**
 * 오늘 등하원 줄의 **학생·학부모 전화번호**(사용자 2026-10-21 — 전화할 일이 많다).
 * 페이지가 기록 권한이 있을 때만 싣고(`getRiderContacts`), 줄은 컨텍스트로 읽는다 — 보드 → 회차 → 줄로 prop을 세 겹 내리지 않게.
 */
const Ctx = createContext<Readonly<Record<string, RiderContact>>>({});

export function RiderContactsProvider({ value, children }: { value: Readonly<Record<string, RiderContact>>; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 번호 하나 — 누르면 걸린다(tel:). 없으면 빈칸 표시(—). */
function Phone({ label, phone }: { label: string; phone: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
      <span className="text-text-dim">{label}</span>
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="num text-primary font-bold underline-offset-2 hover:underline">
          {phone}
        </a>
      ) : (
        <span className="text-text-faint">—</span>
      )}
    </span>
  );
}

/**
 * 탑승·미탑승 버튼 **위** 한 줄 — `학생 010-… · 학부모 010-…`.
 * 🔑 학부모 번호는 **연결된 학부모 계정**에서만 온다 — 계정을 연결하기 전엔 빈칸(—)이다. 둘이면 둘 다.
 */
export function RiderContactLine({ studentId, onlyLoaded = false }: {
  studentId: string;
  /**
   * 실린 번호가 없으면 줄 자체를 안 그린다 — 기록 칸이 없는 **읽기 줄**용. 읽기 강사뷰는 쓰기가 막혀도 대상 강사가 보는 번호를
   * 보여 주지만(record-gate `canSeeBoardingContacts`), 번호를 볼 자격이 없는 열람 계정엔 빈 줄('—')을 세우지 않는다.
   */
  onlyLoaded?: boolean;
}) {
  const c = useContext(Ctx)[studentId];
  if (onlyLoaded && !c) return null;
  const parents = c?.parents ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <Phone label="학생" phone={c?.student ?? null} />
      {parents.length === 0 ? (
        <Phone label="학부모" phone={null} />
      ) : (
        parents.map((p, i) => <Phone key={p} label={parents.length > 1 ? `학부모${i + 1}` : "학부모"} phone={p} />)
      )}
    </div>
  );
}
