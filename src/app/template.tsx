import { ViewTransition } from "react";

// Remounts on every route change, so the page plays its enter animation.
// default="none": server action refreshes keep the page still.
export default function Template({ children }: LayoutProps<"/">) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      <div className="flex flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}
