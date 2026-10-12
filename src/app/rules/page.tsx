import { Suspense } from "react";
import { RulesEditor, RulesSkeleton } from "@/components/rules/rules-editor";
import { RulesTransfer } from "@/components/rules/rules-transfer";
import { RuleSets } from "@/components/rules/rule-sets";
import { globalRules, listRuleSets } from "./actions";

// Global rules: categories and rules every project starts from.
export default function RulesPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Global rules for every project. Switches set the default; a project can turn categories and rules on or off,
            or override a rule, from its own Rules page.
          </p>
        </div>
        <RulesTransfer />
      </header>

      <Suspense fallback={<RulesSkeleton />}>
        <GlobalRules />
      </Suspense>
    </main>
  );
}

async function GlobalRules() {
  const [categories, sets] = await Promise.all([globalRules(), listRuleSets()]);
  return (
    <>
      <RuleSets sets={sets} categories={categories} />
      <RulesEditor categories={categories} projectId={null} />
    </>
  );
}
