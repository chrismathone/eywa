"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronUp, Layers, Loader2, Plus, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { saveIntegrationGroups } from "@/features/owner/server/subject-actions";
import { DEFAULT_OTHERS_TITLE } from "@/features/timetable/lib/integration-groups";

export type GroupDraft = { id: string; title: string; classIds: string[] };
export type ClassOption = { classId: string; className: string };

/**
 * 통합뷰 '그룹 설정' — 섹션을 "N교시 시작" 자동 그룹 대신 **원장이 정한 묶음**으로 바꾼다.
 * ijw-calander 통합뷰 CUSTOM_GROUP 이식(2026-07-23 원장 요청 "원하는 행으로 이동시킬 수 있어야").
 *
 * 배정 UI를 드래그가 아니라 **반마다 그룹 드롭다운**으로 한 이유: 요청의 본질이 "이 반을 어느 행에
 * 둘지"라서 목록이 길어도 한 번에 훑고 바꿀 수 있고, 좁은 창(iframe)에서도 안 깨진다.
 *
 * 저장은 학원설정(과목별) → 화면·엑셀·시트가 같은 해석기를 읽으므로 셋이 함께 움직인다.
 */
export function GroupSettingsDialog({
  subject,
  subjectLabel,
  classes,
  initialGroups,
  initialEnabled,
  initialShowOthers,
  initialOthersTitle,
}: {
  subject: string;
  subjectLabel: string;
  /** 이 과목·이 주에 실제 있는 반(그 주 시간표 기준) — 배정 대상 목록. */
  classes: ClassOption[];
  initialGroups: GroupDraft[];
  initialEnabled: boolean;
  initialShowOthers: boolean;
  initialOthersTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [groups, setGroups] = useState<GroupDraft[]>(initialGroups);
  const [showOthers, setShowOthers] = useState(initialShowOthers);
  const [othersTitle, setOthersTitle] = useState(initialOthersTitle);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // classId → 그룹 id(먼저 나온 그룹이 이긴다 = 서버·렌더 규칙과 동일 순서).
  const groupOfClass = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const id of g.classIds) if (!m.has(id)) m.set(id, g.id);
    return m;
  }, [groups]);

  const unassigned = classes.filter((c) => !groupOfClass.has(c.classId)).length;

  function addGroup() {
    // id는 편집 중 안정 키(이름을 바꿔도·순서를 옮겨도 배정이 따라온다). crypto.randomUUID는 브라우저 전용.
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `g${Date.now()}`;
    setGroups((gs) => [...gs, { id, title: `그룹 ${gs.length + 1}`, classIds: [] }]);
    setEnabled(true); // 그룹을 만들자마자 화면이 안 바뀌면 "저장이 안 됐나" 오해한다.
  }
  function move(idx: number, dir: -1 | 1) {
    setGroups((gs) => {
      const next = [...gs];
      const to = idx + dir;
      if (to < 0 || to >= next.length) return gs;
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }
  function assign(classId: string, groupId: string) {
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        // 어느 그룹에서든 먼저 빼고, 고른 그룹에만 넣는다(중복 배정 원천 차단).
        classIds: g.id === groupId ? [...g.classIds.filter((x) => x !== classId), classId] : g.classIds.filter((x) => x !== classId),
      })),
    );
  }

  function save() {
    setError(null);
    startSave(async () => {
      const res = await saveIntegrationGroups({
        subject,
        enabled,
        groups,
        showOthers,
        othersTitle,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh(); // 서버 컴포넌트가 새 설정으로 섹션을 다시 그린다.
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition"
      >
        <Layers className="size-3" />
        그룹 설정
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="bg-card border-line shadow-modal fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border"
            role="dialog"
            aria-label="통합뷰 그룹 설정"
          >
            <header className="border-line/70 flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="text-foreground text-[15px] font-bold">통합뷰 그룹 설정 · {subjectLabel}</h2>
                <p className="text-text-dim mt-0.5 text-[11px]">
                  섹션을 <b>‘N교시 시작’ 자동 묶음</b> 대신 직접 정한 묶음으로 배치합니다.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="text-text-dim hover:text-foreground">
                <X className="size-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span className="text-foreground font-medium">커스텀 그룹 사용</span>
                <span className="text-text-faint text-[11px]">끄면 자동 묶음으로 돌아갑니다(정의는 그대로 보관).</span>
              </label>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-foreground text-[13px] font-semibold">그룹 · 위에서부터 화면 순서</h3>
                  <button
                    type="button"
                    onClick={addGroup}
                    className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px]"
                  >
                    <Plus className="size-3" />
                    그룹 추가
                  </button>
                </div>
                {groups.length === 0 ? (
                  <p className="text-text-faint border-line rounded-lg border border-dashed px-3 py-4 text-center text-[12px]">
                    아직 그룹이 없습니다 — ‘그룹 추가’로 만들고 아래에서 반을 넣으세요.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {groups.map((g, i) => (
                      <li key={g.id} className="border-line flex items-center gap-2 rounded-lg border px-2 py-1.5">
                        <span className="text-text-faint num w-5 text-center text-[11px]">{i + 1}</span>
                        <input
                          value={g.title}
                          onChange={(e) =>
                            setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, title: e.target.value } : x)))
                          }
                          className="border-line focus:border-primary min-w-0 flex-1 rounded-lg border px-2 py-1 text-[13px] outline-none"
                          aria-label={`그룹 ${i + 1} 제목`}
                        />
                        <span className="text-text-faint shrink-0 text-[11px]">{g.classIds.length}개 반</span>
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로" className="text-text-dim hover:text-foreground disabled:opacity-30">
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === groups.length - 1} aria-label="아래로" className="text-text-dim hover:text-foreground disabled:opacity-30">
                          <ChevronDown className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                          aria-label="그룹 삭제"
                          className="text-text-dim hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-foreground mb-2 text-[13px] font-semibold">
                  반 배정 <span className="text-text-faint text-[11px]">이 주 시간표의 {classes.length}개 반</span>
                </h3>
                <ul className="border-line divide-line/60 divide-y rounded-lg border">
                  {classes.map((c) => (
                    <li key={c.classId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                      <span className="text-foreground min-w-0 truncate text-[13px]">{c.className}</span>
                      <select
                        value={groupOfClass.get(c.classId) ?? ""}
                        onChange={(e) => assign(c.classId, e.target.value)}
                        className="border-line focus:border-primary shrink-0 rounded-lg border px-2 py-1 text-[12px] outline-none"
                        aria-label={`${c.className} 그룹`}
                      >
                        <option value="">미배정</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title || "(제목 없음)"}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
                  <span className="text-foreground font-medium">미배정 반을 맨 아래 묶어서 보여주기</span>
                </label>
                {showOthers ? (
                  <input
                    value={othersTitle}
                    onChange={(e) => setOthersTitle(e.target.value)}
                    placeholder={DEFAULT_OTHERS_TITLE}
                    className="border-line focus:border-primary w-52 rounded-lg border px-2 py-1 text-[13px] outline-none"
                    aria-label="미배정 묶음 제목"
                  />
                ) : (
                  // 끄면 정말로 화면에서 사라지므로 숫자로 알린다(시간표가 조용히 거짓말하는 걸 막는다).
                  <p className="text-warning flex items-start gap-1 text-[11px]">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      지금 미배정 {unassigned}개 반은 통합뷰·엑셀·시트에서 <b>보이지 않습니다</b>.
                    </span>
                  </p>
                )}
              </section>

              {error ? <p className="text-danger text-[12px]">{error}</p> : null}
            </div>

            <footer className="border-line/70 flex items-center justify-end gap-2 border-t px-5 py-3">
              <button type="button" onClick={() => setOpen(false)} className="text-text-dim hover:text-foreground px-3 py-1 text-xs">
                취소
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="bg-foreground text-background inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-40"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : null}
                저장
              </button>
            </footer>
          </div>
        </>
      ) : null}
    </>
  );
}
