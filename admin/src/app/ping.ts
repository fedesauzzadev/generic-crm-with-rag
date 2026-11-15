import { useQuery } from "@tanstack/react-query";

export interface PingResponse {
  ok: boolean;
  service: string;
  time: string;
}

// Healthcheck contra el server local (mismo origen via proxy de Vite).
export function usePing() {
  return useQuery({
    queryKey: ["ping"],
    queryFn: async (): Promise<PingResponse> => {
      const res = await fetch("/api/ping");
      if (!res.ok) throw new Error(`Ping failed with status ${res.status}`);
      return res.json();
    },
  });
}
