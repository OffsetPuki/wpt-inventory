import { z } from 'zod';
const address = z.string().trim().email();
export function mailAddressError(msg: { to: string; replyTo?: string }, bcc?: string | null): string | null {
  if (!address.safeParse(msg.to).success) return 'The recipient email address is invalid. Correct the contact and prepare a new message.';
  if (msg.replyTo && !address.safeParse(msg.replyTo).success) return 'The reply-to email address is invalid. Review email settings before preparing a new message.';
  if (bcc && !address.safeParse(bcc).success) return 'The archive email address is invalid. Review email settings before preparing a new message.';
  return null;
}
