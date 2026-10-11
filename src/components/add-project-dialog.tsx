"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Folder, FolderGit2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addProject, browseFolders, type Listing } from "@/app/actions";

// Folder picker over the server's REPO_ROOT. Click a folder to open it,
// "Add" on a git repo to register it.
export function AddProjectDialog() {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function load(dir?: string) {
    startTransition(async () => {
      const result = await browseFolders(dir);
      setError(result.error ?? null);
      if (result.data) {
        setListing(result.data);
      }
    });
  }

  function add(dir: string) {
    startTransition(async () => {
      const result = await addProject(dir);
      if (!result.data) {
        setError(result.error);
        return;
      }

      // Land on the new project: next step is starting a review.
      setOpen(false);
      router.push(`/projects/${result.data.id}`);
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      return;
    }

    setError(null);
    load(listing?.path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Add project
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>Open folders to find a repository, then click Add.</DialogDescription>
        </DialogHeader>

        <p className="flex items-center gap-2 truncate font-mono text-xs text-muted-foreground">
          {pending && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {listing?.path ?? "Loading…"}
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-80 overflow-y-auto rounded-lg border" aria-busy={pending}>
          {listing?.parent && (
            <FolderRow onOpen={() => load(listing.parent!)} icon={<ArrowUp />} name=".." />
          )}

          {listing?.folders.map((f) => (
            <FolderRow
              key={f.path}
              name={f.name}
              icon={f.isRepo ? <FolderGit2 className="text-primary" /> : <Folder />}
              onOpen={() => load(f.path)}
              onAdd={f.isRepo ? () => add(f.path) : undefined}
            />
          ))}

          {listing?.folders.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {listing.parent ? "No subfolders." : "Repos folder is empty. Check the volume mount."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type RowProps = {
  name: string;
  icon: React.ReactNode;
  onOpen: () => void;
  onAdd?: () => void;
};

function FolderRow({ name, icon, onOpen, onAdd }: RowProps) {
  return (
    <div className="flex items-center gap-2 border-b px-2 py-1 last:border-b-0 [&_svg]:size-4 [&_svg]:shrink-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-muted"
      >
        {icon}
        <span className="truncate">{name}</span>
      </button>

      {onAdd && (
        <Button size="xs" variant="outline" onClick={onAdd}>
          Add
        </Button>
      )}
    </div>
  );
}
