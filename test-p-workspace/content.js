chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'HELIXIS_GET_CONTEXT') {
    sendResponse({
      text:  (document.body?.innerText ?? '').slice(0, 5000),
      title: document.title,
      url:   location.href
    });
  }
});
