"use client";

// 수업계획 표 — 시기(평시/내신) 그룹 헤더 + 가변 행. 행 추가/삭제/시기 이동은 RPC(구조 변경),
// 셀 텍스트는 CAS 자동저장(plan-row). ⚠️ <col/>과 같은 줄에 주석 금지(하이드레이션, onescreen 선례).
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import type { PlanLineDTO } from "../server/actions";
// 핸들러는 **계획 줄 기계**의 좁은 타입만 받는다 — 시트 쪽 넓은 핸들러는 이걸 포함하므로 그대로 넘어가고,
// 자리 출석부 JJ 열처럼 출결·마크가 없는 호스트도 같은 표를 쓸 수 있다(표를 두 벌로 만들지 않는 이유).
import type { PlanHandlers } from "./use-plan-handlers";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PlanRow } from "./plan-row";
import { PlanCompareButton } from "./plan-compare-dialog";
import { useShiftConfirm } from "./shift-confirm";
import { canShiftCell } from "../lib/shift-visible";
import { useSheetLang } from "@/features/teacher-view/lang-context";
import { sheetT, sheetTf } from "@/features/teacher-view/i18n";

// 시기 칩 — 원본 시트에서 '평시/내신'은 계획 묶음을 가르는 큰 구분이라 알약도 또렷하게(솔리드/앰버).
// ⚠️ 라벨은 사전이 정한다(강사뷰 영어 화면) — 여기에 한글을 다시 박지 말 것.
const TERMS: {
  key: "regular" | "exam";
  labelKey: "plan.term.regular" | "plan.term.exam";
  tone: string;
}[] = [
  { key: "regular", labelKey: "plan.term.regular", tone: "border-primary bg-primary text-primary-foreground" },
  { key: "exam", labelKey: "plan.term.exam", tone: "border-amber/60 text-amber bg-amber-soft" },
];

