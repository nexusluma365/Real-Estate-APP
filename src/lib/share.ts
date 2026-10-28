import { env } from './env';

export const SHARE_MESSAGE =
  'I found RentReady while getting ready to apply for an apartment. It helps you understand your credit and what to prepare before applying.';

export function shareUrl(source: string) {
  // Plain attribution so shared visits are measurable. No referral codes, no rewards.
  return `${env.siteUrl}/?utm_source=share&utm_medium=${encodeURIComponent(source)}&utm_campaign=customer_share`;
}

export const shareLinks = {
  email: () =>
    `mailto:?subject=${encodeURIComponent('Something that helped me prepare to rent')}&body=${encodeURIComponent(`${SHARE_MESSAGE}\n\n${shareUrl('email')}`)}`,
  sms: () => `sms:?&body=${encodeURIComponent(`${SHARE_MESSAGE} ${shareUrl('sms')}`)}`,
};

export async function copyShareLink(): Promise<boolean> {
  const text = `${SHARE_MESSAGE} ${shareUrl('copy')}`;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
