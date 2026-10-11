import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ReportSkeleton } from "@/components/report/report-skeleton";
import { ReportView } from "@/components/report/report-view";
import { RunnerState } from "@/lib/sandbox";
import { getSandboxStatus } from "../../settings/actions";
import { getReport, loadChat } from "../actions";

// Review report page. Data loads inside Suspense: the skeleton shows at once.
export default function ReviewPage({ params }: PageProps<"/reviews/[id]">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <ReportLoader params={params} />
    </Suspense>
  );
}

async function ReportLoader({ params }: { params: PageProps<"/reviews/[id]">["params"] }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    notFound();
  }

  // getReport throws for an unknown review.
  const report = await getReport(id).catch(() => null);
  if (!report) {
    notFound();
  }

  const [chat, sandbox] = await Promise.all([loadChat(id), getSandboxStatus()]);
  const canVerify = sandbox.enabled && sandbox.state === RunnerState.Online;

  return <ReportView report={report} chat={chat} canVerify={canVerify} />;
}
