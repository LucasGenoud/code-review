"use client";

import { useMemo, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen, Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Checkbox tree of files: pick files and whole folders. Folders with a single
// subfolder are merged ("src/server"), a folder's box is mixed when only
// some of its files are picked, and the filter narrows to matching paths.
//
//   [Filter files        ]  [All] [None]          3 of 40 files
//   ▾ ◩ src/server                                         3/8
//       ▸ ☑ drivers                                        3/3
//         ☐ config.ts
//     ☐ README.md                                            M

export type TreeFile = {
  path: string;
  // Short tag shown at the right, e.g. "M" for a modified file.
  tag?: string;
  tagLabel?: string;
};

export enum Expand {
  // Changed files: few, show them all.
  All,
  // Whole repository: start from the top level.
  TopLevel,
}

type Node = {
  name: string;
  // "" for the root.
  path: string;
  file: TreeFile | null;
  children: Node[];
  // Every file path under this node; [path] for a file.
  files: string[];
};

type Props = {
  files: TreeFile[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  expand: Expand;
  label: string;
};

export function FileTree({ files, selected, onChange, expand, label }: Props) {
  const [filter, setFilter] = useState("");
  const [toggled, setToggled] = useState(() => new Set<string>());

  const query = filter.trim().toLowerCase();
  const shown = useMemo(
    () => buildTree(query ? files.filter((f) => f.path.toLowerCase().includes(query)) : files),
    [files, query],
  );

  // Folders start expanded or collapsed per `expand`; a click flips one.
  // While filtering, every folder is open so matches show.
  function isOpen(path: string): boolean {
    if (query) {
      return true;
    }

    return (expand === Expand.All) !== toggled.has(path);
  }

  function flip(path: string) {
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) {
        next.add(path);
      }

      return next;
    });
  }

  function pick(paths: string[], on: boolean) {
    const next = new Set(selected);
    for (const p of paths) {
      if (on) {
        next.add(p);
        continue;
      }

      next.delete(p);
    }

    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files, e.g. src/api"
            aria-label={`Filter ${label}`}
            className="h-7 pl-8 text-xs"
          />
        </div>
        <Button type="button" size="xs" variant="outline" onClick={() => pick(shown.files, true)}>
          {query ? "Pick matches" : "All"}
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={() => pick(shown.files, false)}>
          {query ? "Drop matches" : "None"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {selected.size} of {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>

      <ul aria-label={label} className="max-h-72 overflow-y-auto rounded-lg border py-1 text-xs">
        {shown.children.length === 0 && <li className="px-3 py-2 text-muted-foreground">No files match.</li>}
        {shown.children.map((n) => (
          <TreeRow key={n.path} node={n} depth={0} selected={selected} isOpen={isOpen} onFlip={flip} onPick={pick} />
        ))}
      </ul>
    </div>
  );
}

type RowProps = {
  node: Node;
  depth: number;
  selected: Set<string>;
  isOpen: (path: string) => boolean;
  onFlip: (path: string) => void;
  onPick: (paths: string[], on: boolean) => void;
};

// Indent per depth level, in rem.
const INDENT_REM = 1;

function TreeRow({ node, depth, selected, isOpen, onFlip, onPick }: RowProps) {
  const count = node.files.filter((f) => selected.has(f)).length;
  const all = count === node.files.length;
  const open = node.file === null && isOpen(node.path);

  return (
    <li>
      <div
        className="flex items-center gap-1.5 py-0.5 pr-3 hover:bg-muted/50"
        style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem` }}
      >
        {node.file ? (
          <span className="size-4 shrink-0" aria-hidden />
        ) : (
          <button
            type="button"
            onClick={() => onFlip(node.path)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.path}`}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        )}

        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            className="size-3.5 shrink-0 accent-primary"
            checked={all}
            ref={(el) => {
              if (el) {
                el.indeterminate = count > 0 && !all;
              }
            }}
            onChange={() => onPick(node.files, !all)}
          />
          <NodeIcon node={node} open={open} />
          <span className={cn("min-w-0 truncate font-mono", node.file === null && "font-medium")} title={node.path}>
            {node.name}
          </span>
        </label>

        {node.file === null && (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {count}/{node.files.length}
          </span>
        )}
        {node.file?.tag && (
          <span className="w-3 shrink-0 text-center text-muted-foreground uppercase" title={node.file.tagLabel}>
            {node.file.tag}
          </span>
        )}
      </div>

      {open && (
        <ul>
          {node.children.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} selected={selected} isOpen={isOpen} onFlip={onFlip} onPick={onPick} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeIcon({ node, open }: { node: Node; open: boolean }) {
  if (node.file) {
    return <File className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }

  const Icon = open ? FolderOpen : Folder;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

// Nested nodes from flat paths: folders first, then files, each by name.
//   ["src/a.ts", "src/lib/b.ts", "README.md"] → src/ (lib/ (b.ts), a.ts), README.md
function buildTree(files: TreeFile[]): Node {
  const root: Node = { name: "", path: "", file: null, children: [], files: [] };
  const folders = new Map<string, Node>([["", root]]);

  for (const f of files) {
    const parts = f.path.split("/");
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = { name: parts[i], path, file: null, children: [], files: [] };
        folders.set(path, folder);
        parent.children.push(folder);
      }

      parent = folder;
    }

    parent.children.push({ name: parts.at(-1) ?? f.path, path: f.path, file: f, children: [], files: [f.path] });
  }

  return finish(root);
}

// Sorts, fills `files`, and merges single-subfolder chains: a/ → b/ → x.ts
// shows as "a/b" → x.ts.
function finish(node: Node): Node {
  if (node.file) {
    return node;
  }

  node.children = node.children.map(finish).sort((a, b) => Number(a.file !== null) - Number(b.file !== null) || a.name.localeCompare(b.name));
  node.files = node.children.flatMap((c) => c.files);

  const only = node.children[0];
  if (node.path && node.children.length === 1 && only.file === null) {
    return { ...only, name: `${node.name}/${only.name}` };
  }

  return node;
}

// Shortest path list covering the picked files: a fully picked folder is
// sent as the folder, e.g. ["src/server", "README.md"].
export function compactPaths(files: TreeFile[], selected: Set<string>): string[] {
  function walk(node: Node): string[] {
    if (node.file) {
      return selected.has(node.path) ? [node.path] : [];
    }

    if (node.path && node.files.every((f) => selected.has(f))) {
      return [node.path];
    }

    return node.children.flatMap(walk);
  }

  return walk(buildTree(files));
}
