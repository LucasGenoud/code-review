"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = {
  // Accessible name of the trigger, e.g. "Delete review #3".
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  // Server action. A returned `error` is shown as a toast.
  onConfirm: () => Promise<{ error?: string } | void>;
  // Trigger content. Default: trash icon button.
  children?: React.ReactNode;
};

// Destructive action behind a confirm dialog. Stays open while pending.
export function ConfirmButton({ label, title, description, confirmLabel = "Delete", onConfirm, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result?.error) {
        toast.error(result.error);
        return;
      }

      setOpen(false);
    });
  }

  const trigger = children ? (
    <Button variant="ghost" size="sm" aria-label={label} className="text-muted-foreground" />
  ) : (
    <Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground hover:text-destructive" />
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger}>{children ?? <Trash2 />}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
