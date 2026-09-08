// This file intentionally contains NO page-specific logic. Every page's
// original <script> text is executed byte-for-byte unmodified; this only
// changes *when* window/document "load" style listeners fire, because in a
// single-page app the browser's real `load` event has already happened
// once for the whole shell, long before any individual page mounts.
//
// Without this, every page's `window.addEventListener("load", ...)` /
// `document.addEventListener("DOMContentLoaded", ...)` init code would
// simply never run on client-side navigations (it would only run the very
// first time the app loads). This shim makes that pattern behave exactly
// as it did when each page was its own full document load, without
// touching a single character of the original script.
export function runLegacyScript(scriptText) {
  const trackedListeners = [];
  const deferredLoadHandlers = [];

  const originalWindowAdd = window.addEventListener.bind(window);
  const originalDocumentAdd = document.addEventListener.bind(document);

  window.addEventListener = (type, listener, options) => {
    if (type === 'load') {
      deferredLoadHandlers.push(listener);
      return;
    }
    trackedListeners.push({ target: window, type, listener, options });
    return originalWindowAdd(type, listener, options);
  };

  document.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') {
      deferredLoadHandlers.push(listener);
      return;
    }
    trackedListeners.push({ target: document, type, listener, options });
    return originalDocumentAdd(type, listener, options);
  };

  try {
    // Executed as a real <script> tag (not eval/new Function) so the
    // script's top-level `function foo(){}` declarations become real
    // globals exactly like they did as a plain page script — some pages
    // rely on inline `onclick="foo()"` handlers finding these globals.
    const scriptEl = document.createElement('script');
    scriptEl.textContent = scriptText;
    document.body.appendChild(scriptEl);
    document.body.removeChild(scriptEl);

    deferredLoadHandlers.forEach((handler) => {
      try {
        handler(new Event('load'));
      } catch (err) {
        console.error('Legacy page init handler threw:', err);
      }
    });
  } finally {
    window.addEventListener = originalWindowAdd;
    document.addEventListener = originalDocumentAdd;
  }

  return function cleanupLegacyScript() {
    trackedListeners.forEach(({ target, type, listener, options }) => {
      target.removeEventListener(type, listener, options);
    });
  };
}
