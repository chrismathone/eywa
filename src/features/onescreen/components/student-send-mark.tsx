import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SendMark } from "../send-mark";

export function StudentSendMark({ mark }: { mark?: SendMark }) {
  const t = useSheetT();
  const tf = useSheetTf();
  if (!mark || mark.total <= 0) return null;
  const partial = mark.sent < mark.total;
  const saved = mark.delivery === false;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {mark.sent > 0 ? (
        <span
          title={tf("os.list.sendDetail", {
            label: mark.label,
            sent: mark.sent,
            total: mark.total,
          })}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-xs font-bold whitespace-nowrap ${saved ? "bg-primary-soft text-primary" : "bg-green-soft text-green"}`}
        >
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${saved ? "bg-primary" : "bg-green"}`}
          />
          {partial
            ? tf(saved ? "os.list.savedCount" : "os.list.sentCount", {
                sent: mark.sent,
                total: mark.total,
              })
            : t(saved ? "os.list.saved" : "os.list.sent")}
        </span>
      ) : null}
      {(mark.overdue ?? 0) > 0 ? (
        <span className="bg-danger-soft text-danger inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-xs font-bold whitespace-nowrap">
          <span aria-hidden className="bg-danger size-1.5 rounded-full" />
          {t("os.list.overdue")}
        </span>
      ) : null}
    </span>
  );
}
