import { StudioView } from "@/components/studio-view";
import { workspaceProjects } from "@/lib/studio";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export default async function ProjectsPage() {
  const { workspace, role } = await requireWorkspace("viewer");
  return <StudioView projects={await workspaceProjects(workspace.id)} listOnly canEdit={role !== "viewer"} />;
}
