"use client";

import { useState, useTransition } from "react";
import { Check } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { WindowLink } from "@/components/workspace/window-link";
import { suspectReason } from "@/features/admin/duplicate-candidates";
import type { DuplicateStudent } from "@/features/admin/server/queries";
import { studentStatusLabel } from "@/features/students/status-labels";
import { clearDupSuspect } from "@/features/students/server/actions";

/**
 * 데이터 정리의 '의심'(동기화가 이름 겹침으로 접미사를 붙인 학생) 정리 — 원장 2026-10-14
 * *"데이터 정리에서는 여전히 정리할 수 있게"* · *"왜 의심인지도 간략하게"*. 원생목록의 '의심' 꼬리표를 걷은 대신
 * 이 면에서 이유를 한 줄로 보이고 그 자리에서 '정상 확인'으로 표식을 내린다.
 *
 * `canConfirm` = 학생 상세의 '정상 확인'과 같은 판정(원생 관리 전체 권한) — 서버가 정해 넘긴다(화면을 맞추는 값일 뿐,
 * 자물쇠는 `clearDupSuspect`의 권한 검사다).
 */
export function SuspectLine({ studentId, name, canConfirm }: { studentId: string; name: string; canConfirm: boolean }) {
  return (
    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>왜 의심: {suspectReason(name)}</span>
      {canConfirm ? <DupSuspectConfirm studentId={studentId} /> : null}
    </div>
  );
}

/**
 * '정상 확인' — 실제 다른 학생이 맞으면 표식을 내린다(후보에서도 빠진다). 같은 사람이면 병합으로 합친다.
 * 다시 그리기는 액션의 `revalidatePath("/owner")`가 같은 왕복에서 한다 — `router.refresh()`를 또 부르면 이 면(학생 전건 조회)이
 * 한 번 더 그려진다.
 */
function DupSuspectConfirm({ studentId }: { studentId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const confirm = () =>
    start(async () => {
      setErr(null);
      const res = await clearDupSuspect(studentId);
      if (res.error) setErr(res.error);
    });
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={confirm}>
        <Check className="size-3.5" />
        {pending ? "확인 중…" : "정상 확인"}
      </Button>
      {err ? (
        <span role="alert" className="text-danger">
          {err}
        </span>
      ) : null}
    </>
  );
}

/** 짝 없는 '의심' 학생 — 병합할 짝(퇴원 제외)이 없어 후보 그룹에 안 드는 학생들. */
export function LoneSuspects({ students, canConfirm }: { students: DuplicateStudent[]; canConfirm: boolean }) {
  return (
    <section className="space-y-2">
      <header>
        <h3 className="text-foreground text-sm font-bold">
          짝 없는 &lsquo;의심&rsquo; 학생 <span className="text-muted-foreground num font-normal">{students.length}명</span>
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          동기화가 같은 이름 때문에 따로 등록한 학생인데, 지금은 병합할 짝(퇴원 제외)이 없습니다. 짝이 퇴원했다면 같은
          학생이 다시 등록된 것일 수 있으니 원생목록에서 상태를 &lsquo;퇴원&rsquo;으로 바꿔 같은 이름을 찾아보세요(퇴원생과는
          여기서 병합하지 않습니다).
          {canConfirm ? <> 다른 학생이 맞으면 &lsquo;정상 확인&rsquo;으로 표식을 내립니다.</> : null}
        </p>
      </header>
      <ul className="space-y-1.5">
        {students.map((s) => (
          <li key={s.id} className="bg-bg-soft/30 border-border rounded-sm border px-3 py-1.5 text-xs">
            <div className="flex items-center gap-3">
              {/* 이름은 창으로(같은 이름 면과 같은 방식) · 안 줄인다 — 접미사 한 글자가 두 사람을 가른다([[#111]]). */}
              <WindowLink
                href={`/students/${s.id}`}
                title={s.name}
                className="text-foreground hover:text-primary shrink-0 font-medium whitespace-nowrap underline-offset-2 hover:underline"
              >
                {s.name}
              </WindowLink>
              <DupSuspectTag className="shrink-0" />
              <span className="text-muted-foreground min-w-0 truncate">
                {s.grade ?? "—"}
                {s.school ? ` · ${s.school}` : ""}
              </span>
              <span className="text-muted-foreground shrink-0">{studentStatusLabel(s.status)}</span>
            </div>
            <SuspectLine studentId={s.id} name={s.name} canConfirm={canConfirm} />
          </li>
        ))}
      </ul>
    </section>
  );
}
