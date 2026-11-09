"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Code, Download, Loader2, Maximize2, RotateCcw, Wrench, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "cn";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CopyButton } from "./markdown";

// A ```mermaid block of a chat answer, drawn as a diagram:
//
//   ┌ diagram ──────────── [Source] [Copy] [SVG] [Expand] ┐
//   │   A["startReview()  src/reviews.ts:120"] ──► B …    │  click a node
//   └──────────────────────────────────────────────────────┘  naming path:line → file
//
// Mermaid loads on first use (it is large). While an answer streams, the
// source changes on every token: it is drawn once it has been still for
// SETTLE_MS. A source that doesn't parse shows the error, the source and
// a "Fix diagram" button that asks the model for a corrected version.

const SETTLE_MS = 400;
const ZOOM_STEP = 1.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const PERCENT = 100;
const SVG_TYPE = "image/svg+xml";
const LABEL_WIDTH = 320;
// "src/app.ts:40" inside a node's text, e.g. "startReview() src/reviews.ts:120".
const FILE_REF = /((?:[\w.-]+\/)*[\w.-]+\.\w{1,8}):(\d+)/;
// Elements of a rendered diagram that can carry a file reference.
const CLICKABLE = "g.node, g.actor, rect.actor, text.actor, text.messageText, g.classGroup, g.stateGroup";

enum Phase {
  Drawing = "drawing",
  Ready = "ready",
  Failed = "failed",
}

type Drawn = { phase: Phase.Drawing } | { phase: Phase.Ready; svg: string } | { phase: Phase.Failed; error: string };

type Props = {
  source: string;
  onOpenFile?: (path: string, line: number) => void;
  // Sends a chat message, e.g. to ask for a fixed diagram.
  onAsk?: (text: string) => void;
};

export function MermaidDiagram({ source, onOpenFile, onAsk }: Props) {
  const { resolvedTheme } = useTheme();
  const drawn = useDiagram(source.trim(), resolvedTheme === "dark");
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const failed = drawn.phase === Phase.Failed;
  const svg = drawn.phase === Phase.Ready ? drawn.svg : null;

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/60 py-0.5 pr-1 pl-3">
        <span className="mr-auto font-mono text-[11px] text-muted-foreground">diagram</span>
        <ToolbarButton label={showSource ? "Show diagram" : "Show source"} onClick={() => setShowSource((s) => !s)} disabled={failed}>
          <Code className="size-3" aria-hidden />
          {showSource ? "Diagram" : "Source"}
        </ToolbarButton>
        <CopyButton text={source} label="Copy diagram source" />
        {svg && (
          <>
            <ToolbarButton label="Download as SVG" onClick={() => download(svg)}>
              <Download className="size-3" aria-hidden />
              SVG
            </ToolbarButton>
            <ToolbarButton label="Expand diagram" onClick={() => setExpanded(true)}>
              <Maximize2 className="size-3" aria-hidden />
              Expand
            </ToolbarButton>
          </>
        )}
      </div>

      {failed && <DiagramError error={drawn.error} source={source} onAsk={onAsk} />}
      {!failed && showSource && <SourceView source={source} />}
      {!failed && !showSource && drawn.phase === Phase.Drawing && (
        <p className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Drawing diagram…
        </p>
      )}
      {svg && !showSource && (
        <button type="button" onClick={() => setExpanded(true)} className="block w-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="Expand diagram">
          <SvgView svg={svg} onOpenFile={onOpenFile} className="p-3" svgClassName="[&_svg]:mx-auto [&_svg]:max-h-[32rem]" />
        </button>
      )}

      {svg && <ExpandedDiagram svg={svg} open={expanded} onOpenChange={setExpanded} onOpenFile={onOpenFile} />}
    </div>
  );
}

