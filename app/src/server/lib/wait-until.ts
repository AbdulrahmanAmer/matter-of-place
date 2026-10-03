import { z } from "zod";

export type WaitUntil = (promise: Promise<unknown>) => void;

// Nitro puts the Worker's bound `waitUntil` on the request (`augmentReq`, GOTCHAS G-018). The Start dev
// server has no Worker, so there a promise is simply started and left to finish.
const WorkerRequest = z.object({
  waitUntil: z.custom<WaitUntil>((value) => typeof value === "function"),
});

/** The way to keep work running after the response: the one `start.ts` and the public pipeline share. */
export function waitUntilOf(request: Request): WaitUntil {
  const worker = WorkerRequest.safeParse(request);
  return worker.success
    ? worker.data.waitUntil
    : (promise) => {
        void promise;
      };
}
