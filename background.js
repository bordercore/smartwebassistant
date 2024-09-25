import {extractWebpageTextAPI} from './scripts/contentExtraction.js'
import {splitIntoChunks} from './scripts/utils.js';

chrome.runtime.onMessage.addListener ((message, sender, sendResponse) => {
  if (message.action === 'tts') {
    tts();
  }
});

let popupPort;

// Listen for connections from the popup
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    popupPort = port;

    // Listen for disconnect
    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  }
});

// Update the popup's status field by sending it a message
export function updateStatus (message) {
  if (popupPort) {
    popupPort.postMessage({ message: message });
  } else {
    console.log("Popup is not connected. Message not sent:", message);
  }
}

export function tts (prompt, language, currentController) {
  chrome.tabs.query ({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      extractWebpageTextAPI (tabs[0].url, text => {
        updateStatus ('Speaking');

        chrome.storage.local.get(
          ['ttsHost', 'ttsSpeed'],
          async function (settings) {
            const chunkSize = 200;
            const chunks = splitIntoChunks(text, chunkSize);
            const activeTabId = tabs[0].id;
            chrome.tabs.sendMessage(
              activeTabId, {
                action: 'streamAudio',
                chunks: chunks,
                settings: settings
              }, () => {
              if (chrome.runtime.lastError) {
                updateStatus(chrome.runtime.lastError.message);
                console.log(`Error sending message: ${chrome.runtime.lastError.message}`);
              }
            });
         });
      });
    }
  });
}
