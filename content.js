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

chrome.runtime.onMessage.addListener ((message, sender, sendResponse) => {
  if (message.action === 'getMarkdownContent') {
    const markdownContent = document.getElementById('markdownContent');
    sendResponse({markdownContent: markdownContent.value});
  } else if (message.action === 'streamAudio') {
    const chunks = message.chunks;
    const ttsHost = message.ttsHost;
    const ttsVoice = 'female_07.wav';
    const outputFile = 'stream_output.wav';

    let streamingUrl;
    let audioChunks = [];
    let audioElement;

    chunks.forEach((chunk, index) => {
      streamingUrl = `https://${ttsHost}/api/tts-generate-streaming?text=${chunk}&voice=${ttsVoice}&language=en&output_file=${outputFile}`;
      audioElement = new Audio(`audio_${index}`);
      audioElement.crossOrigin = 'anonymous';
      audioElement.playbackRate = 1.2;
      audioElement.src = streamingUrl;
      audioChunks.push(audioElement);
    });
    playAudioSequentially(audioChunks);
  }
  sendResponse();
});

function playAudioSequentially (audioElements) {
  // Initialize a promise chain
  let promiseChain = Promise.resolve();

  audioElements.forEach(audioElement => {
    promiseChain = promiseChain
      .then(() => {
        // Start playing the current audio element
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
        // Continue the chain even if an error occurs
        return Promise.resolve();
      });
  });
}
