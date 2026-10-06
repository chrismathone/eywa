"use client";

import { AlertTriangle, ArrowRight, Info, LayoutGrid, Plus, UserMinus, UserPlus } from "@/components/icons/aywa-icon-compat";
import type { MathGridPreview, PreviewSlot, StudentState } from "@/features/timetable/import/math-grid/build-preview";

const STATE_HINT: Record<Exclude<StudentState, "ok">, string> = {
  unknown: "학생 명부에 없음",
  ambiguous: "같은 이름이 여럿",
};

function SlotLine({ slot }: { slot: PreviewSlot }) {
  return (
    <p className="text-text-dim">
      <span className={slot.teacherKnown ? "text-foreground" : "text-chart-4"}>{slot.teacher}</span>
      {slot.teacherKnown ? null : <span className="text-chart-4"> (직원 명단에 없는 이름)</span>}
      {" · "}
      {slot.when}
      {slot.room ? (
        <>
          {" · "}
          <span className={slot.roomKnown ? undefined : "text-amber"}>{slot.room}</span>
          {slot.roomKnown ? null : <span className="text-amber"> (등록된 강의실 이름과 다름)</span>}
        </>
      ) : (
        <span className="text-amber"> · 강의실 없음</span>
      )}
    </p>
  );
}

/**
 * 수학 시간표 **격자 탭**에서 읽은 변경 — 확인용(아직 반영하지 않는다).
 * '수강편집' 탭 미리보기와 따로 선다: 저쪽은 적용 버튼이 있고, 이쪽은 읽힌 내용을 보여 주기만 한다.
 */
