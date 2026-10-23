import { AppShell } from "@/components/app-shell";
import { getBalance } from "@/lib/credits";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await requireWorkspace("viewer");
  const balance = await getBalance((await import("@/db")).db, workspace.id);
  return <AppShell workspaceName={workspace.name} plan={workspace.plan} balance={balance}>{children}</AppShell>;
}
