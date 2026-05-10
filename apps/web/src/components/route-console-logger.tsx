"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export function RouteConsoleLogger() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousRoute = useRef<string | null>(null);
  const search = searchParams.toString();
  const currentRoute = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    const previous = previousRoute.current;

    console.info("[SAFA ROUTE] navigation", {
      from: previous,
      to: currentRoute,
      pathname,
      search: search || null,
      navigatedAt: new Date().toISOString()
    });

    previousRoute.current = currentRoute;
  }, [currentRoute, pathname, search]);

  return null;
}