export function MathGridPreviewSection({ preview }: { preview: MathGridPreview }) {
  const changed =
    preview.newClasses.length + preview.placedClasses.length + preview.moves.length + preview.adds.length + preview.removes.length;

  return (
    <section className="border-line mt-4 space-y-3 rounded-lg border p-3 text-xs">
      <header>
        <h3 className="text-foreground flex items-center gap-1 font-bold">
          <LayoutGrid className="size-3" /> 시간표 탭에서 읽은 변경
        </h3>
        <p className="text-text-faint mt-0.5 break-keep">
          ‘{preview.tabName}’ 탭 · 반 칸 {preview.stats.classCells}개 · 학생 {preview.stats.students}줄을 읽었습니다.{" "}
          <b className="text-text-dim">확인용이며 아직 반영되지 않습니다.</b>
        </p>
      </header>

      {changed === 0 ? (
        <p className="text-text-faint break-keep">
          {preview.warnings.length > 0
            ? "읽은 범위에서는 달라진 것이 없습니다 — 아래 ‘읽지 못한 것’을 확인하세요."
            : "시간표 탭에서 달라진 것이 없습니다."}
        </p>
      ) : null}

      {/* 안쪽에 스크롤을 또 두지 않는다 — 창 자체가 스크롤된다(이동 6건 중 2건만 보이던 것을 실측으로 확인). */}
      <div className="space-y-3">
        {preview.newClasses.length > 0 ? (
          <div>
            <h4 className="text-blue mb-1 flex items-center gap-1 font-bold">
              <Plus className="size-3" /> 새 반 {preview.newClasses.length}개
            </h4>
            <div className="space-y-1.5">
              {preview.newClasses.map((c) => (
                <div key={c.name} className="border-line rounded-sm border px-2 py-1.5">
                  <p className="text-foreground font-bold">{c.name}</p>
                  {c.slots.map((s, i) => (
                    <SlotLine key={i} slot={s} />
                  ))}
                  <p className="text-text-dim mt-0.5 break-keep">
                    학생 {c.students.length}명
                    {c.students.length > 0 ? " — " : ""}
                    {c.students.map((s, i) => (
                      <span key={i}>
                        {i > 0 ? ", " : ""}
                        <span className={s.state === "ok" ? undefined : "text-chart-4"}>
                          {s.label}
                          {s.state === "ok" ? "" : ` (${STATE_HINT[s.state]})`}
                        </span>
                      </span>
                    ))}
                  </p>
                  {c.clash ? (
                    <p className="text-chart-4 mt-0.5 break-keep">같은 이름의 종강 반이 있습니다 — 이 이름으로는 새 반을 만들 수 없습니다.</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {preview.placedClasses.length > 0 ? (
          <div>
            <h4 className="text-blue mb-1 flex items-center gap-1 font-bold">
              <Plus className="size-3" /> 시간표에 새로 놓인 반 {preview.placedClasses.length}개
            </h4>
            <div className="space-y-1.5">
              {preview.placedClasses.map((c) => (
                <div key={c.name} className="border-line rounded-sm border px-2 py-1.5">
                  <p className="text-foreground font-bold">{c.name}</p>
                  {c.slots.map((s, i) => (
                    <SlotLine key={i} slot={s} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {preview.moves.length > 0 ? (
          <div>
            <h4 className="text-primary mb-1 flex items-center gap-1 font-bold">
              <ArrowRight className="size-3" /> 이동 {preview.moves.length}건
            </h4>
            <div className="border-line divide-line divide-y rounded-sm border">
              {preview.moves.map((m, i) => (
                <p key={i} className="text-text-dim px-2 py-1">
                  <b className="text-foreground">{m.student}</b> {m.from} <span className="text-text-faint">→</span>{" "}
                  <span className="text-primary">{m.to}</span>
                  {m.toNew ? <span className="text-blue"> (새 반)</span> : null}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {preview.adds.length > 0 ? (
          <div>
            <h4 className="text-blue mb-1 flex items-center gap-1 font-bold">
              <UserPlus className="size-3" /> 추가 {preview.adds.length}건
            </h4>
            <div className="border-line divide-line divide-y rounded-sm border">
              {preview.adds.map((a, i) => (
                <p key={i} className="text-text-dim px-2 py-1">
                  <b className={a.state === "ok" ? "text-foreground" : "text-chart-4"}>{a.student}</b>
                  {a.state === "ok" ? null : <span className="text-chart-4"> ({STATE_HINT[a.state]})</span>}{" "}
                  <span className="text-text-faint">→</span> <span className="text-blue">{a.to}</span>
                  {a.toNew ? <span className="text-blue"> (새 반)</span> : null}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {preview.removes.length > 0 ? (
          <div>
            <h4 className="text-amber mb-1 flex items-center gap-1 font-bold">
              <UserMinus className="size-3" /> 반에서 빠짐 {preview.removes.length}건
            </h4>
            <div className="border-line divide-line divide-y rounded-sm border">
              {preview.removes.map((r, i) => (
                <p key={i} className="text-text-dim px-2 py-1">
                  <b className="text-foreground">{r.student}</b> {r.from}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {preview.warnings.length > 0 ? (
          <div className="bg-amber-soft text-amber rounded-sm p-2">
            <p className="mb-1 flex items-center gap-1 font-bold">
              <AlertTriangle className="size-3" /> 읽지 못한 것 {preview.warnings.length}건
            </p>
            {preview.warnings.map((w, i) => (
              <p key={i} className="break-keep">· {w}</p>
            ))}
          </div>
        ) : null}

        {preview.notes.length > 0 ? (
          <div className="bg-bg-soft text-text-dim rounded-sm p-2">
            <p className="mb-1 flex items-center gap-1 font-bold">
              <Info className="size-3" /> 참고 {preview.notes.length}건
            </p>
            {preview.notes.map((n, i) => (
              <p key={i} className="break-keep">· {n}</p>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-text-faint break-keep">
        읽는 것: 새 반(강사·요일·교시·강의실)과 학생의 반 이동·추가·빠짐. 기존 반의 요일·교시·강사·강의실을 바꾼 것과
        강사별 탭에서 고친 것은 아직 읽지 않습니다.
      </p>
    </section>
  );
}
