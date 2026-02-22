let ttsSpeedDefault;

(async function() {
  try {
    const src = chrome.runtime.getURL('scripts/utils.js');
    const module = await import(src);
    ttsSpeedDefault = module.ttsSpeedDefault;
  } catch (error) {
    console.error('Error loading module, possibly due to CSP: ', error);
  }
})();

// chrome.runtime.onMessage.addListener (function (request, sender, sendResponse) {
//   if (request.action === 'getText') {
//     if (window.location.href.startsWith ('https://docs.google.com')) {
//       sendResponse ({text: getDocText ()});
//     } else {
//       var mainContentText = document.getElementById ('main-content')
//         ? document.getElementById ('main-content').innerText
//         : document.body.innerText;
//       sendResponse ({text: mainContentText});
//     }
//   }
// });

// Following logic is for accessing Google Docs content
// Calls the extractor via synchronous DOM messaging
// function getDocText () {
//   let res;
//   window.addEventListener (
//     `${eventId}res`,
//     e => {
//       res = e.detail;
//     },
//     {once: true}
//   );
//   window.dispatchEvent (new CustomEvent (eventId));
//   return res;
// }

// Check the URL of the current tab to determine which script to inject.
// if (window.location.href.startsWith ('https://docs.google.com')) {
//   // Google Docs specific script
//   var s = document.createElement ('script');
//   s.src = chrome.runtime.getURL ('injector.js'); // This should be your Google Docs specific script
//   s.onload = function () {
//     this.remove ();
//   };
//   (document.head || document.documentElement).appendChild (s);
// }

let currentAudio;
let stopRequested = false;
let currentEndedResolve = null;

chrome.runtime.onMessage.addListener ((message, sender, sendResponse) => {
  if (message.action === 'getMarkdownContent') {
    const markdownContent = document.getElementById('markdownContent');
    sendResponse({markdownContent: markdownContent.value});
  } else if (message.action === 'getSelectedText') {
    sendResponse(window.getSelection().toString());
  } else if (message.action === 'streamAudio') {
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
      chrome.runtime.sendMessage({action: 'setIsPlaying', state: 'paused'});
    }
  } else if (message.action === 'ttsPlay') {
    if (currentAudio) {
      currentAudio.play();
      chrome.runtime.sendMessage({action: 'setIsPlaying', state: 'playing'});
    }
  } else if (message.action === 'ttsStop') {
    stopRequested = true;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    // Unblock any hanging 'ended' listener so the promise chain can terminate.
    if (currentEndedResolve) {
      currentEndedResolve();
      currentEndedResolve = null;
    }
    chrome.runtime.sendMessage({action: 'setIsPlaying', state: 'stopped'});
  }
});

function fetchAudioFromBackground(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'fetchAudio', url }, response => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response.error) {
        return reject(new Error(response.error));
      }
      const binary = atob(response.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: response.contentType });
      resolve(URL.createObjectURL(blob));
    });
  });
}

async function playAudioSequentially(urls, ttsSpeed) {
  const numChunks = urls.length;
  stopRequested = false;

  if (numChunks === 0) {
    chrome.runtime.sendMessage({ action: 'playingStopped' });
    return;
  }

  // Kick off pre-fetch for the first chunk immediately
  let nextFetch = fetchAudioFromBackground(urls[0]);
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
      chrome.runtime.sendMessage({ action: 'updateStatus', status: err.toString(), type: 'error' });
      // Pre-fetch next chunk (if any) so we can continue
      if (index + 1 < numChunks) {
        nextFetch = fetchAudioFromBackground(urls[index + 1]);
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
      nextFetch = fetchAudioFromBackground(urls[index + 1]);
      nextFetchConsumed = false;
    }

    const audioElement = new Audio(blobUrl);
    audioElement.playbackRate = ttsSpeed;
    currentAudio = audioElement;

    const progress = Math.floor(index / numChunks * 100);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `Speaking: ${progress}%` });

    try {
      await audioElement.play();

      if (stopRequested) break;

      // Wait for playback to finish
      await new Promise(resolve => {
        currentEndedResolve = resolve;
        audioElement.addEventListener('ended', () => {
          currentEndedResolve = null;
          resolve();
        }, { once: true });
      });
    } catch (err) {
      if (stopRequested) break;
      console.error('Error playing audio:', err.toString());
      chrome.runtime.sendMessage({ action: 'updateStatus', status: err.toString(), type: 'error' });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // Clean up any in-flight pre-fetch that was never consumed
  if (!nextFetchConsumed) {
    nextFetch.then(url => URL.revokeObjectURL(url)).catch(() => {});
  }

  if (!stopRequested) {
    chrome.runtime.sendMessage({ action: 'playingStopped' });
  }
}
