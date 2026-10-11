"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 3000;

// Re-renders server data every few seconds, e.g. while a review runs.
export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return null;
}
