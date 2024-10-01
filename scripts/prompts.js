import {consoleLog, updateStatus, LOG_LEVELS} from './utils.js';
import {fetchOpenAI} from './api.js';
import {extractWebpageTextAPI} from './contentExtraction.js';

export function handlePromptSubmission (prompt, language, currentController) {
  const includeWebContent = document.getElementById (
    'includeWebContentCheckbox'
  ).checked;
  const systemPrompt = `Output response in ${language} language. The prompt is:`;
  // print debug log in console
  consoleLog (`prompt: ${prompt}`, LOG_LEVELS.DEBUG);
  consoleLog (`language: ${language}`, LOG_LEVELS.DEBUG);
  consoleLog (`currentController: ${currentController}`, LOG_LEVELS.DEBUG);

  if (includeWebContent) {
    chrome.tabs.query ({active: true, currentWindow: true}, function (tabs) {
      const activeTabId = tabs[0].id;
      chrome.tabs.sendMessage(
        activeTabId, {
          action: 'getSelectedText',
        }, (selectedText) => {
          if (chrome.runtime.lastError) {
            error(`Error sending message: ${chrome.runtime.lastError.message}`);
            return;
          }
          const args = {
            systemPrompt: systemPrompt,
            prompt: prompt
          };
          if (!selectedText) {
            extractWebpageTextAPI(tabs[0].url, processText, args);
          } else {
            processText(selectedText, args);
          }
        });
    });

  } else {
    fetchOpenAI (
      '',
      `${systemPrompt} ${prompt}.`
    ).catch (error => {
      updateStatus ('Failed to process custom prompt.' + error.message);
    });
  }
  updateStatus ('Submitting prompt: ' + prompt);
}

function processText(text, args) {
  fetchOpenAI (
    ``,
    `${args.systemPrompt} ${args.prompt}. below is the text of the web page: ${text}.`
  ).catch (error => {
    consoleLog (
      'Failed to process custom prompt.' + error.message,
      LOG_LEVELS.ERROR
    );
    updateStatus ('Failed to process custom prompt.' + error.message);
  });
  updateStatus ('Calling API, wait for response');
}
