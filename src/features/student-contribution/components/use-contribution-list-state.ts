"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEmbed } from "@/components/workspace/embed-context";
import { listStateQuery, readListState, type ContributionListState } from "../model/list-state";
import { useStudentContributionScope } from "./student-contribution-scope";

export function useContributionListState() {
  const params = useSearchParams(), embed = useEmbed(), scope = useStudentContributionScope();
  const queryString = params.toString();
  const [state, setState] = useState(() => readListState(queryString));
  const [previousQuery, setPreviousQuery] = useState(queryString);
  // The shell may keep a mounted page when its frame or route changes.
  if (queryString !== previousQuery) { setPreviousQuery(queryString); setState(readListState(queryString)); }
  const update = (patch: Partial<ContributionListState>) => {
    const next = { ...state, ...patch };
    setState(next);
    const query = new URLSearchParams(listStateQuery(next));
    if (embed || params.get("embed") === "1") query.set("embed", "1");
    // Local filtering does not need an RSC request. The URL also restores browser-back navigation.
    const href = `/student-contribution${query.size ? `?${query}` : ""}`;
    window.history.replaceState(null, "", scope?.resolve(href) ?? href);
  };
  return [state, update] as const;
}
