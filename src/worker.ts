// Encodes images off the main thread. Scoring is plain JavaScript, so without workers every
// image would wait on one core.
import { parentPort } from "node:worker_threads";
import { encode } from "./encode.ts";
import type { Job, Reply } from "./index.ts";

parentPort!.on("message", async (job: Job) => {
  let reply: Reply;
  try {
    reply = { id: job.id, entry: await encode(job.r, job.key, Buffer.from(job.buf), job.hash) };
  } catch (e) {
    reply = { id: job.id, error: e instanceof Error ? e.message : String(e) };
  }
  parentPort!.postMessage(reply);
});
