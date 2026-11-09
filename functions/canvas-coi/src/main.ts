/** Appwrite Function entry — Canvas App backend.
 * Everything real lives in handler.ts/runtime.ts/transport.ts/bridge.ts;
 * this file is only the platform export shape. */
import { createCanvasFunctionHandler } from './handler.js';

const handler = createCanvasFunctionHandler();

export default handler;
