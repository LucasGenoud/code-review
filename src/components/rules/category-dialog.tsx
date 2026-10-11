"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { categoryClasses } from "@/lib/colors";
import { CATEGORY_COLORS, isBuiltIn, type CategoryColor } from "@/lib/domain";
import { createCategory, editCategory, type CategoryInput, type CategoryView } from "@/app/rules/actions";

type Props = {
  // Edit this category; absent = create.
  category?: CategoryView;
  // Create: owner project, null = global.
  projectId: number | null;
  // Trigger element, e.g. <Button />.
  trigger: React.ReactElement;
  children: React.ReactNode;
};

const DEFAULT_COLOR: CategoryColor = "blue";

// Create or edit a category: name, color, description, file globs.
// Built-in categories keep their name.
export function CategoryDialog({ category, projectId, trigger, children }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CategoryInput>(initial(category));
  const [pending, startTransition] = useTransition();
  const builtIn = category ? isBuiltIn(category.kind) : false;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(initial(category));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = category ? await editCategory(category.id, form) : await createCategory(projectId, form);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setOpen(false);
      toast.success(category ? "Category saved" : `Created ${form.name}`);
    });
  }

  const set = (patch: Partial<CategoryInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{category ? `Edit ${category.name}` : "New category"}</DialogTitle>
            <DialogDescription>
              {projectId === null || category ? "A group of rules reviewed together." : "Rules that apply to this project only."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              disabled={builtIn}
              required
              autoFocus={!builtIn}
              placeholder="e.g. Security"
            />
            {builtIn && <p className="text-xs text-muted-foreground">Built-in category: name is fixed.</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="cat-color">Color</Label>
            <div role="radiogroup" aria-labelledby="cat-color" className="flex flex-wrap gap-1.5">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={form.color === c}
                  aria-label={c}
                  onClick={() => set({ color: c })}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-white outline-none ring-offset-2 ring-offset-popover focus-visible:ring-2 focus-visible:ring-ring",
                    categoryClasses(c).dot,
                    form.color === c && "ring-2 ring-foreground/60",
                  )}
                >
                  {form.color === c && <Check className="size-3.5" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-description">Description</Label>
            <Textarea
              id="cat-description"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What these rules check, for the model."
              className="min-h-16"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-globs">Files</Label>
            <Textarea
              id="cat-globs"
              value={form.globs}
              onChange={(e) => set({ globs: e.target.value })}
              placeholder={"**/*.py\n**/*.pyi"}
              className="min-h-16 font-mono text-xs md:text-xs"
            />
            <p className="text-xs text-muted-foreground">One glob per line, e.g. <code className="font-mono">**/*.py</code>. Empty = all files.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {category ? "Save" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function initial(category?: CategoryView): CategoryInput {
  if (!category) {
    return { name: "", color: DEFAULT_COLOR, description: "", globs: "" };
  }

  return {
    name: category.name,
    color: category.color as CategoryColor,
    description: category.description,
    globs: category.globs,
  };
}
