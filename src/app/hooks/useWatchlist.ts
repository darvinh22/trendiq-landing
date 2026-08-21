import { useState, useCallback } from "react";

const STORAGE_KEY = "trendiq_watchlist";

function readStorage(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [watchedIds, setWatchedIds] = useState<string[]>(readStorage);

  const toggle = useCallback((id: string) => {
    setWatchedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isWatched = useCallback(
    (id: string) => watchedIds.includes(id),
    [watchedIds]
  );

  return { watchedIds, toggle, isWatched };
}
