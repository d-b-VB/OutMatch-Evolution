import { createGameError, handleGameRequest, handleInitializedGameRequest,
  INITIALIZE_GENERATION_TYPE, INITIALIZED_GAME_TYPE } from "./worker-protocol.js";

/** Process one Worker message; exported so protocol behavior can be tested without a browser. */
export function processWorkerMessage(message, postMessage, handler = handleGameRequest) {
  try {
    postMessage(handler(message));
  } catch (error) {
    try {
      postMessage(createGameError(message, error));
    } catch (validationError) {
      postMessage({
        protocol: message?.protocol ?? null,
        type: "game_error",
        jobId: message?.jobId ?? null,
        scheduleIndex: message?.game?.scheduleIndex ?? null,
        error: { name: validationError.name, message: validationError.message }
      });
    }
  }
}

/** Stateful handler used by production Workers initialized once per generation. */
export function createWorkerMessageProcessor() {
  const context = {};
  return (message, postMessage) => {
    if (![INITIALIZE_GENERATION_TYPE, INITIALIZED_GAME_TYPE].includes(message?.type)) {
      return processWorkerMessage(message, postMessage);
    }
    try { postMessage(handleInitializedGameRequest(message, context)); }
    catch (error) {
      postMessage({ protocol: message?.protocol ?? null, type: "game_error", jobId: message?.jobId ?? null,
        scheduleIndex: message?.game?.scheduleIndex ?? null,
        error: { name: error?.name ?? "Error", message: error?.message ?? String(error) } });
    }
  };
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  const process = createWorkerMessageProcessor();
  self.addEventListener("message", event => process(event.data, message => self.postMessage(message)));
}
