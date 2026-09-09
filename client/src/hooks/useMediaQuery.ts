import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query from JavaScript.
 *
 * Hiding one of two layouts with `sm:hidden` is enough when both are static,
 * but the device list is not: the hidden copy still mounts, still runs its
 * hooks, and an expanded row would fetch its chart series twice. Choosing the
 * layout here means only one of them exists at a time.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);

    // The query can have changed between the first render and this effect.
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
