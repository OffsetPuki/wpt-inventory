import { apiRequest } from './queryClient';
import type { LeadReplyPhoto } from '@shared/lead-reply';

export type ReplyPhotoSheet = { blob: Blob; url: string; filename: string; labels: string };

// Four photos per sheet keep uploads convenient without creating a huge image
// on phones. Originals remain available when the customer supplied fine detail.
export async function prepareReplyPhotos(leadId: number, photos: LeadReplyPhoto[], signal: AbortSignal) {
  const sheets: ReplyPhotoSheet[] = [];
  const missing: string[] = [];
  try {
    for (let start = 0; start < photos.length; start += 4) {
      signal.throwIfAborted();
      const group = photos.slice(start, start + 4);
      const canvas = document.createElement('canvas');
      canvas.width = group.length === 1 ? 1200 : 2400;
      canvas.height = Math.ceil(group.length / 2) * 1280;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Photo preparation is unavailable in this browser. Download the originals below.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const [index, photo] of group.entries()) {
        signal.throwIfAborted();
        const x = (index % 2) * 1200, y = Math.floor(index / 2) * 1280;
        ctx.fillStyle = '#111'; ctx.font = '32px sans-serif';
        ctx.fillText(`Lead ${leadId} — ${photo.label}`, x + 24, y + 44);
        let imageUrl: string | undefined;
        try {
          // Only authenticated, same-origin uploads; never send auth to a URL
          // supplied by customer text or metadata.
          if (!/^\/uploads\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(photo.url)) throw new Error('Unsupported photo');
          const response = await apiRequest('GET', photo.url, undefined, { signal });
          const blob = await response.blob();
          if (!/^image\/(png|jpeg|webp)$/i.test(blob.type) || blob.size > 20 * 1024 * 1024) throw new Error('Unsupported photo');
          imageUrl = URL.createObjectURL(blob);
          const img = new Image(); img.src = imageUrl;
          await img.decode(); signal.throwIfAborted();
          const scale = Math.min(1152 / img.naturalWidth, 1180 / img.naturalHeight, 1);
          const width = img.naturalWidth * scale, height = img.naturalHeight * scale;
          ctx.drawImage(img, x + (1200 - width) / 2, y + 76 + (1180 - height) / 2, width, height);
        } catch (error) {
          if (signal.aborted) throw error;
          missing.push(photo.label);
          ctx.fillText(`${photo.label} could not load`, x + 24, y + 160);
        } finally { if (imageUrl) URL.revokeObjectURL(imageUrl); }
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare photo sheet.')), 'image/png'));
      signal.throwIfAborted();
      sheets.push({ blob, url: URL.createObjectURL(blob), filename: `lead-${leadId}-photos-${sheets.length + 1}.png`, labels: group.map(p => p.label).join(', ') });
      canvas.width = 0; canvas.height = 0;
    }
    return { sheets, missing };
  } catch (error) {
    sheets.forEach(sheet => URL.revokeObjectURL(sheet.url));
    throw error;
  }
}