export function PlanTable({
  date,
  slotStart,
  lines,
  skillAreas,
  store,
  handlers,
  canEdit,
  showExamTerm,
  shift,
}: {
  date: string;
  slotStart: string;
  lines: PlanLineDTO[];
  skillAreas: SkillAreaSetting[];
  store: SheetSaveStore;
  handlers: PlanHandlers;
  canEdit: boolean;
  /**
   * 이 칸의 회차 표식(0282a — 줄 표식은 칸으로 접은 요약). 미룸 표식이 있는 **빈** 칸에 [당김](채우기)을 세우는 데만
   * 쓴다(원장 2026-10-20). 넘기지 않는 화면(주간 시트)은 그 버튼이 없다.
   */
  shift?: "skip" | "advance" | null;
  /**
   * '내신' 구획을 그릴지 — EiE 반은 **초등 수업이라 내신이 없다**(원장 2026-08-06 "EiE 수업의 경우
   * 내신 제거"). 판정은 `classes.english_track` 컬럼뿐(반 이름 추측 금지 — english-track.ts 🔴).
   * ⚠️ **끄더라도 이미 저장된 내신 줄이 있으면 그린다**(아래) — 안 그러면 쓴 게 화면에서 증발한다.
   */
  showExamTerm: boolean;
}) {
  const defaultArea = skillAreas[0]?.key ?? "vocab";
  const lang = useSheetLang();
  // 미룸·당김은 확인 창을 거친다(원장 2026-10-19) — 실행·되돌리기는 핸들러(`use-plan-handlers`)가 한다.
  const shiftConfirm = useShiftConfirm((d, s, kind, which) => handlers.setShift?.(d, s, kind, which));
  return (
    <div className="space-y-1">
      {TERMS.map((term) => {
        const termLabel = sheetT(lang, term.labelKey);
        const rows = lines.filter((l) => l.termMode === term.key);
        // 내신을 안 쓰는 반: **빈 구획만** 숨긴다. 줄이 남아 있으면(과거 입력·시트 임포트) 그대로 보여
        // 사람이 지우거나 옮길 수 있게 한다 — 조용히 감추면 "쓴 게 안 보임"이 된다(07-31 함정 재발 방지).
        // 실측(2026-08-06): EiE 반의 내신 줄은 0건이라 지금은 전건이 그냥 사라진다.
        if (rows.length === 0 && term.key === "exam" && !showExamTerm) return null;
        if (rows.length === 0 && term.key === "exam" && !canEdit) return null;
        return (
          <div key={term.key}>
            {/* flex-wrap — 칩이 셋(시기·줄 추가·내용 복사)이라 글씨 크기를 키우면 한 줄을 넘길 수 있다.
                안 감싸면 넘친 칩이 옆 카드 배경에 덮여 "라벨이 잘린" 것처럼 보인다(디자인 규칙). */}
            <div className="flex flex-wrap items-center gap-1.5 py-0.5">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${term.tone}`}>
                {termLabel}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="border-line-strong text-foreground hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold"
                  onClick={() => handlers.addLine(date, slotStart, term.key, defaultArea)}
                >
                  {sheetT(lang, "plan.addRow")}
                </button>
              ) : null}
              {/* 내용 복사 — **항상** 뜬다(평시 포함). 옛 '직전 교시 복사'는 비어 있을 때만 떴는데, 평시는
                  교재를 미리 적어 두는 자리라 사실상 한 번도 안 보였다(원장 2026-08-14 "평시에도 추가").
                  이제 서버가 덮어쓰기 대신 **빈 칸만** 채우므로(0209a) 이미 쓴 구획에서 눌러도 잃을 게 없다.
                  ⚠️ 라벨에 '(지난 수업)'을 박는다 — "오늘 직전 차시인지 전날인지" 헷갈린다는 지적이 이
                     버튼의 유일한 실제 불만이었다. 원본은 **같은 교시의 지난 수업일**이고, 강사 수업은
                     0245a부터 **같은 요일**까지 좁힌다(요일마다 커리큘럼이 달라 남의 수업이 딸려 왔다). */}
              {canEdit ? (
                <button
                  type="button"
                  className="border-line-strong text-foreground hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold"
                  title={sheetTf(lang, "plan.copy.title", { term: termLabel })}
                  onClick={() => handlers.copySlot(date, slotStart, term.key)}
                >
                  {sheetT(lang, "plan.copy")}
                </button>
              ) : null}
              {/* 계획 비교(원장 2026-09-28) — 이 칸의 원래 월간계획 ↔ 실제를 모달로 견준다(읽기 전용).
                  🔴 옛 [월간계획 가져오기](교시 한 칸)는 없앴다(*"한주씩 가져오는건 필요없음"*) — 가져오기는
                     교재 배정 하나뿐이다(2026-10-22). **평시 구획에만** 둔다(배정은 평시 축뿐).
                  ⚠️ 문이 기능을 안 내면(공개 자리 PIN) 핸들러가 `undefined`라 버튼이 아예 안 선다. */}
              {term.key === "regular" && handlers.comparePlan ? (
                <PlanCompareButton
                  date={date}
                  slotStart={slotStart}
                  load={() => handlers.comparePlan!(date, slotStart)}
                />
              ) : null}
              {/* 🔴 **회차 미루기·당기기는 여기 있어야 한다**(원장 제보 2026-09-22 *"밀기 당기기는 어디에있음?"*)
                  — 처음엔 월간 달력 칸에만 뒀는데, 사람이 서 있는 자리는 **실제를 적는 이 표**다.
                  원장 원문도 *"실제 에서는 수업 회차를 한주 미루거나 당기거나"*였다.
                  ⚠️ 지난 날짜에도 **막지 않는다** — "지난주에 못 나갔다"를 뒤늦게 미루는 게 정상 흐름이고,
                     실제 줄은 안 건드리므로 눌러도 잃을 게 없다(바뀌는 건 앞으로의 차수 배치뿐).
                  🔑 2026-10-15부터 **실제 진도를 한 주씩 민다/당긴다**(*"미루는 거기 복사하고 한주씩 쭉 밀기"*)
                     — 토글이 아니라 누를 때마다 한 주.
                  🔴 2026-10-19 원장 *"계획만 있으면 버튼 숨겨"* — 이 칸에 **실제 줄이 없으면 안 세운다**(월간계획만
                     있는 칸에서 밀면 아직 쓰지도 않은 진도를 옮기는 꼴이다). 누르면 확인 창 → 실행 → [되돌리기]. */}
              {/* 🔑 **줄마다**(원장 2026-10-20 *"수업이 2개면 각각 미룸, 당김 버튼이 활성화"*) — 누른 줄의 교재 한 차수만
                  움직이고 같은 칸의 다른 줄은 그대로다. 줄이 하나면 지금처럼 버튼 둘, 둘 이상이면 줄 이름을 붙여
                  줄마다 한 벌씩. 내용 없는 줄(구분만 고른 빈 줄)엔 안 세운다(`canShiftCell`). */}
              {canEdit && term.key === "regular" && handlers.setShift
                ? shiftTargets(rows, skillAreas).map(({ line, label }) => (
                    <span key={line.id} className="inline-flex items-center gap-1">
                      {label ? <span className="text-text-dim text-xs font-bold">{label}</span> : null}
                      {(["skip", "advance"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className="border-line-strong text-foreground hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold"
                          title={sheetT(lang, kind === "skip" ? "plan.shift.skip.title" : "plan.shift.advance.title")}
                          onClick={() => shiftConfirm.ask(date, slotStart, kind, { lineId: line.id })}
                        >
                          {sheetT(lang, kind === "skip" ? "plan.shift.skip" : "plan.shift.advance")}
                        </button>
                      ))}
                    </span>
                  ))
                : null}
              {/* 🔑 **미뤄서 비운 칸엔 [당김]만**(원장 2026-10-20 *"계획만 있을 경우 미룸버튼은 없고 당겨서"*) — 그 칸의
                  미룸을 걷어 뒤 수업이 한 칸씩 올라와 채운다(버려지는 차수 없음). 이 표는 월간계획을 모르므로 **이 칸에
                  미룸 표식이 있다**는 사실(`shift`)로만 세운다 — 표식을 안 넘기는 화면(주간 시트)에선 안 선다. */}
              {canEdit && term.key === "regular" && handlers.setShift && shift === "skip" && !canShiftCell(rows) ? (
                <button
                  type="button"
                  className="border-line-strong text-foreground hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold"
                  title={sheetT(lang, "month.shift.fill.title")}
                  onClick={() => shiftConfirm.ask(date, slotStart, "advance", { fill: true })}
                >
                  {sheetT(lang, "plan.shift.advance")}
                </button>
              ) : null}
            </div>
            {rows.length > 0 ? (
              // 고정 열은 요일 열 다이어트(2026-08-17, today-columns TODAY_PLAN_W 540→436)와 함께 줄였다
              // — 안 줄이면 가변인 진도·과제가 남는 폭을 뒤집어쓰고 슬리버로 무너진다(today-columns ⚠️).
              // 하한: 구분 = 영역 라벨 2~3자+네이티브 셀렉트 화살표 ≈ 70 → 76 · 시간 = 머리
              // '페이지/시간' 11px bold ≈ 61 → 64 · × = 아이콘14+패딩4 → 22. (표 안 주석 금지 — 파일 상단 ⚠️)
              <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {/* 구분 76 → 100(2026-09-08): 네이티브 셀렉트는 화살표 16px을 먼저 먹어 76px에선 영역 라벨이
                      잘렸다. 90으로도 실브라우저에서 `Listening`이 `Listenir`로 끊겨 100. 늘린 몫은 카드 폭
                      (TODAY_PLAN_W 406→420) + 가변 열(진도·과제, 한 줄 textarea라 스크롤로 산다)에서 나온다. */}
                  <col style={{ width: 100 }} />
                  <col style={{ width: 106 }} />
                  <col style={{ width: lang === "en" ? 82 : 64 }} />
                  <col />
                  <col />
                  <col style={{ width: 22 }} />
                </colgroup>
                <thead className="[&_th]:break-normal [&_th]:[overflow-wrap:normal]">
                  {/* 헤더 밴드 — 원본 시트의 노란 머리글(시기·구분·교재·시간·진도·과제)과 같은 역할. */}
                  <tr className="bg-bg-soft text-foreground text-left text-xs">
                    <th className="rounded-l-md py-0.5 pl-1 font-bold">{sheetT(lang, "plan.col.kind")}</th>
                    <th className="py-0.5 font-bold">{sheetT(lang, "plan.col.book")}</th>
                    {/* '페이지' → '시간'(원장 2026-08-11) → **'페이지/시간'**(원장 2026-08-13 "둘 중 아무거나
                        입력가능하도록"). ⚠️ **라벨만 바뀐다** — 저장은 내내 같은 `page_range` 한 칸이다.
                        실측(2026-08-11, 프로덕션 768행) 채워진 326건에 `25분`(56)·`15분`(53)과 `104`·`2강씩`이
                        섞여 있었다 = 강사들은 이미 둘 다 적고 있었다. 새 컬럼을 파면 그 기록이 화면에서 사라진다. */}
                    <th className="py-0.5 font-bold" title={sheetT(lang, "plan.col.pageTime.title")}>
                      {sheetT(lang, "plan.col.pageTime")}
                    </th>
                    <th className="py-0.5 font-bold">{sheetT(lang, "plan.col.progress")}</th>
                    <th className="py-0.5 font-bold">{sheetT(lang, "plan.col.homework")}</th>
                    <th className="rounded-r-md" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <PlanRow
                      key={l.id}
                      line={l}
                      date={date}
                      slotStart={slotStart}
                      skillAreas={skillAreas}
                      store={store}
                      handlers={handlers}
                      canEdit={canEdit}
                    />
                  ))}
                </tbody>
              </table>
            ) : term.key === "regular" ? (
              <p className="text-text-dim px-1 py-0.5 text-xs font-semibold">{sheetT(lang, "plan.empty")}</p>
            ) : null}
            {/* ⚠️ 내신이 비었을 땐 **아무것도 안 그린다**(원장 2026-08-10 "이런 trash 공간 제거") —
                예전엔 빈 문자열을 담은 <p>가 남아 '내신' 칩 밑에 padding만큼 빈 띠가 깔렸다. */}
          </div>
        );
      })}
      {shiftConfirm.dialog}
    </div>
  );
}

/**
 * 미룸·당김을 세울 줄 — 내용이 적힌 평시 줄(`canShiftCell`). 줄이 둘 이상이면 어느 줄 버튼인지 이름을 붙인다
 * (구분 라벨, 같은 구분이 둘이면 순번 — `Grammar 1`·`Grammar 2`). 하나면 이름 없이.
 */
function shiftTargets(rows: readonly PlanLineDTO[], skillAreas: readonly SkillAreaSetting[]): { line: PlanLineDTO; label: string | null }[] {
  const lines = rows.filter((l) => canShiftCell([l]));
  if (lines.length <= 1) return lines.map((line) => ({ line, label: null }));
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const l of lines) total.set(l.skillArea, (total.get(l.skillArea) ?? 0) + 1);
  return lines.map((line) => {
    const n = (seen.get(line.skillArea) ?? 0) + 1;
    seen.set(line.skillArea, n);
    const name = skillAreas.find((a) => a.key === line.skillArea)?.label ?? line.skillArea;
    return { line, label: (total.get(line.skillArea) ?? 0) > 1 ? `${name} ${n}` : name };
  });
}
