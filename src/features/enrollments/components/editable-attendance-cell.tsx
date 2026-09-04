"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "@/components/icons/eywa-icon-compat";
import { updateEnrollmentsAttendanceBatch } from "@/features/enrollments/server/actions";
// 요일 글자는 앱 전역 `sheetDowLabel` 단일 소스 — 여기에 표를 다시 만들지 않는다.
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { sheetDowLabel } from "@/features/teacher-view/i18n";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * 분리등원 요일(attendance_days) 더블클릭 인라인 수정 — EditableDateCell의 등원요일판.
 * 학생 상세 수업탭(스케줄 셀) + 수업 상세 로스터('화만' 배지) 공용. 노출은 호출부가
 * canManageTenant("classes")로 게이트 — 저장하는 `updateEnrollmentsAttendanceBatch`가 관리자 전용이라
 * 같은 축이어야 한다(canWriteTenant면 강사에게 칸만 열리고 저장은 거절된다).
 * children = 비편집 표시(스케줄/배지). 반 운영 요일(classDays)이 선택지, attendanceDays=[]는 전 요일 등원(분리 해제).
 * 저장은 updateEnrollmentsAttendanceBatch(단건). 전 요일 선택 = [] 저장(분리 해제), 부분 = 그 요일.
 */
export function EditableAttendanceCell({
  enrollmentId,
  classDays,
  attendanceDays,
  children,
}: {
  enrollmentId: string;
  classDays: string[];
  attendanceDays: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const lang = useSheetLang();
  const t = useSheetT();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const opts = DAY_ORDER.filter((d) => classDays.includes(d));
  const [sel, setSel] = useState<Set<string>>(new Set());

  // 요일이 1개뿐인 반은 분리등원이 불가 → 표시만(더블클릭 불가).
  if (opts.length <= 1) return <>{children}</>;

  if (!editing) {
    return (
      <button
        type="button"
        onDoubleClick={() => {
          setSel(new Set(attendanceDays.length ? attendanceDays : opts)); // []=전체 → 전 요일 체크
          setErr(null);
          setEditing(true);
        }}
        title={t("cls.ad.editTitle")}
        className="hover:bg-bg-soft -mx-1 cursor-pointer rounded px-1 py-0.5 text-left transition"
      >
        {children}
      </button>
    );
  }

  const toggle = (d: string) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });

  function save() {
    const days = opts.filter((d) => sel.has(d));
    if (days.length === 0) {
      setErr(t("cls.ad.needOne"));
      return;
    }
    start(async () => {
      // 전 요일 선택 = 분리 해제([]), 부분 선택 = 그 요일만.
      const payload = days.length === opts.length ? [] : days;
      const res = await updateEnrollmentsAttendanceBatch([{ enrollmentId, days: payload }]);
      if (res.error) setErr(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1" onKeyDown={(e) => e.key === "Escape" && setEditing(false)}>
      <span className="inline-flex gap-0.5">
        {opts.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            /* ⚠️ 영어 요일은 세 글자라 20px 고정에 안 들어간다 — 목록 화면 알약과 같은 규약. */
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[11px] font-bold transition ${
              sel.has(d) ? "bg-primary text-primary-foreground" : "bg-bg-soft text-text-faint hover:bg-bg-soft/70"
            }`}
          >
            {sheetDowLabel(d, lang)}
          </button>
        ))}
      </span>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        title={t("cls.ad.save")}
        className="text-primary hover:bg-primary/10 rounded p-1 transition disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        title={t("cls.ad.cancel")}
        className="text-text-faint hover:bg-bg-soft rounded p-1 transition"
      >
        <X className="size-3.5" />
      </button>
      {err ? <span className="text-danger ml-0.5 text-[10px]">{err}</span> : null}
    </span>
  );
}
