import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SITE } from '../config/site';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Per-route title, description, canonical, OG and robots. Post-purchase routes are noindex. */
export function Seo({ title, description, noindex = false }: { title: string; description?: string; noindex?: boolean }) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = title;
    const desc = description || 'Understand your credit, learn what rental screening may consider, and prepare before applying for the apartment you actually want.';
    setMeta('name', 'description', desc);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:url', SITE.url + pathname);
    setMeta('property', 'og:site_name', SITE.brand);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = SITE.url + (pathname === '/' ? '/' : pathname.replace(/\/$/, ''));
  }, [title, description, noindex, pathname]);
  return null;
}