// Renders `source` once it settles; re-renders when the theme changes.
function useDiagram(source: string, dark: boolean): Drawn {
  const id = `mermaid-${useId().replace(/[^\w-]/g, "")}`;
  const [drawn, setDrawn] = useState<Drawn>({ phase: Phase.Drawing });

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          // Mermaid sizes boxes by measuring text: it needs a real font, not "inherit".
          fontFamily: getComputedStyle(document.body).fontFamily,
          suppressErrorRendering: true,
          // Labels hold identifiers and paths: wrap them wider than Mermaid's 200px default.
          flowchart: { wrappingWidth: LABEL_WIDTH },
        });
        const { svg } = await mermaid.render(id, source);
        if (current) {
          setDrawn({ phase: Phase.Ready, svg });
        }
      } catch (e) {
        if (current) {
          setDrawn({ phase: Phase.Failed, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }, SETTLE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [id, source, dark]);

  return drawn;
}

// The diagram's SVG. Nodes naming path:line become links to the file.
// svgClassName: e.g. "[&_svg]:max-w-full" to fit the chat column.
type SvgProps = { svg: string; onOpenFile?: Props["onOpenFile"]; className?: string; svgClassName: string; zoom?: number };

function SvgView({ svg, onOpenFile, className, svgClassName, zoom = 1 }: SvgProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !onOpenFile) {
      return;
    }

    const cleanups: (() => void)[] = [];
    for (const el of root.querySelectorAll<SVGElement>(CLICKABLE)) {
      const cited = FILE_REF.exec(el.textContent ?? "");
      if (!cited) {
        continue;
      }

      const open = (event: Event) => {
        event.stopPropagation();
        onOpenFile(cited[1], Number(cited[2]));
      };
      el.style.cursor = "pointer";
      el.addEventListener("click", open);
      el.setAttribute("aria-label", `Open ${cited[1]}:${cited[2]}`);
      cleanups.push(() => el.removeEventListener("click", open));
    }

    return () => cleanups.forEach((c) => c());
  }, [svg, onOpenFile]);

  return (
    // The chat column breaks long words anywhere; labels must keep theirs.
    <div className={cn("flex justify-center overflow-auto [overflow-wrap:normal]", className)}>
      <div
        ref={ref}
        style={{ zoom }}
        className={cn("w-full [&_svg]:h-auto", svgClassName)}
        // Mermaid's own output, rendered with securityLevel "strict".
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

// Full-screen view: zoom with the buttons or ctrl+wheel, pan by scrolling.
function ExpandedDiagram({ svg, open, onOpenChange, onOpenFile }: { svg: string; open: boolean; onOpenChange: (open: boolean) => void; onOpenFile?: Props["onOpenFile"] }) {
  const [zoom, setZoom] = useState(1);
  const zoomBy = (factor: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));

  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col gap-2 sm:max-w-[calc(100vw-2rem)]">
        <div className="flex items-center gap-1 pr-10">
          <DialogTitle className="mr-auto text-sm">Diagram</DialogTitle>
          <ToolbarButton label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <ZoomOut className="size-3" aria-hidden />
          </ToolbarButton>
          <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">{Math.round(zoom * PERCENT)}%</span>
          <ToolbarButton label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <ZoomIn className="size-3" aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Reset zoom" onClick={() => setZoom(1)}>
            <RotateCcw className="size-3" aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Download as SVG" onClick={() => download(svg)}>
            <Download className="size-3" aria-hidden />
            SVG
          </ToolbarButton>
        </div>
        <div onWheel={onWheel} className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
          <SvgView svg={svg} zoom={zoom} onOpenFile={onOpenFile} className="min-h-full items-center p-6" svgClassName="[&_svg]:mx-auto" />
        </div>
        <p className="text-[11px] text-muted-foreground">Ctrl + scroll to zoom. Click a node naming a file to open it.</p>
      </DialogContent>
    </Dialog>
  );
}

function DiagramError({ error, source, onAsk }: { error: string; source: string; onAsk?: Props["onAsk"] }) {
  const reason = error.split("\n").slice(0, 4).join("\n");

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs ring-1 ring-amber-500/25 ring-inset">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium">Couldn&apos;t draw this diagram.</p>
          {/* Monospace: the parser's caret line points at a column. */}
          <pre className="overflow-x-auto font-mono text-[11px] leading-snug text-muted-foreground">{reason}</pre>
        </div>
        {onAsk && (
          <button
            type="button"
            onClick={() => onAsk(fixPrompt(reason))}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-0.5 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Wrench className="size-3" aria-hidden />
            Fix diagram
          </button>
        )}
      </div>
      <SourceView source={source} />
    </div>
  );
}

function SourceView({ source }: { source: string }) {
  return <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed [overflow-wrap:normal]">{source}</pre>;
}

function ToolbarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// Asks the model to redraw: the parser's message says what to change.
function fixPrompt(reason: string): string {
  return `The Mermaid diagram in your last answer doesn't render. Mermaid says:\n\n${reason}\n\nSend the corrected diagram only, following the diagram rules.`;
}

function download(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: SVG_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "diagram.svg";
  link.click();
  URL.revokeObjectURL(url);
}
