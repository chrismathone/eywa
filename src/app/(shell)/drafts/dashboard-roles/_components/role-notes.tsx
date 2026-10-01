import type { RoleNotes } from "../_lib/describe";
import { UNNARROWABLE } from "../_lib/narrow";
import { ROLE_LABELS, type LayoutId, type RoleId } from "../_lib/roles";

const LAYOUT_NOTE: Record<LayoutId, string> = {
  a: "A 기본 — 지금 운영실 배치 그대로, 못 보는 칸만 뺌",
  b: "B 일 중심 — 그 역할이 매일 하는 일 순서로 구역을 다시 묶음",
  c: "C 압축 — 1,920×1,080 한 화면에 스크롤 없이(창을 최대화해서 볼 것)",
};

/** 시안 위 한 줄씩 — 보이는 칸 / 뺀 칸과 이유. `describeRole`이 배치에서 계산한 결과를 그대로 적는다. */
export function RoleNotesPanel({ role, layout, notes }: { role: RoleId; layout: LayoutId; notes: RoleNotes }) {
  return (
    <div className="bg-card shadow-card flex flex-col gap-2 rounded-2xl px-4 py-3 text-sm">
      <p className="font-semibold">
        {ROLE_LABELS[role]} · {role === "owner" ? "지금 운영실 그대로(카드 전부·실제 데이터)" : LAYOUT_NOTE[layout]}
      </p>
      <p>
        <b>보이는 칸</b> · {notes.sees.join(" · ") || "없음"}
      </p>
      {notes.hides.length > 0 ? (
        <p>
          <b>뺀 칸과 이유</b> · {notes.hides.map((h) => `${h.label}(${h.reason})`).join(" · ")}
        </p>
      ) : null}
      {role === "subject" ? (
        <details>
          <summary className="cursor-pointer font-semibold">과목으로 안 좁혀지는 칸 {UNNARROWABLE.length}종 — 시안에선 뺐다</summary>
          <ul className="mt-1 list-disc pl-5">
            {UNNARROWABLE.map((u) => (
              <li key={u.label}>
                {u.label} — {u.why}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
