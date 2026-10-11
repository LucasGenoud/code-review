"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { GitPullRequestArrow, Moon, Sun } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/", label: "Projects", match: (p: string) => p === "/" || p.startsWith("/projects") || p.startsWith("/reviews") },
  { href: "/rules", label: "Rules", match: (p: string) => p.startsWith("/rules") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function AppHeader() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <GitPullRequestArrow className="size-4" />
          PR Review
        </Link>

        {/* Pathname is unknown while dynamic routes prerender: links show without the active state. */}
        <Suspense fallback={<NavLinks pathname={null} />}>
          <ActiveNav />
        </Suspense>

        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" />
          <Moon className="dark:hidden" />
        </Button>
      </div>
    </header>
  );
}

function ActiveNav() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground",
            pathname !== null && item.match(pathname) && "bg-muted font-medium text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
