import { Resend } from "resend";
import { env } from "./env";

const resend = new Resend(env.RESEND_API_KEY);

// Transactional only. Templates are plain text on purpose; localized copy comes from next-intl.
export async function sendEmail(to: string, subject: string, text: string) {
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, text });
  if (error) throw new Error(`email_failed: ${error.message}`);
}
