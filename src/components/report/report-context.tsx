"use client";

import { createContext, use } from "react";
import type { Finding } from "@/app/reviews/actions";
import type { Category } from "./report-lib";

// Shared report state and finding actions for deeply nested pieces, e.g.
// finding cards rendered inside the diff viewer.

type ReportState = {
  categories: Map<number, Category>;
  // Rule id → rule text, from the review's rules snapshot.
  rules: Map<number, string>;
  selectedId: number | null;
  // Finding to highlight briefly after a jump.
  flashId: number | null;
  // Findings with a mutation in flight.
  busy: number[];
  // Finding whose dismiss popover is open (opened by click or the "d" key).
  dismissingId: number | null;
  setDismissingId: (id: number | null) => void;
  apply: (id: number) => void;
  undo: (id: number) => void;
  undoableFixes: number[];
  dismiss: (id: number, reason: string) => void;
  reopen: (id: number) => void;
  ask: (finding: Finding) => void;
  // Sandbox runner usable: bug findings can be verified by running code.
  canVerify: boolean;
  verify: (finding: Finding) => void;
  select: (id: number) => void;
};

export const ReportContext = createContext<ReportState | null>(null);

export function useReport(): ReportState {
  const ctx = use(ReportContext);
  if (!ctx) {
    throw new Error("useReport outside ReportContext");
  }

  return ctx;
}
