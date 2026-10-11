import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shared shadcn card gives project panels consistent headings and spacing.
export function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle><h2>{title}</h2></CardTitle>
        {hint && <CardDescription className="text-xs leading-5">{hint}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}
