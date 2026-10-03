import { useState } from 'react';
import { Download, ImageOff, ExternalLink } from 'lucide-react';

export function leadPhotos(value: unknown): string[] {
  try {
    const urls = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(urls) ? urls.filter((url): url is string =>
      typeof url === 'string' && /^\/uploads\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url)) : [];
  } catch { return []; }
}

function Photo({ url, index, leadId }: { url: string; index: number; leadId: number }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <figure className="overflow-hidden rounded-xl border border-border bg-background">
    {failed ? <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 p-3 text-sm text-muted-foreground" role="status">
      <ImageOff aria-hidden className="h-6 w-6" />Photo could not load.
      <button type="button" className="underline" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>Retry photo {index + 1}</button>
    </div> : <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open request photo ${index + 1} full size`}>
      <img key={attempt} src={url + (attempt ? `?retry=${attempt}` : '')} alt={`Request photo ${index + 1}`} loading="lazy" decoding="async" onError={() => setFailed(true)} className="aspect-[4/3] w-full bg-muted object-contain" />
    </a>}
    <figcaption className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 underline"><ExternalLink aria-hidden size={15} />Photo {index + 1}</a>
      <a href={url} download={`lead-${leadId}-photo-${index + 1}.${url.split('.').pop()}`} aria-label={`Download request photo ${index + 1}`} className="inline-flex min-h-10 items-center gap-1.5 underline"><Download aria-hidden size={15} />Download</a>
    </figcaption>
  </figure>;
}

export default function LeadPhotos({ photos, leadId }: { photos: string[]; leadId: number }) {
  return <section aria-label="Request photos" className="space-y-3">
    <div><h3 className="font-semibold">Request photos{photos.length > 0 && ` (${photos.length})`}</h3>
      <p className="text-sm text-muted-foreground">{photos.length ? 'Customer uploads and design previews. Open a photo to view it full size.' : 'No photos attached to this request.'}</p></div>
    {photos.length > 0 && <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{photos.map((url, index) => <Photo key={url + index} url={url} index={index} leadId={leadId} />)}</div>}
  </section>;
}
