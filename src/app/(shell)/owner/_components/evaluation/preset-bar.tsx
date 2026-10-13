"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EvaluationConfig } from "@/features/teacher-portfolio/evaluation/config";
import { deleteEvaluationPreset, saveEvaluationPreset } from "@/features/teacher-portfolio/server/preset-actions";
import { SettingsCard } from "../settings-card";

export type PresetOption = { id: string; name: string; config: EvaluationConfig; builtin?: boolean };

/**
 * 구성 저장·불러오기(원장 2026-10-13 *"폼 저장? 불러오기?"*) — 기본 제공 구성 둘과 원장이 이름 붙여 저장한 구성.
 * 불러오기는 **화면에 얹기만** 한다 — 점수를 매기는 설정은 아래 [저장]을 눌러야 바뀐다(되돌리기로 저장된 설정에 돌아간다).
 * ⚠️ 이 칸들에는 `name`을 붙이지 않는다 — 미저장 가드(폼 스냅샷)가 구성 이름 입력을 '설정을 고쳤다'로 읽지 않게.
 */
export function PresetBar({ presets, draft, dirty, readOnly, tableMissing, onLoad }: {
  presets: PresetOption[]; draft: EvaluationConfig; dirty: boolean; readOnly: boolean; tableMissing: boolean;
  onLoad: (config: EvaluationConfig) => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(presets[0]?.id ?? "");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const chosen = presets.find((p) => p.id === picked);
  const saved = presets.filter((p) => !p.builtin);

  const load = () => {
    if (!chosen) return;
    if (dirty && !window.confirm(`지금 화면에서 고친 내용 대신 ‘${chosen.name}’ 구성을 얹을까요?`)) return;
    onLoad(structuredClone(chosen.config));
    toast.success(`‘${chosen.name}’ 구성을 불러왔습니다. 아래 [저장]을 눌러야 점수에 반영됩니다`);
  };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    if (saved.some((p) => p.name === n) && !window.confirm(`‘${n}’ 구성을 지금 화면의 내용으로 바꿀까요?`)) return;
    startTransition(async () => {
      const result = await saveEvaluationPreset(n, draft);
      if (!result.ok) { toast.error(result.error ?? "구성을 저장하지 못했습니다"); return; }
      toast.success(result.notice ?? "저장했습니다");
      setName("");
      router.refresh();
    });
  };
  const remove = () => {
    if (!chosen || chosen.builtin || !window.confirm(`‘${chosen.name}’ 구성을 지울까요? 지금 점수를 매기는 설정은 그대로입니다.`)) return;
    startTransition(async () => {
      const result = await deleteEvaluationPreset(chosen.id);
      if (!result.ok) { toast.error(result.error ?? "구성을 지우지 못했습니다"); return; }
      toast.success(result.notice ?? "지웠습니다");
      setPicked(presets[0]?.id ?? "");
      router.refresh();
    });
  };

  return (
    <SettingsCard title="구성 저장·불러오기" span2
      description="자주 쓰는 구성을 이름 붙여 저장해 두고 불러옵니다. 불러오면 화면에만 얹히고, 아래 [저장]을 눌러야 점수에 반영됩니다.">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="불러올 구성" value={picked} onChange={(e) => setPicked(e.target.value)} disabled={readOnly}
          className="border-line bg-card min-h-(--control-h) min-w-0 max-w-full rounded-lg border px-3">
          <optgroup label="기본 제공">
            {presets.filter((p) => p.builtin).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          {saved.length ? (
            <optgroup label="저장한 구성">
              {saved.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ) : null}
        </select>
        <Button type="button" variant="outline" onClick={load} disabled={!chosen || readOnly}>불러오기</Button>
        {chosen && !chosen.builtin ? (
          <Button type="button" variant="ghost" onClick={remove} disabled={readOnly || pending}>이 구성 지우기</Button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input aria-label="저장할 구성 이름" value={name} maxLength={30} placeholder="예: 2027 상반기 기준" className="w-56 max-w-full"
          disabled={readOnly || tableMissing}
          onChange={(e) => setName(e.target.value)}
          // 이 칸의 Enter가 바깥 설정 폼을 저장하지 않게 — 구성 저장으로 돌린다.
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
        <Button type="button" onClick={save} disabled={readOnly || tableMissing || pending || !name.trim()} aria-busy={pending}>
          {pending ? "저장 중…" : "지금 화면을 구성으로 저장"}
        </Button>
      </div>
      {tableMissing ? <p className="mt-2 text-xs">구성을 저장할 표가 아직 준비되지 않았습니다. 기본 제공 구성은 지금도 불러올 수 있습니다.</p> : null}
    </SettingsCard>
  );
}
