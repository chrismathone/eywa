import type { StaffTaskItem, StaffTaskList } from "@/features/staff-tasks/kinds";

export type CareTaskFilter = "open" | "closed";
export type CareTasks = { items: StaffTaskItem[]; total: number; canMonitor: boolean };
export const CARE_TASK_LIMIT = 30;

/** Each source chunk supplies its first 30; that is sufficient for the global first 30.
 * Total is the DB count, not the length of the visible rows. Source sets are disjoint. */
export function mergeCareTasks(lists: StaffTaskList[], filter: CareTaskFilter): Pick<CareTasks, "items" | "total"> {
  const items = lists.flatMap((list) => list.items).sort((a, b) => {
    if (filter === "open") {
      const date = (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity);
      return date || a.id.localeCompare(b.id);
    }
    return (b.closedAt ? Date.parse(b.closedAt) : -Infinity) - (a.closedAt ? Date.parse(a.closedAt) : -Infinity) || a.id.localeCompare(b.id);
  }).slice(0, CARE_TASK_LIMIT);
  return { items, total: lists.reduce((sum, list) => sum + list.total, 0) };
}
