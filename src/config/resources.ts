import type { IconName } from '../components/Icon';
import type { ProductId } from '../lib/types';

/**
 * Product files. `fileKey` is resolved server-side to a short-lived signed URL
 * (Cloudflare R2) only for customers entitled to `product`. Upload objects using these keys.
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

export const RESOURCES: Resource[] = [
  // Digital Bundle (entitlement `creditready`). The book itself is physical and ships — it has no download.
  { id: 'cr-templates', title: 'Credit Repair Toolkit (ZIP download)', kind: 'Download', icon: 'download', product: 'creditready', fileKey: DIGITAL_KIT_FILE_KEY },
  { id: 'cr-video', title: 'Step-by-step dispute video guide', kind: 'Video', icon: 'play', product: 'creditready', fileKey: 'creditready/video-guide' },
  { id: 'pm-book', title: 'The Property Manager Playbook', kind: 'Guide', icon: 'book', product: 'playbook', fileKey: 'playbook/playbook.pdf' },
  { id: 'pm-questions', title: 'Questions to ask before you pay', kind: 'Download', icon: 'download', product: 'playbook', fileKey: 'playbook/questions.pdf' },
  { id: 'pm-docs', title: 'Documentation checklist by income type', kind: 'Tracker', icon: 'table', product: 'playbook', fileKey: 'playbook/documents.pdf' },
  { id: 'pm-worksheet', title: 'Application game plan worksheet', kind: 'Templates', icon: 'doc', product: 'playbook', fileKey: 'playbook/worksheet.pdf' },
];
