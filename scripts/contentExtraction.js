import {consoleLog, LOG_LEVELS} from './utils.js';
import {updateStatus, updateStatusBackground} from './utils.js';

export function extractWebpageText (tabId, processFunction) {
  updateStatus ('Extracting text from the webpage...');
  chrome.tabs.sendMessage (tabId, {action: 'getText'}, function (response) {
    if (chrome.runtime.lastError || !response) {
      handleResponseError ('Extraction');
      return;
    }
    consoleLog ('Response: ' + response, LOG_LEVELS.DEBUG);
    processFunction (response.text);
  });
}

function handleResponseError (operation) {
  updateStatus (`Please refresh the webpage of active tab.`);
}

export function extractWebpageTextAPI (tabUrl, processFunction) {
  updateStatusBackground ('Extracting text from the webpage...');
  chrome.storage.local.get(
    ['textExtractionHost', 'textExtractionToken'],
    async function (settings) {
      fetch(`https://${settings.textExtractionHost}/api/extract_text?url=` + encodeURIComponent(tabUrl),
            {
              headers: {
                'Authorization': 'Token ' + settings.textExtractionToken,
              }
            })
        .then(response => response.json())
        .then(data => processFunction (data["text"]))
        .catch(error => console.error('Error:', error));
    }
  );
}
