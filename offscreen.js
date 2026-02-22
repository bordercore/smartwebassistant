import {ttsSpeedDefault} from './scripts/utils.js';

let currentAudio = null;
let stopRequested = false;
let currentEndedResolve = null;

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
    playAudioSequentially(urls, ttsSpeed);
  } else if (message.action === 'ttsPause') {
    if (currentAudio) {
      currentAudio.pause();
      chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'paused'});
    }
  } else if (message.action === 'ttsPlay') {
    if (currentAudio) {
      currentAudio.play();
      chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'playing'});
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
    chrome.runtime.sendMessage({target: 'background', action: 'setIsPlaying', state: 'stopped'});
  }
});

async function playAudioSequentially(urls, ttsSpeed) {
  const numChunks = urls.length;
  stopRequested = false;

  if (numChunks === 0) {
    chrome.runtime.sendMessage({target: 'background', action: 'playingStopped'});
    return;
  }

  // Kick off pre-fetch for the first chunk immediately
  let nextFetch = fetchAudio(urls[0]);
  let nextFetchConsumed = false;

  for (let index = 0; index < numChunks; index++) {
    if (stopRequested) break;

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
