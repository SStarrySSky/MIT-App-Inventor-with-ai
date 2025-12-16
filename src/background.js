/* eslint-disable no-undef */
// Background service worker to proxy cross-origin fetches so the content script
// can call LLM APIs without CORS headaches, and to allow manual injection via the
// toolbar icon when static content script matching fails.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ai-block-fetch') return;

  const { url, options = {} } = message;
  (async () => {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      const headers = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      sendResponse({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers,
        body: text
      });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true; // Keeps the message channel open for the async response.
});

// Allow manual injection by clicking the extension icon (useful if host matches fail).
chrome.action?.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (tab.url && tab.url.startsWith('chrome://')) {
    console.warn('Skip injection on chrome:// pages');
    return;
  }
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id, allFrames: true },
      files: ['styles.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content-script.js']
    });
  } catch (err) {
    console.error('Injection failed', err);
  }
});
