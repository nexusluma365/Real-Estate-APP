const DOWNLOAD_PRODUCTS = new Set(['modern', 'luxury', 'gameplan', 'creditkit']);

function cloudflareDownloadUrl() {
  return process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL || '';
}

async function sendDownloadEmail(leadId, product) {
  const url = cloudflareDownloadUrl();
  const normalizedProduct = String(product || '').trim().toLowerCase();
  if (!url || !leadId || !DOWNLOAD_PRODUCTS.has(normalizedProduct)) return false;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET
        ? { Authorization: `Bearer ${process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET}` }
        : {}),
    },
    body: JSON.stringify({ leadId, product: normalizedProduct }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data || data.ok !== true) {
    throw new Error(`Cloudflare download email failed: ${JSON.stringify(data)}`);
  }
  return true;
}

module.exports = { sendDownloadEmail };
