import type { IconName } from '../components/Icon';
import type { ProductId } from '../lib/types';

/**
 * Product files. `fileKey` is resolved server-side to a short-lived signed URL (Cloudflare R2, private bucket) only for
 * customers entitled to it (canAccess). Upload objects using these exact keys. Nothing here is ever public.
 */
export interface Resource {
  id: string;
  title: string;
  kind: 'Download' | 'Templates' | 'Tracker' | 'Guide' | 'Video';
  icon: IconName;
  product: ProductId;
  fileKey: string;
}

export const DIGITAL_KIT_FILE_KEY = 'CREDIT REPAIR TOOLKIT™.zip';
/** The eBook PDF in the private R2 bucket. Upload "Know Before They Say No.pdf" under exactly this key. */
export const EBOOK_FILE_KEY = 'ebook/Know Before They Say NO - RentReady eBook.pdf';

export const RESOURCES: Resource[] = [
  // Digital eBook (entitlement `guide`) — also included in the Complete Digital Bundle (see canAccess).
  { id: 'ebook', title: 'Know Before They Say NO! — eBook (PDF)', kind: 'Guide', icon: 'book', product: 'guide', fileKey: EBOOK_FILE_KEY },
  // Complete Digital Bundle (entitlement `creditready`).
  { id: 'cr-templates', title: '20 Editable Credit Dispute Letters (ZIP of Word files)', kind: 'Templates', icon: 'download', product: 'creditready', fileKey: DIGITAL_KIT_FILE_KEY },
  { id: 'cr-video', title: 'Video education guides', kind: 'Video', icon: 'play', product: 'creditready', fileKey: 'creditready/video-guide' },
  // Retired product (no longer sold): kept so past Playbook buyers keep their files.
  { id: 'pm-book', title: 'The Property Manager Playbook', kind: 'Guide', icon: 'book', product: 'playbook', fileKey: 'playbook/playbook.pdf' },
  { id: 'pm-questions', title: 'Questions to ask before you pay', kind: 'Download', icon: 'download', product: 'playbook', fileKey: 'playbook/questions.pdf' },
  { id: 'pm-docs', title: 'Documentation checklist by income type', kind: 'Tracker', icon: 'table', product: 'playbook', fileKey: 'playbook/documents.pdf' },
  { id: 'pm-worksheet', title: 'Application game plan worksheet', kind: 'Templates', icon: 'doc', product: 'playbook', fileKey: 'playbook/worksheet.pdf' },
];

/** Whether owning `owned` unlocks a resource of `product`. The Complete Digital Bundle includes the eBook. */
export const canAccess = (owned: readonly ProductId[], product: ProductId) =>
  owned.includes(product) || (product === 'guide' && owned.includes('creditready'));

/** The files someone who owns `owned` can open, in display order. */
export const resourcesFor = (owned: readonly ProductId[]) => RESOURCES.filter((r) => canAccess(owned, r.product));
