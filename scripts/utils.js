// Defaults
const ttsSpeedDefault = 1.2;
export {ttsSpeedDefault};

// Log levels
export const LOG_LEVELS = {
  ERROR: 1,
  INFO: 2,
  DEBUG: 3,
};
// Update the status display in the bottom
export function updateStatus (message, level = LOG_LEVELS.INFO) {
  const isDebugMode = document.getElementById ('debugModeCheckbox').checked;
  if (!isDebugMode && level === LOG_LEVELS.DEBUG) {
    return; // Ignore debug messages unless debug mode is enabled
  }
  // let user know the status of each operation
  const statusDisplay = document.getElementById ('status');
  statusDisplay.textContent = message;
}

// Console log with log levels, if debug mode is enabled
export function consoleLog (message, level = LOG_LEVELS.INFO) {
  const isDebugMode = document.getElementById ('debugModeCheckbox').checked;
  if (!isDebugMode && level === LOG_LEVELS.DEBUG) {
    return; // Ignore debug messages unless debug mode is enabled
  }
  console.log (message);
}

// test if a string is a valid URL
export function isValidUrl (url) {
  const pattern = new RegExp (
    '^(https?:\/\/)?' + // protocol
    '(([a-z\\d]([a-z\\d-]*[a-z\\d])*)' + // hostname
    '(\\.([a-z\\d]([a-z\\d-]*[a-z\\d])*))*' + // domain name
    '|((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
    '(\\:\\d+)?(\/[-a-z\\d%_.~+]*)*' + // port and path
    '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
      '(\\#[-a-z\\d_]*)?$',
    'i'
  ); // fragment locator
  return !!pattern.test (url);
}

export function splitIntoChunks (text, chunkSize) {
  const paragraphs = text.split(/\n+/); // Split the text into paragraphs based on new lines
  let chunks = [];
  let currentChunk = '';

  paragraphs.forEach(paragraph => {
    if (currentChunk.length + paragraph.length + 1 <= chunkSize) {
      // If adding the paragraph won't exceed the chunk size, add it
      if (currentChunk) currentChunk += '\n'; // Add a newline if it's not the first paragraph in the chunk
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
