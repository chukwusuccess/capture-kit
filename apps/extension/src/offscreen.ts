chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'offscreen-copy') {
    return false;
  }
  const text = (message as { text?: unknown }).text;
  if (typeof text !== 'string') {
    sendResponse({ success: false, error: 'Missing clipboard text' });
    return false;
  }
  const ta = document.getElementById('clipboard-target') as HTMLTextAreaElement | null;
  if (!ta) {
    sendResponse({ success: false, error: 'Clipboard element missing' });
    return false;
  }
  ta.value = text;
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  sendResponse({ success: ok, ...(ok ? {} : { error: 'execCommand copy returned false' }) });
  return false;
});
