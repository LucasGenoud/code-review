"use client";

import { useOptimistic, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CategoryDot } from "@/components/category-badge";
import { toggleCategory } from "@/app/rules/actions";
import type { LanguageUsage } from "@/app/actions";
import { Panel } from "./panel";

// Language rule packs: detected ones up front, the rest folded away.
export function LanguagesPanel({ projectId, languages }: { projectId: number; languages: LanguageUsage[] }) {
  const detected = languages.filter((l) => l.files > 0).sort((a, b) => b.files - a.files);
  const other = languages.filter((l) => l.files === 0);

  return (
    <Panel title="Languages" hint="Packs only apply to matching files, so each file gets its own language's rules.">
      {detected.length === 0 && <p className="text-sm text-muted-foreground">No supported language detected.</p>}

      <ul className="flex flex-col">
        {detected.map((l) => (
          <LanguageRow key={l.categoryId} projectId={projectId} language={l} />
        ))}
      </ul>

      {other.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
            Other languages ({other.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1 flex flex-col">
              {other.map((l) => (
                <LanguageRow key={l.categoryId} projectId={projectId} language={l} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Panel>
  );
}

// One pack with an instant on/off switch for this project.
function LanguageRow({ projectId, language }: { projectId: number; language: LanguageUsage }) {
  const [enabled, setEnabled] = useOptimistic(language.enabled);
  const [, startTransition] = useTransition();
  const id = `lang-${language.categoryId}`;

  function toggle(next: boolean) {
    startTransition(async () => {
      setEnabled(next);
      const result = await toggleCategory(projectId, language.categoryId, next);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <li className="flex items-center gap-2 py-1.5">
      <CategoryDot color={language.color} />
      <label htmlFor={id} className="flex-1 text-sm">
        {language.name}
      </label>
      {language.files > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {language.files} {language.files === 1 ? "file" : "files"}
        </span>
      )}
      <Switch id={id} size="sm" checked={enabled} onCheckedChange={toggle} />
    </li>
  );
}
