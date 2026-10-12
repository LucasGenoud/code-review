"use client";

import { useRef } from "react";
import { cn } from "cn";

// Draggable vertical edge that sets a side panel's width. Arrow keys
// resize by KEY_STEP_PX when focused.
//
//   files ┃ diff ┃ findings
//         ↔      ↔

const KEY_STEP_PX = 16;

// Which way the panel grows when the pointer moves right.
export enum Grow {
  Right = 1,
  Left = -1,
}

type Props = {
  label: string;
  width: number;
  min: number;
  max: number;
  grow: Grow;
  onWidth: (width: number) => void;
  className?: string;
  style?: React.CSSProperties;
};

export function ResizeHandle({ label, width, min, max, grow, onWidth, className, style }: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (w: number) => Math.min(max, Math.max(min, w));

  function onKeyDown(e: React.KeyboardEvent) {
    const step = { ArrowRight: KEY_STEP_PX, ArrowLeft: -KEY_STEP_PX }[e.key];
    if (!step) {
      return;
    }

    e.preventDefault();
    onWidth(clamp(width + step * grow));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        if (!drag.current) {
          return;
        }

        onWidth(clamp(drag.current.width + (e.clientX - drag.current.x) * grow));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      style={style}
      className={cn(
        "absolute inset-y-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize touch-none outline-none select-none hover:bg-ring/40 focus-visible:bg-ring/60 active:bg-ring/60",
        className,
      )}
    />
  );
}
