import Link from "next/link";
import type {
  MasterIssue,
  MasterPlan,
} from "@/features/timetable/import/master/types";

export function IssueRow({
  issue: i,
  source,
  checked,
  disabled,
  onCheck,
}: {
  issue: MasterIssue;
  source: MasterPlan["source"];
  checked: boolean;
  disabled: boolean;
  onCheck: (checked: boolean) => void;
}) {
  const gid =
    i.tab === source.teacherTab ? source.teacherGid : source.rosterGid;
  const href = i.tab
    ? `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${gid}${i.cell ? `&range=${encodeURIComponent(i.cell)}` : ""}`
    : null;
  return (
    <li className="border-line border-t py-3 first:border-t-0">
      <div className="flex gap-3">
        {i.severity === "confirm" ? (
          <input
            type="checkbox"
            aria-label={`${i.target} 확인`}
            checked={checked}
            disabled={disabled}
            onChange={(e) => onCheck(e.target.checked)}
            className="mt-1 size-4 shrink-0"
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-sm font-medium">{i.target}</p>
          <p className="mt-1 text-sm">{i.reason}</p>
          <p className="mt-1 text-sm text-text-dim">{i.fix}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-primary">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {i.tab}
                {i.cell ? ` · ${i.cell}` : ""} 열기
              </a>
            ) : null}
            {i.href ? (
              <Link
                href={i.href}
                target="_blank"
                prefetch={false}
                className="underline"
              >
                에이와에서 수정
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
