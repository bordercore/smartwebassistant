let ttsSpeedDefault;

(async function() {
  try {
    const src = chrome.runtime.getURL('scripts/utils.js');
    const module = await import(src);
    ttsSpeedDefault = module.ttsSpeedDefault;
  } catch (error) {
    console.error('Error loading module:', error);
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
    const ttsVoice = 'female_07.wav';
    const outputFile = 'stream_output.wav';

    let streamingUrl;
    let audioChunks = [];
    let audioElement;

    chunks.forEach((chunk, index) => {
      streamingUrl = `https://${ttsHost}/api/tts-generate-streaming?text=${chunk}&voice=${ttsVoice}&language=en&output_file=${outputFile}`;
      audioElement = new Audio(`audio_${index}`);
      audioElement.preload = "none";
      audioElement.src = streamingUrl;
      audioElement.playbackRate = ttsSpeed;
      audioChunks.push(audioElement);
    });
    playAudioSequentially(audioChunks);
    return true;
  } else if (message.action === 'ttsPause') {
    currentAudio.pause();
  } else if (message.action === 'ttsPlay') {
    currentAudio.play();
  }
});

function playAudioSequentially (audioElements) {
  // Initialize a promise chain
  let promiseChain = Promise.resolve();

  const numChunks = audioElements.length;

  audioElements.forEach( (audioElement, index) => {
    promiseChain = promiseChain
      .then(() => {
        // Start playing the current audio element
        currentAudio = audioElement;
        const progress = Math.floor((index + 1) / numChunks * 100);
        chrome.runtime.sendMessage({action: 'updateStatus', status: `Speaking: ${progress}%`});
        return audioElement.play();
      })
      .then(() => {
        // Wait for the current audio to finish playing before proceeding
        return new Promise(resolve => {
          audioElement.addEventListener('ended', resolve, { once: true });
        });
      })
      .catch(error => {
        console.error('Error playing audio:', error);
        chrome.runtime.sendMessage({action: 'updateStatus', status: error.toString(), type: "error"});
        // Continue the chain even if an error occurs
        return Promise.resolve();
      });
  });

  // Add a final .then() to the promise chain so that we know we're finished
  return promiseChain.then(() => {
    chrome.runtime.sendMessage({action: 'playingStopped'});
  });
}
