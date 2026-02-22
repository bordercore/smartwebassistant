chrome.runtime.onMessage.addListener ((message, sender, sendResponse) => {
  if (message.action === 'getMarkdownContent') {
    const markdownContent = document.getElementById('markdownContent');
    sendResponse({markdownContent: markdownContent.value});
  } else if (message.action === 'getSelectedText') {
    sendResponse(window.getSelection().toString());
  }
});
