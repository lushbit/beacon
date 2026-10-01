import { useEffect, useRef, useState } from "react";

/** The width and height of an element, kept current as it is resized. */
export function useBoxSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number, height: number) =>
      setSize((current) =>
        current.width === Math.round(width) && current.height === Math.round(height)
          ? current
          : { width: Math.round(width), height: Math.round(height) }
      );
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
