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
  } else if (message.action === 'ttsPlay') {
    // If the offscreen document still exists, its paused audio is intact and we
    // just resume it. If Chrome tore it down while paused, ensureOffscreenDocument
    // creates a fresh (empty) one, so we rebuild playback from the saved state.
    ensureOffscreenDocument().then((existed) => {
      if (existed) {
        chrome.runtime.sendMessage({target: 'offscreen', action: 'ttsPlay'});
      } else {
        chrome.storage.session.get('ttsResumeState', (result) => {
          if (result.ttsResumeState) {
            chrome.runtime.sendMessage({target: 'offscreen', action: 'resumeAudio', state: result.ttsResumeState});
          }
        });
      }
    }).catch(err => {
      error(`Offscreen document error: ${err.message}`);
    });
  } else if (message.action === 'ttsPause' || message.action === 'ttsStop') {
    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage({target: 'offscreen', action: message.action});
    }).catch(err => {
      error(`Offscreen document error: ${err.message}`);
    });
  } else if (message.action === 'saveResumeState') {
    chrome.storage.session.set({ ttsResumeState: message.state });
  } else if (message.action === 'clearResumeState') {
    chrome.storage.session.remove('ttsResumeState');
  }
});

let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (offscreenCreating) return offscreenCreating;

  // Resolves to true if the offscreen document already existed, false if it was
  // just created (meaning any prior in-memory audio state is gone).
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
      return false;
    }
    return true;
  })();

  try {
    return await offscreenCreating;
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
