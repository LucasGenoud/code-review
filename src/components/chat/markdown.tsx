"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";

// Chat answers as GitHub-flavored markdown: lists, tables, links,
// highlighted code with a copy button. References become buttons:
//
//   #12              → onCite(12), when 12 is a finding of the review
//   `src/app.ts:40`  → onOpenFile("src/app.ts", 40)
//   src/app.ts:40    → same, outside code (needs a "/" to tell it from host:port)

export type CiteProps = {
  // Finding ids that "#12" can jump to.
  findingIds: Set<number>;
  onCite: (id: number) => void;
  // Opens a cited file at a line; absent = citations stay plain text.
  onOpenFile?: (path: string, line: number) => void;
};

const COPIED_MS = 1500;

// Code spans and fences, left alone when linking references.
// e.g. "see `a.ts:3` and #4" → ["see ", "`a.ts:3`", " and #4"]
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/;
const FINDING_REF = /(^|[^\w&[/])#(\d+)\b/g;
const PLAIN_FILE_REF = /(^|[\s(])((?:[\w.-]+\/)+[\w.-]+\.\w{1,8}):(\d+)(?:-\d+)?\b/g;
// Whole inline code span, e.g. "src/app.ts:40" or "app.py:12-20".
const CODE_FILE_REF = /^([\w./-]+\.\w{1,8}):(\d+)(?:-\d+)?$/;
// Link targets for references, e.g. "#finding-12", "#file=src%2Fapp.ts&line=40".
const FINDING_HREF = /^#finding-(\d+)$/;
const FILE_HREF = /^#file=([^&]+)&line=(\d+)$/;
const LANGUAGE_CLASS = /^language-(.+)$/;

// Markdown's AST node, as react-markdown passes it to components.
type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: { className?: unknown } };

export function Markdown({ text, findingIds, onCite, onOpenFile }: { text: string } & CiteProps) {
  const components: Components = {
    pre: ({ node }) => <CodeBlock node={node as HastNode} />,
    code: ({ children, node }) => <InlineCode text={hastText(node as HastNode)} onOpenFile={onOpenFile}>{children}</InlineCode>,
    a: ({ href = "", children }) => <Link href={href} onCite={onCite} onOpenFile={onOpenFile}>{children}</Link>,
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b px-2 py-1 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
  };

  return (
    <div className="chat-markdown flex flex-col gap-2 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={components}>
        {linkRefs(text, findingIds, Boolean(onOpenFile))}
      </ReactMarkdown>
    </div>
  );
}

// Turns references outside code into links the `a` component handles.
function linkRefs(text: string, findingIds: Set<number>, files: boolean): string {
  return text
    .split(CODE)
    .map((segment) => {
      if (segment.startsWith("`")) {
        return segment;
      }

      const cited = segment.replace(FINDING_REF, (match, lead: string, id: string) =>
        findingIds.has(Number(id)) ? `${lead}[#${id}](#finding-${id})` : match,
      );
      if (!files) {
        return cited;
      }

      return cited.replace(PLAIN_FILE_REF, (_, lead: string, path: string, line: string) =>
        `${lead}[${path}:${line}](#file=${encodeURIComponent(path)}&line=${line})`,
      );
    })
    .join("");
}

type LinkProps = { href: string; children: React.ReactNode } & Pick<CiteProps, "onCite" | "onOpenFile">;

function Link({ href, children, onCite, onOpenFile }: LinkProps) {
  const finding = FINDING_HREF.exec(href);
  if (finding) {
    return <RefButton onClick={() => onCite(Number(finding[1]))}>{children}</RefButton>;
  }

  const file = FILE_HREF.exec(href);
  if (file && onOpenFile) {
    return <RefButton onClick={() => onOpenFile(decodeURIComponent(file[1]), Number(file[2]))}>{children}</RefButton>;
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 underline underline-offset-2 dark:text-blue-400">
      {children}
    </a>
  );
}

function RefButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded font-mono text-[0.9em] text-blue-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-blue-400"
    >
      {children}
    </button>
  );
}

type InlineProps = { text: string; children: React.ReactNode } & Pick<CiteProps, "onOpenFile">;

function InlineCode({ text, children, onOpenFile }: InlineProps) {
  const file = CODE_FILE_REF.exec(text);
  const classes = "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]";
  if (!file || !onOpenFile) {
    return <code className={classes}>{children}</code>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenFile(file[1], Number(file[2]))}
      title="Open file"
      className={cn(classes, "text-blue-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-blue-400")}
    >
      {children}
    </button>
  );
}

// Fenced code: language, copy button, highlighted lines.
function CodeBlock({ node }: { node: HastNode }) {
  const code = node.children?.find((c) => c.type === "element") ?? node;
  const classes = Array.isArray(code.properties?.className) ? (code.properties.className as string[]) : [];
  const language = classes.map((c) => LANGUAGE_CLASS.exec(c)?.[1]).find(Boolean) ?? "code";
  const text = hastText(code);

  return (
    <div className="overflow-hidden rounded-md border bg-muted/50">
      <div className="flex items-center justify-between border-b bg-muted/60 py-0.5 pr-1 pl-3">
        <span className="font-mono text-[11px] text-muted-foreground">{language}</span>
        <CopyButton text={text.replace(/\n$/, "")} label="Copy code" />
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed [overflow-wrap:normal]">
        <code className={classes.join(" ")}>{hastChildren(code)}</code>
      </pre>
    </div>
  );
}

function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }

  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(hastText).join("");
}

// Highlighted tokens as spans, e.g. <span class="hljs-keyword">const</span>.
function hastChildren(node: HastNode): React.ReactNode {
  return (node.children ?? []).map((child, i) => {
    if (child.type === "text") {
      return child.value;
    }

    const className = Array.isArray(child.properties?.className) ? (child.properties.className as string[]).join(" ") : undefined;
    return (
      <span key={i} className={className}>
        {hastChildren(child)}
      </span>
    );
  });
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Couldn't copy to the clipboard");
      return;
    }

    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
