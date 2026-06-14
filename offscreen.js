import {ttsSpeedDefault} from './scripts/utils.js';

let currentAudio = null;
let stopRequested = false;
let currentEndedResolve = null;

// Resume state. Offscreen documents can't access chrome.storage, so we hand it
// to the background service worker, which persists it in chrome.storage.session.
// That lets playback be reconstructed if Chrome tears this document down while paused.
let currentUrls = null;
let currentIndex = 0;
let currentTtsSpeed = ttsSpeedDefault;

function saveResumeState(offset) {
  if (!currentUrls) return;
  chrome.runtime.sendMessage({
    target: 'background',
    action: 'saveResumeState',
    state: {
      urls: currentUrls,
      index: currentIndex,
      offset: offset || 0,
      ttsSpeed: currentTtsSpeed,
    },
  });
}

function clearResumeState() {
  currentUrls = null;
  chrome.runtime.sendMessage({target: 'background', action: 'clearResumeState'});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target && message.target !== 'offscreen') return;

  if (message.action === 'streamAudio') {
    // Respond immediately to close the message channel; playback runs asynchronously.
    sendResponse();
    const chunks = message.chunks;
    const ttsHost = message.settings.ttsHost;
    const ttsSpeed = message.settings.ttsSpeed || ttsSpeedDefault;

    const urls = chunks.map(chunk =>
      `https://${ttsHost}/?text=${encodeURIComponent(chunk)}&speed=${ttsSpeed}`
    );
    clearResumeState();
    playAudioSequentially(urls, ttsSpeed);
  } else if (message.action === 'ttsPause') {
    if (currentAudio) {
      currentAudio.pause();
      saveResumeState(currentAudio.currentTime);
      chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'paused'});
    }
  } else if (message.action === 'ttsPlay') {
    // The offscreen document still existed, so the paused audio is intact.
    if (currentAudio) {
      currentAudio.play();
      chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'playing'});
    }
  } else if (message.action === 'resumeAudio') {
    // This document was just recreated after Chrome tore down the paused one.
    // Rebuild playback from the state the background persisted on pause.
    const state = message.state;
    if (state && state.urls && state.index < state.urls.length) {
      chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'playing'});
      playAudioSequentially(state.urls, state.ttsSpeed, state.index, state.offset);
    }
  } else if (message.action === 'ttsStop') {
    stopRequested = true;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (currentEndedResolve) {
      currentEndedResolve();
      currentEndedResolve = null;
    }
    clearResumeState();
    chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'stopped'});
  }
});

async function playAudioSequentially(urls, ttsSpeed, startIndex = 0, startOffset = 0) {
  const numChunks = urls.length;
  stopRequested = false;
  currentUrls = urls;
  currentTtsSpeed = ttsSpeed;

  if (numChunks === 0) {
    chrome.runtime.sendMessage({target: 'background', action: 'playingStopped'});
    return;
  }

  // Kick off pre-fetch for the first chunk immediately
  let nextFetch = fetchAudio(urls[startIndex]);
  let nextFetchConsumed = false;

  for (let index = startIndex; index < numChunks; index++) {
    if (stopRequested) break;
    currentIndex = index;

    let blobUrl;
    nextFetchConsumed = true;
    try {
      blobUrl = await nextFetch;
    } catch (err) {
      if (stopRequested) break;
      console.error('Error fetching audio:', err.toString());
      chrome.runtime.sendMessage({target: 'background', action: 'updateStatus', status: err.toString(), type: 'error'});
      if (index + 1 < numChunks) {
        nextFetch = fetchAudio(urls[index + 1]);
        nextFetchConsumed = false;
      }
      continue;
    }

    if (stopRequested) {
      URL.revokeObjectURL(blobUrl);
      break;
    }

    // Pre-fetch the next chunk while the current one plays
    if (index + 1 < numChunks) {
      nextFetch = fetchAudio(urls[index + 1]);
      nextFetchConsumed = false;
    }

    const audioElement = new Audio(blobUrl);
    audioElement.playbackRate = ttsSpeed;
    // On a resumed session, seek into the chunk we were paused in.
    if (index === startIndex && startOffset > 0) {
      audioElement.addEventListener('loadedmetadata', () => {
        try { audioElement.currentTime = startOffset; } catch (err) {}
      }, {once: true});
    }
    currentAudio = audioElement;

    const progress = Math.floor(index / numChunks * 100);
    chrome.runtime.sendMessage({target: 'background', action: 'updateStatus', status: `Speaking: ${progress}%`});

    try {
      await audioElement.play();

      if (stopRequested) break;

      await new Promise(resolve => {
        currentEndedResolve = resolve;
        audioElement.addEventListener('ended', () => {
          currentEndedResolve = null;
          resolve();
        }, {once: true});
      });
    } catch (err) {
      if (stopRequested) break;
      console.error('Error playing audio:', err.toString());
      chrome.runtime.sendMessage({target: 'background', action: 'updateStatus', status: err.toString(), type: 'error'});
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // Clean up any in-flight pre-fetch that was never consumed
  if (!nextFetchConsumed) {
    nextFetch.then(url => URL.revokeObjectURL(url)).catch(() => {});
  }

  if (!stopRequested) {
    clearResumeState();
    chrome.runtime.sendMessage({target: 'background', action: 'playingStopped'});
  }
}

async function fetchAudio(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TTS server error: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
