"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server page whenever the SSE stream reports a new real state. */
export function LiveRefresh({ projectId, rendered }: { projectId: string; rendered: string }) {
  const router = useRouter();
  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/events`);
    es.onmessage = (e) => {
      if (e.data !== rendered) router.refresh(); // same field order as the SSE route
    };
    return () => es.close();
  }, [projectId, rendered, router]);
  return null;
}
