export type LeadReplyPhoto = { url: string; label: string; filename: string };
export type LeadReplyPacket = {
  leadId: number;
  prompt: string;
  photos: LeadReplyPhoto[];
  warnings: string[];
};
