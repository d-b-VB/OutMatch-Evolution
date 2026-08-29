import { createGameError, handleGameRequest } from "./worker-protocol.js";

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

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  self.addEventListener("message", event => processWorkerMessage(event.data, message => self.postMessage(message)));
}
