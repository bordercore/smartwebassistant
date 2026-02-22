import {extractWebpageTextAPI} from './scripts/contentExtraction.js'
import {LOG_LEVELS, splitIntoChunks, sendMessageToPopup, updateStatusBackground as updateStatus} from './scripts/utils.js';

chrome.runtime.onMessage.addListener ((message, sender, sendResponse) => {
  if (message.target && message.target !== 'background') return;

  if (message.action === 'tts') {
    chrome.storage.session.set({ playingState: 'playing' });
    tts();
  } else if (message.action === 'updateStatus') {
    const level = message.type === "error" ? LOG_LEVELS.ERROR : LOG_LEVELS.INFO;
    updateStatus(message.status, level);
  } else if (message.action === 'playingStopped') {
    chrome.storage.session.set({ playingState: 'stopped' });
    sendMessageToPopup(message);
  } else if (message.action === 'setIsPlaying') {
    chrome.storage.session.set({ playingState: message.state });
    if (message.state === 'stopped') {
      sendMessageToPopup({action: 'playingStopped'});
    }
  } else if (message.action === 'isPlaying') {
    chrome.storage.session.get('playingState', (result) => {
      sendResponse(result.playingState || 'stopped');
    });
    return true;
  } else if (message.action === 'ttsPlay' || message.action === 'ttsPause' || message.action === 'ttsStop') {
    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage({target: 'offscreen', action: message.action});
    }).catch(err => {
      error(`Offscreen document error: ${err.message}`);
    });
  }
});

let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'TTS audio playback'
      });
    }
  })();

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

function tts () {
  chrome.tabs.query ({active: true, currentWindow: true}, (tabs) => {
    const activeTabId = tabs[0].id;
    chrome.tabs.sendMessage(
      activeTabId, {
        action: 'getSelectedText',
      }, (selectedText) => {
        if (chrome.runtime.lastError) {
          error(`Error sending message: ${chrome.runtime.lastError.message}`);
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

  if (!text) {
    error("Error extracting text");
    return;
  }
  chrome.storage.local.get(
    ['ttsHost', 'ttsSpeed'],
    async function (settings) {
      const chunks = splitIntoChunks(text);
      try {
        await ensureOffscreenDocument();
        updateStatus('Speaking');
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'streamAudio',
          chunks: chunks,
          settings: settings
        }, () => {
          if (chrome.runtime.lastError) {
            error(`Error sending message: ${chrome.runtime.lastError.message}`);
          }
        });
      } catch (err) {
        error(`Error creating offscreen document: ${err.message}`);
      }
    })
}

function error(message) {
  updateStatus(message, LOG_LEVELS.ERROR);
  console.log(message);
  chrome.runtime.sendMessage({action: 'playingStopped'});
}
