import {extractWebpageTextAPI} from './scripts/contentExtraction.js'
import {LOG_LEVELS, splitIntoChunks, sendMessageToPopup, updateStatusBackground as updateStatus} from './scripts/utils.js';

chrome.runtime.onMessage.addListener ((message, sender, sendResponse) => {
  if (message.action === 'tts') {
    tts();
  } else if (message.action === 'updateStatus') {
    const level = message.type === "error" ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO;
    updateStatus(message.status, level);
  } else if (message.action === 'playingStopped') {
    sendMessageToPopup(message);
  }
});

function tts () {
  chrome.tabs.query ({active: true, currentWindow: true}, (tabs) => {
    const activeTabId = tabs[0].id;
    chrome.tabs.sendMessage(
      activeTabId, {
        action: 'getSelectedText',
      }, (selectedText) => {
        if (chrome.runtime.lastError) {
          updateStatus(chrome.runtime.lastError.message);
          console.log(`Error sending message: ${chrome.runtime.lastError.message}`);
          chrome.runtime.sendMessage({action: 'playingStopped'});
          return;
        }
        if (!selectedText) {
          extractWebpageTextAPI(tabs[0].url, processText);
        } else {
          processText(selectedText);
        }
      });
  });
}

function processText(text) {
  chrome.storage.local.get(
    ['ttsHost', 'ttsSpeed'],
    async function (settings) {
      const chunks = splitIntoChunks(text);
      chrome.tabs.query ({active: true, currentWindow: true}, (tabs) => {
        const activeTabId = tabs[0].id;
        updateStatus ('Speaking');
        chrome.tabs.sendMessage(
          activeTabId, {
            action: 'streamAudio',
            chunks: chunks,
            settings: settings
          }, () => {
            if (chrome.runtime.lastError) {
              updateStatus(chrome.runtime.lastError.message);
              console.log(`Error sending message: ${chrome.runtime.lastError.message}`);
              chrome.runtime.sendMessage({action: 'playingStopped'});
            }
          });
      })
    })
}
