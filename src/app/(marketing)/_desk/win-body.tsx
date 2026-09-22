"use client";

import { memo } from "react";
import type { WinType } from "./rooms";
import { BriefWin, MeetWin, StaffWin } from "./win-office";
import { AttWin, ClassesWin, TtWin } from "./win-class";
import { OsWin, SheetWin } from "./win-english";
import { ConsWin, EnrollWin, StudentsWin, StuWin } from "./win-desk";
import { BillingWin, BusWin, HelpWin, WdWin } from "./win-misc";

/** 창 종류 → 내용. memo라 창을 끄는 동안(좌표만 바뀔 때) 내용은 다시 그려지지 않는다. */
export const WinBody = memo(function WinBody({ type, arg }: { type: WinType; arg: string | null }) {
  switch (type) {
    case "brief": return <BriefWin />;
    case "staff": return <StaffWin />;
    case "meet": return <MeetWin />;
    case "att": return <AttWin arg={arg} />;
    case "tt": return <TtWin />;
    case "classes": return <ClassesWin />;
    case "os": return <OsWin />;
    case "sheet": return <SheetWin />;
    case "enroll": return <EnrollWin />;
    case "students": return <StudentsWin />;
    case "stu": return <StuWin arg={arg} />;
    case "cons": return <ConsWin />;
    case "billing": return <BillingWin />;
    case "wd": return <WdWin />;
    case "bus": return <BusWin />;
    case "help": return <HelpWin />;
  }
});
