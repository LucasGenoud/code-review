"use client";

import { useRef, useTransition } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { importRules } from "@/app/rules/actions";

// Export the global rules to a JSON file, or merge one in.
//   [Export] [Import]  → toast "Added 1 category and 4 rules, 2 already present"
export function RulesTransfer() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }

    startTransition(async () => {
      const result = await importRules(await file.text());
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      const { categories, rules, skipped } = result.data;
      toast.success(
        `Added ${plural(categories, "category", "categories")} and ${plural(rules, "rule", "rules")}` +
          (skipped > 0 ? `, ${skipped} already present` : ""),
      );
    });
  }

  return (
    <div className="flex shrink-0 gap-2">
      <a href="/api/rules/export" download className={buttonVariants({ variant: "outline" })}>
        <Download />
        Export
      </a>
      <Button variant="outline" onClick={() => input.current?.click()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Upload />}
        Import
      </Button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
