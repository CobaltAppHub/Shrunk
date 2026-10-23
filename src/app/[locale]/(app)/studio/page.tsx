import { StudioView } from "@/components/studio-view";
import { workspaceProjects } from "@/lib/studio";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export default async function StudioPage() {
  const { workspace, role } = await requireWorkspace("viewer");
  return <StudioView projects={await workspaceProjects(workspace.id, 6)} canEdit={role !== "viewer"} />;
}
