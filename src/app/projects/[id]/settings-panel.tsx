"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect, type ModelOption } from "@/components/settings/model-select";
import { saveProjectSettings, type Project } from "@/app/actions";
import { Panel } from "./panel";

// Per-project model and extra ignore globs.
export function SettingsPanel({ project, models }: { project: Project; models: ModelOption[] }) {
  const [modelId, setModelId] = useState(project.modelId);
  const [ignoreGlobs, setIgnoreGlobs] = useState(project.ignoreGlobs);
  const [pending, startTransition] = useTransition();

  const dirty = modelId !== project.modelId || ignoreGlobs !== project.ignoreGlobs;

  function save() {
    startTransition(async () => {
      const result = await saveProjectSettings(project.id, { description: project.description, ignoreGlobs, modelId });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Project settings saved");
    });
  }

  return (
    <Panel title="Settings">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-model">Model</Label>
        <ModelSelect id="project-model" models={models} value={modelId} onChange={setModelId} nullLabel="Default model" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-ignore">Extra ignored files</Label>
        <Textarea
          id="project-ignore"
          value={ignoreGlobs}
          onChange={(e) => setIgnoreGlobs(e.target.value)}
          placeholder={"**/generated/**\n**/*.pb.go"}
          className="min-h-20 font-mono text-xs md:text-xs"
        />
        <p className="text-xs text-muted-foreground">One glob per line, added to the global ignore list.</p>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </Panel>
  );
}
