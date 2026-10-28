import type { IconName } from '../components/Icon';
import type { ProductId } from '../lib/types';

/**
 * Product files. `fileKey` is resolved server-side to a short-lived signed URL
 * (Netlify Blobs) only for customers entitled to `product`. Replace keys with real file ids.
 */
export interface Resource {
  id: string;
  title: string;
  kind: 'Download' | 'Templates' | 'Tracker' | 'Guide' | 'Video';
  icon: IconName;
  product: ProductId;
  fileKey: string;
}

export const RESOURCES: Resource[] = [
  // Digital Bundle (entitlement `creditready`). The book itself is physical and ships — it has no download.
  { id: 'cr-templates', title: '20 Essential Credit Dispute Letter templates (Microsoft Word)', kind: 'Templates', icon: 'doc', product: 'creditready', fileKey: 'creditready/dispute-letter-templates.zip' },
  { id: 'cr-video', title: 'Step-by-step dispute video guide', kind: 'Video', icon: 'play', product: 'creditready', fileKey: 'creditready/video-guide' },
  { id: 'pm-book', title: 'The Property Manager Playbook', kind: 'Guide', icon: 'book', product: 'playbook', fileKey: 'playbook/playbook.pdf' },
  { id: 'pm-questions', title: 'Questions to ask before you pay', kind: 'Download', icon: 'download', product: 'playbook', fileKey: 'playbook/questions.pdf' },
  { id: 'pm-docs', title: 'Documentation checklist by income type', kind: 'Tracker', icon: 'table', product: 'playbook', fileKey: 'playbook/documents.pdf' },
  { id: 'pm-worksheet', title: 'Application game plan worksheet', kind: 'Templates', icon: 'doc', product: 'playbook', fileKey: 'playbook/worksheet.pdf' },
];
