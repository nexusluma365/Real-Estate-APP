import { useEffect, useRef } from 'react';
import { runLegacyScript } from './runLegacyScript';

/**
 * Mounts a legacy static page's original head extras (font <link> tags),
 * <style> block, body markup, and inline <script> blocks exactly as they
 * were authored. Nothing about the page's HTML, CSS, or JS is rewritten —
 * this only orchestrates *when* those unchanged assets are attached to /
 * detached from the live document as the user navigates between pages in
 * the single-page app, so styles and globals from a previous page never
 * leak into the next one.
 *
 * @param {{ title?: string, headExtras?: string, styles?: string, bodyHtml: string, scripts?: string[] }} page
 */
export function useLegacyPage(page) {
  const containerRef = useRef(null);

  useEffect(() => {
    const previousTitle = document.title;
    if (page.title) document.title = page.title;

    let movedHeadNodes = [];
    if (page.headExtras) {
      const parser = document.createElement('div');
      parser.innerHTML = page.headExtras;
      movedHeadNodes = Array.from(parser.childNodes);
      movedHeadNodes.forEach((node) => document.head.appendChild(node));
    }

    let styleEl = null;
    if (page.styles) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-legacy-page-style', '');
      styleEl.textContent = page.styles;
      document.head.appendChild(styleEl);
    }

    if (containerRef.current) {
      containerRef.current.innerHTML = page.bodyHtml || '';
    }

    const cleanupFns = (page.scripts || []).map((scriptText) => runLegacyScript(scriptText));

    return () => {
      cleanupFns.forEach((fn) => fn());
      if (styleEl) document.head.removeChild(styleEl);
      movedHeadNodes.forEach((node) => {
        if (node.parentNode === document.head) document.head.removeChild(node);
      });
      if (containerRef.current) containerRef.current.innerHTML = '';
      document.title = previousTitle;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return containerRef;
}
