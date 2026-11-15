import { useEffect, useState } from "react";

/** Debounce de la búsqueda: no golpea la API en cada tecla. */
export function useDebounced(value: string, delayMs = 400): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
