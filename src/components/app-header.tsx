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
    <header className="sticky top-0 z-40 border-b bg-card">
      <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" aria-label="PR Review" className="flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <GitPullRequestArrow className="size-5 text-primary" />
          <span className="hidden sm:inline">PR Review</span>
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
    <nav aria-label="Main navigation" className="flex items-center gap-1 text-sm">
      {NAV.map((item) => (
        <Button
          key={item.href}
          variant={pathname !== null && item.match(pathname) ? "secondary" : "ghost"}
          size="sm"
          role="link"
          nativeButton={false}
          render={<Link href={item.href} aria-current={pathname !== null && item.match(pathname) ? "page" : undefined} />}
          className={cn(
            "h-8 px-3",
            pathname !== null && item.match(pathname) ? "text-foreground ring-1 ring-border" : "text-muted-foreground",
          )}
        >
          {item.label}
        </Button>
      ))}
    </nav>
  );
}
