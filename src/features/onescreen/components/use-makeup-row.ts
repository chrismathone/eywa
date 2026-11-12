"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { setMakeupClass } from "../server/makeup-class-actions";
import { removeMakeupEntry } from "../server/makeup-remove-actions";
import { makeupRemoveBlockReason } from "../makeup-remove-plan";
import type { OneScreenStudent } from "../types";
import type { TodayClass } from "../server/roster";
import { fetchMakeupHostClasses } from "@/features/attendance/server/makeup-actions";
import { hostChoicesFor } from "@/features/attendance/makeup-host";
import type { ReportsState } from "../session-input";
import type { SendClassAsk } from "./send-class-dialog";
import type { MakeupAttendanceDeps, MakeupI18n, PatchStudent } from "./makeup-flow-types";

/** 보강 행의 수업 바꾸기·빼기 — 수정 계획 P3-O batch C, `use-makeup-flow.ts`에서 나눔(본문 그대로). */
export function useMakeupRow({
  activeDate,
  todayClasses,
  state: { reports, setStudents },
  i18n: { t, tf },
  askSendClass,
  rows: { patch, readonlyBlocked },
  withMark,
}: {
  activeDate: string;
  todayClasses: TodayClass[];
  state: { reports: ReportsState; setStudents: Dispatch<SetStateAction<OneScreenStudent[]>> };
  i18n: MakeupI18n;
  askSendClass: (ask: Omit<SendClassAsk, "resolve">) => Promise<string | null>;
  rows: { patch: PatchStudent; readonlyBlocked: () => boolean };
  withMark: MakeupAttendanceDeps["withMark"];
}) {
  /**
   * **보강 반 고르기·바꾸기**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 후보 = 이 학생이 다니는 같은 과목 반(확인창과 같은 목록·같은 함수).
   * 고르면 서버 [`setMakeupClass`]가 보고서의 보강 반·보낼 반과 출석부 칸을 **함께** 옮긴다(보고서 전이면 명단 세션의 보강 반만).
   * 이미 발송된 보강은 서버가 거절한다(회수가 옛 반 기록으로 글을 찾는다).
   */
  async function pickMakeupClass(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const su = student.subjects.find((x) => x.name === subjectName);
    const subjectKey = su?.subjectKey || null;
    if (!su || !su.makeup || su.classId || !subjectKey) return;
    const res = await fetchMakeupHostClasses(student.id, activeDate, [subjectKey]).catch(() => ({ options: [], failed: true }));
    if (res.failed) {
      toast.error(t("os.c.sendClassCheckFail"));
      return;
    }
    const regular = student.subjects.filter((x) => !x.makeup && x.classId).map((x) => x.classId!);
    const options = hostChoicesFor(res.options, regular).filter((o) => o.subject === subjectKey);
    if (!options.length) {
      toast.error(t("os.makeupClass.noChoice"));
      return;
    }
    const picked = await askSendClass({
      studentName: student.name,
      candidates: options.map((o) => ({ id: o.classId, name: o.className })),
      defaultId: su.makeupClassId ?? null,
      makeupClassName: null,
      pickOnly: true,
    });
    if (!picked || picked === su.makeupClassId) return;
    const r = await setMakeupClass({ studentId: student.id, date: activeDate, subject: subjectKey, classId: picked });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    patch(student.id, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === subjectName ? { ...x, makeupClassId: picked, makeupClassName: r.className } : x)),
    }));
    toast.success(tf("os.makeupClass.changed", { name: r.className }));
  }
  /**
   * 보강 빼기 — '+ 보강 학생 추가'의 반대(원장 2026-08-18 *"다 삭제"*). 출결 보강 칸과 저장된 보강
   * 보고서를 함께 지운다(서버 [`removeMakeupEntry`]). 되살아나는 원천이 둘이라 한쪽만 지우면
   * 새로고침에 그대로 돌아온다.
   * ⚠️ 학부모에게 나간 보고서는 **회수 요청만** 걸린다(게시글을 지울 열쇠가 그 행에 있다) — 그때는
   *    화면에서도 행을 지우지 않는다(`keepRow`). 안 그러면 "지웠는데 새로고침하면 있다"가 된다.
   */
  async function removeMakeupRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!su) return;
    // 🔴 **발송된 보강은 애초에 못 뺀다**(원장 2026-08-18 *"발송된건은 보강취소를 못하게 강제해"*).
    //    서버도 같은 판정으로 막지만 여기서 먼저 이유를 말한다 — 확인창을 띄웠다가 실패하면 더 나쁘다.
    const rep = reports[student.id]?.[subjectName];
    const blocked = makeupRemoveBlockReason(rep?.classnoteStatus ?? null);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    // 🔴 앵커가 이 학생의 **정규 반**이면 출결은 지우지 않는다(classId null) — 합칠 후보가 있던 '분리' 보강은 시수를 그 정규 칸에
    //    얹었고 보강 칸을 따로 만들지 않았다. 넘기면 누가 그 정규 칸을 '보강'으로 바꿔 둔 경우 정규 칸이 통째로 지워진다(적대 리뷰 2026-09-21).
    const anchorIsRegular = !!su.makeupClassId && student.subjects.some((x) => !x.makeup && x.classId === su.makeupClassId);
    // 경고는 **무엇이 사라지는지 그대로** 적는다(원장 *"경고하고 확인하면 삭제"*) — 정규 반 앵커면 출결은 안 지우고 남는 것을 밝힌다.
    const lines = [
      tf("os.c.removeMakeupTitle", { name: student.name }),
      "",
      anchorIsRegular
        ? tf("os.c.removeMakeupRegularLine", { cls: todayClasses.find((c) => c.id === su.makeupClassId)?.name ?? su.name })
        : t("os.c.removeMakeupLine1"),
      t("os.c.removeMakeupLine2"),
    ];
    if (!window.confirm(lines.join("\n"))) return;
    const res = await removeMakeupEntry({
      studentId: student.id,
      date: activeDate,
      classId: anchorIsRegular ? null : su.makeupClassId ?? null,
      subject: su.subjectKey ?? null,
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // 확인했으면 **화면에서도 없앤다**(원장 *"아무것도 추가 안한것처럼 이전으로"*) — 지울 수 있는 행만
    // 여기까지 오므로 DB에도 남는 게 없다. 남은 행이 없으면 카드째 목록에서 제거(보강만 있던 학생).
    setStudents((prev) =>
      prev
        .map((s) =>
          s.id === student.id
            ? withMark({
                ...s,
                subjects: s.subjects.filter((x) => x.name !== subjectName),
                // 지운 보강 칸이 배지 재료(`attendanceOffRow`)에 남아 있으면 없는 기록이 배지에 계속 선다.
                ...(!anchorIsRegular && su.makeupClassId && s.attendanceOffRow && su.makeupClassId in s.attendanceOffRow
                  ? {
                      attendanceOffRow: Object.fromEntries(
                        Object.entries(s.attendanceOffRow).filter(([cid]) => cid !== su.makeupClassId),
                      ),
                    }
                  : {}),
              })
            : s,
        )
        .filter((s) => !(s.id === student.id && s.subjects.length === 0)),
    );
    toast.success(res.message);
  }
  return { pickMakeupClass, removeMakeupRow };
}
