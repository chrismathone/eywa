/** 묶음별 시안 등록표 — 순서는 `_data/bundles.ts`의 drafts 순서와 같다. */
import type { ComponentType } from "react";
import type { BundleId } from "../_data/bundles";
import { Desk1 } from "./desk-1";
import { Desk2 } from "./desk-2";
import { Desk3 } from "./desk-3";
import { Desk4 } from "./desk-4";
import { Desk5 } from "./desk-5";
import { Manager1 } from "./manager-1";
import { Manager2 } from "./manager-2";
import { Manager3 } from "./manager-3";
import { Manager4 } from "./manager-4";
import { Manager5 } from "./manager-5";
import { Owner1 } from "./owner-1";
import { Owner2 } from "./owner-2";
import { Owner3 } from "./owner-3";
import { Owner4 } from "./owner-4";
import { Owner5 } from "./owner-5";
import { Subject1 } from "./subject-1";
import { Subject2 } from "./subject-2";
import { Subject3 } from "./subject-3";
import { Subject4 } from "./subject-4";
import { Subject5 } from "./subject-5";
import type { DraftProps } from "./types";

export const DRAFTS: Record<BundleId, ComponentType<DraftProps>[]> = {
  owner: [Owner1, Owner2, Owner3, Owner4, Owner5],
  subjectAdmin: [Subject1, Subject2, Subject3, Subject4, Subject5],
  manager: [Manager1, Manager2, Manager3, Manager4, Manager5],
  desk: [Desk1, Desk2, Desk3, Desk4, Desk5],
};
