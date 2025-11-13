// api.js
import {updateStatus, consoleLog, LOG_LEVELS} from './utils.js';
import {initMarkdown, appendMarkdown, displayMarkdown} from './markdown.js';

let currentController = null;
let requestCancelled = true;

/**
 * Fetches a response from the OpenAI API.
 * @param {string} system_prompt - The system prompt to be sent to the API.
 * @param {string} user_prompt - The user prompt to be sent to the API.
 * @returns {void}
 */
export function fetchOpenAI(system_prompt, user_prompt) {
  // print debug log in console
  consoleLog(`system_prompt: ${system_prompt}`, LOG_LEVELS.DEBUG);
  consoleLog(`user_prompt: ${user_prompt}`, LOG_LEVELS.DEBUG);

  // Get settings from local storage
  chrome.storage.local.get (
    ['apiUrl', 'apiToken', 'modelName', 'maxToken', 'temperature', 'topP'],
    async function (settings) {
      if (chrome.runtime.lastError) {
        console.error ('Error fetching settings:', chrome.runtime.lastError);
        updateStatus ('Failed to load settings. Please try again.');
        return;
      }

      // Cancel any ongoing fetch
      if (currentController && currentController instanceof AbortController) {
        currentController.abort ();
      }

      // Create a new AbortController
      currentController = new AbortController ();

      // Create messages array dynamically based on system_prompt
      const messages = [];
      if (system_prompt) {
        messages.push ({
          role: 'system',
          content: system_prompt,
        });
      }

      messages.push ({
        role: 'user',
        content: user_prompt,
      });

      // Build payload for Responses API
      const payload = {
        model: settings.modelName,
        input: messages, // Responses API expects `input`
        stream: true, // Enable streaming
        // temperature: parseFloat(settings.temperature),
        // top_p: parseFloat(settings.topP),
      };

      // max_output_tokens is the Responses API field
      if (settings.maxToken) {
        payload.max_output_tokens = parseInt(settings.maxToken, 10);
      }

      // Define the requestOptions including the AbortController's signal
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiToken}`,
          // For some proxies you might also add:
          // "Accept": "text/event-stream",
        },
        body: JSON.stringify (payload),
        signal: currentController.signal,
      };

      updateStatus ('Calling API ' + settings.apiUrl, LOG_LEVELS.DEBUG);
      cancelButton.style.display = 'block'; // Show cancel button

      try {
        requestCancelled = false;

        return fetch(settings.apiUrl, requestOptions).then((response) => {
          const statusCode = response.status;
          const reader = response.body.getReader();
          initMarkdown();
          updateStatus(`Status : ${statusCode}. Waiting for response...`);

          const textDecoder = new TextDecoder("utf-8");
          let buffer = "";

          function processEvent(rawEvent) {
            const lines = rawEvent
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);

            if (lines.length === 0) {
              return;
            }

            // Optional: read SSE event name if present
            // const eventLine = lines.find((l) => l.startsWith("event:"));
            // const eventName = eventLine
            //   ? eventLine.slice("event:".length).trim()
            //   : null;

            const dataLine = lines.find((l) => l.startsWith("data:"));
            if (!dataLine) {
              return;
            }

            const jsonStr = dataLine.slice("data:".length).trim();
            let obj;
            try {
              obj = JSON.parse(jsonStr);
            } catch (err) {
              consoleLog(
                "JSON.parse failed for data line: " + jsonStr,
                LOG_LEVELS.DEBUG
              );
              return;
            }

            let content = null;

            // Responses API streaming format
            if (
              obj.type === "response.output_text.delta" &&
              typeof obj.delta === "string"
            ) {
              content = obj.delta;
            }
            // Backward-compat: old Chat Completions streaming format
            else if (
              obj.choices &&
              obj.choices[0] &&
              obj.choices[0].delta &&
              obj.choices[0].delta.content
            ) {
              content = obj.choices[0].delta.content;
            }

            if (content != null) {
              updateStatus("Stream received data.");
              consoleLog("Received content:" + content, LOG_LEVELS.DEBUG);
              appendMarkdown(content);
              if (content.includes("\n")) {
                displayMarkdown();
              }
            } else if (obj.type) {
              consoleLog(
                "Received non-text SSE event type: " + obj.type,
                LOG_LEVELS.DEBUG
              );
            }
          }

          reader
            .read ()
            .then (function pump({done, value}) {
              if (done) {
                updateStatus (`Stream completed.`);
                displayMarkdown (true);
                cancelButton.style.display = 'none'; // Hide cancel button
                return;
              }

              buffer += textDecoder.decode(value, { stream: true });
              consoleLog("Received raw chunk:" + buffer, LOG_LEVELS.DEBUG);

              let sepIndex;
              // SSE events are separated by a blank line
              while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
                const rawEvent = buffer.slice(0, sepIndex);
                buffer = buffer.slice(sepIndex + 2);
                processEvent(rawEvent);
              }

              return reader.read().then(pump);
            })
            .catch((error) => {
              console.error("Error during fetch or reading:", error);
              if (error.name === "AbortError") {
                updateStatus("Request was cancelled.");
              }
              if (requestCancelled) {
                updateStatus ('Request was cancelled.');
              } else {
                updateStatus (`API call has failed: ${error.message}`);
              }
            });
        });
      } catch (error) {
        console.error("Error making API request:", error);
        updateStatus(`API call has failed: ${error.message}`);
      }
    }
  );
}

// BELOW HERE ARE THE CONNECTION TEST HELPERS

const statusId = 'connectionTestStatus';

function updateConnectionTestStatus (message, success = null) {
  const statusDisplay = document.getElementById (statusId);

  if (!statusDisplay) {
    console.error (`Element with ID "${statusId}" not found.`);
    return;
  }

  statusDisplay.textContent = message;

  statusDisplay.classList.remove ('alert-light', 'alert-success', 'alert-danger');

  if (success === true) {
    statusDisplay.classList.add ('alert-success');
  } else if (success === false) {
    statusDisplay.classList.add ('alert-danger');
  } else {
    statusDisplay.classList.add ('alert-light');
  }
}

export function testApiConnection (apiUrl) {
  const controller = new AbortController ();
  const timeoutId = setTimeout (() => controller.abort (), 30000); // 30 seconds timeout

  updateConnectionTestStatus ('Testing connection...');

  fetch (apiUrl, {
    method: 'GET', // adjust as necessary for your API
    signal: controller.signal,
  })
    .then (response => {
      clearTimeout (timeoutId);
      if (response.ok) {
        updateConnectionTestStatus ('Connection successful!', true);
      } else {
        updateConnectionTestStatus (
          `Connection failed with status: ${response.status}`,
          false
        );
      }
    })
    .catch (error => {
      clearTimeout (timeoutId);
      if (error.name === 'AbortError') {
        updateConnectionTestStatus ('Connection timed out.', false);
      } else {
        updateConnectionTestStatus (
          `Connection failed: ${error.message}`,
          false
        );
      }
    });
}
