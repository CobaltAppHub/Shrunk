"use server";

import { z } from "zod";
import { cancelPost, reschedulePost, retryPost } from "@/lib/posts";
import { requireWorkspace } from "@/lib/workspace";

const actor = async () => {
  const { user, workspace } = await requireWorkspace("editor");
  return { userId: user.id, workspace };
};

export async function moveAction(postId: string, iso: string) {
  return reschedulePost(await actor(), postId, z.coerce.date().parse(iso));
}
export async function cancelAction(postId: string) {
  return cancelPost(await actor(), postId);
}
export async function retryAction(postId: string) {
  return retryPost(await actor(), postId);
}
