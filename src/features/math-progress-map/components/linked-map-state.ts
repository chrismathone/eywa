"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { daysInMonth, weeksOfMonth, ymd } from "../calendar";
import { monthPosition, periodAt } from "../continuous-timeline";
import { buildYearView } from "../derive";
import { focusOfDate } from "../focus";
import { mapPeriod, readMapSelection, type LearningMap, type MapSelection } from "../learning-map";
import { courseStartDate } from "../course-start";
import type { MapDisplay, StudentProgress } from "../model";
import { planVsActual } from "../pace";
import { progressForYear } from "../years";
import type { ProgressMapState } from "./map-state";

type Selection = MapSelection & { display: MapDisplay; revision: number };
function read(params: URLSearchParams, map: LearningMap, start: string | null): Selection {
  const display = params.get("display");
  const selection = readMapSelection(params, map);
  if (start && selection.date < start && map.years.includes(Number(start.slice(0, 4)))) selection.date = start;
  return { ...selection, display: display === "full" || display === "continuous" ? display : "drill", revision: 0 };
}

/** One selection for rings, timeline, rails, roadmap and browser history. Exploration never changes the report reference date. */
export function useLinkedMapState(sourceProgress: StudentProgress, map: LearningMap, initialQuery: string) {
  const start = courseStartDate(sourceProgress);
  const [selection, setSelection] = useState(() => read(new URLSearchParams(initialQuery), map, start));
  const latest = useRef(selection);
  const select = useCallback((patch: Partial<Selection>, scroll = false) => {
    const previous = latest.current;
    const next = { ...previous, lesson: null, undated: false, ...patch, revision: previous.revision + (scroll ? 0 : 1) };
    if (!map.years.includes(Number(next.date.slice(0, 4)))) return;
    if (start && next.date < start) {
      if (mapPeriod(next).to < start) return;
      next.date = start;
    }
    if (next.date === previous.date && next.mode === previous.mode && next.display === previous.display && next.lesson === previous.lesson && next.undated === previous.undated) return;
    const url = new URL(window.location.href);
    url.searchParams.set("date", next.date); url.searchParams.set("view", next.mode); url.searchParams.set("display", next.display);
    const topic = map.lessons.find(lesson => lesson.position === next.lesson);
    if (topic) url.searchParams.set("topic", `${topic.grade}:${topic.lesson}`); else url.searchParams.delete("topic");
    url.searchParams.delete("lesson");
    if (next.undated) url.searchParams.set("undated", "1"); else url.searchParams.delete("undated");
    // Preserve Next's navigation state; scrolling replaces the current location instead of filling history.
    window.history[scroll ? "replaceState" : "pushState"](window.history.state, "", url);
    latest.current = next; setSelection(next);
  }, [map, start]);
  useEffect(() => {
    const back = () => {
      const next = { ...read(new URLSearchParams(window.location.search), map, start), revision: latest.current.revision + 1 };
      latest.current = next; setSelection(next);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [map, start]);
  const year = Number(selection.date.slice(0, 4));
  const progress = useMemo(() => progressForYear(sourceProgress, year), [sourceProgress, year]);
  const view = useMemo(() => buildYearView(progress), [progress]);
  const currentView = useMemo(() => buildYearView(sourceProgress), [sourceProgress]);
  const pace = useMemo(() => planVsActual(sourceProgress), [sourceProgress]);
  const state = useMemo<ProgressMapState>(() => {
    const focus = focusOfDate(selection.date, year);
    const selectPeriod = (year: number, month: number) => { if (month >= 1 && month <= 12) select({ date: ymd(year, month, 1), mode: "month" }); };
    const position = (value: number, scroll = false) => {
      const period = periodAt(value);
      select({ date: ymd(period.year, period.month, 1), mode: scroll && ["year", "quarter"].includes(latest.current.mode) ? latest.current.mode : "month" }, scroll);
    };
    return { progress, sourceProgress, view, currentView, pace, years: map.years,
      mode: selection.mode, display: selection.display, focus, selectionRevision: selection.revision,
      currentProgressPosition: monthPosition(year, focus.month),
      setDisplay: display => select({ display, lesson: latest.current.lesson, undated: latest.current.undated }),
      setMode: mode => select({ mode, lesson: latest.current.lesson, undated: latest.current.undated }),
      selectYear: nextYear => select({ date: ymd(nextYear, focus.month, Math.min(Number(selection.date.slice(8)), daysInMonth(nextYear, focus.month))), mode: "year" }),
      selectPeriod, selectMonth: month => selectPeriod(year, month),
      selectQuarter: q => select({ date: Math.ceil(focus.month / 3) === q ? selection.date : ymd(year, (q - 1) * 3 + 1, 1), mode: "quarter" }),
      selectWeek: (month, week, nextYear = year) => {
        const selected = weeksOfMonth(nextYear, month).find(item => item.index === week);
        if (selected) select({ date: selected.start, mode: "week" });
      },
      selectDay: date => select({ date, mode: "day" }), resetFocus: () => select({ date: map.referenceDate }),
      setViewedPosition: value => position(value), syncScrolledPosition: value => position(value, true) };
  }, [progress, sourceProgress, view, currentView, pace, map, selection, year, select]);
  return { selection, select, state };
}
