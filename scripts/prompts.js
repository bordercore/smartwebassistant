import {updateStatus, LOG_LEVELS} from './utils.js';
import {fetchOpenAI} from './api.js';
import {extractWebpageText} from './contentExtraction.js';
import {consoleLog} from './utils.js';

export function handlePromptSubmission (prompt, language, currentController) {
  const includeWebContent = document.getElementById (
    'includeWebContentCheckbox'
  ).checked;
  const systemPrompt = `Output response in ${language} language and markdown format. The prompt is:`;
  // print debug log in console
  consoleLog (`prompt: ${prompt}`, LOG_LEVELS.DEBUG);
  consoleLog (`language: ${language}`, LOG_LEVELS.DEBUG);
  consoleLog (`currentController: ${currentController}`, LOG_LEVELS.DEBUG);

  if (includeWebContent) {
    // If including webpage content
    chrome.tabs.query ({active: true, currentWindow: true}, function (tabs) {
      if (tabs[0] && tabs[0].id) {
        extractWebpageText (tabs[0].id, text => {
          // Replace the prompt in your fetchOpenAI call with the custom prompt
          fetchOpenAI (
            ``,
            `${systemPrompt} ${prompt}. below is the text of the web page: ${text}.`,
            currentController
          ).catch (error => {
            consoleLog (
              'Failed to process custom prompt.' + error.message,
              LOG_LEVELS.ERROR
            );
            updateStatus ('Failed to process custom prompt.' + error.message);
          });
        });
        updateStatus ('Calling API, wait for response');
      }
    });
  } else {
    // If not including webpage content

    fetchOpenAI (
      '',
      `${systemPrompt} ${prompt}.`,
      currentController
    ).catch (error => {
      updateStatus ('Failed to process custom prompt.' + error.message);
    });
  }
  updateStatus ('Submitting prompt: ' + prompt);
}

function splitIntoChunks(text, chunkSize) {
  const paragraphs = text.split(/\n+/); // Split the text into paragraphs based on new lines
  let chunks = [];
  let currentChunk = "";

  paragraphs.forEach(paragraph => {
    if (currentChunk.length + paragraph.length + 1 <= chunkSize) {
      // If adding the paragraph won't exceed the chunk size, add it
      if (currentChunk) currentChunk += "\n"; // Add a newline if it's not the first paragraph in the chunk
      currentChunk += paragraph;
    } else {
      // If adding the paragraph exceeds the chunk size, save the current chunk and start a new one
      chunks.push(currentChunk);
      currentChunk = paragraph;
    }
  });

  // Add the last chunk if it exists
  if (currentChunk) chunks.push(currentChunk);

  return chunks;
}

function playAudioSequentially(audioElements) {
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
        console.error("Error playing audio:", error);
        // Continue the chain even if an error occurs
        return Promise.resolve();
      });
  });
}

export function speak (prompt, language, currentController) {
  chrome.tabs.query ({active: true, currentWindow: true}, function (tabs) {
    if (tabs[0] && tabs[0].id) {
      extractWebpageText (tabs[0].id, text => {
        updateStatus ('Speaking');

        chrome.storage.local.get(
          ['ttsHost'],
          async function (settings) {
            const ttsHost = settings.ttsHost;
            const ttsVoice = "valerie.wav";
            const outputFile = "stream_output.wav";

            const chunkSize = 200;
            const chunks = splitIntoChunks(text, chunkSize);

            let streamingUrl = null;
            let audioChunks = [];
            chunks.forEach((chunk, index) => {
              streamingUrl = `http://${ttsHost}/api/tts-generate-streaming?text=${chunk}&voice=${ttsVoice}&language=en&output_file=${outputFile}`;
              const audioElement = new Audio(`audio_${index}`);
              audioElement.crossOrigin = "anonymous";
              audioElement.src = streamingUrl;
              audioChunks.push(audioElement);
            });
            playAudioSequentially(audioChunks);
          });
      });
    }
  });
}
