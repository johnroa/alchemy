import { assertEquals } from "jsr:@std/assert";
import { scheduleDemandQueueDrain } from "./lib/background-tasks.ts";

Deno.test("scheduleDemandQueueDrain clamps the requested limit and runs the injected processor", async () => {
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<void>) => void };
  };
  const originalRuntime = runtime.EdgeRuntime;

  let waited: Promise<void> | null = null;
  runtime.EdgeRuntime = {
    waitUntil(promise) {
      waited = promise;
    },
  };

  const calls: number[] = [];

  try {
    scheduleDemandQueueDrain({
      serviceClient: {} as never,
      actorUserId: "user-1",
      requestId: "request-1",
      limit: 999,
      processor: async ({ limit }) => {
        calls.push(limit);
        return {
          reaped: 0,
          claimed: 0,
          processed: 0,
          completed: 0,
          failed: 0,
          deadLettered: 0,
          graph: {},
          queue: {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            dead_letter: 0,
          },
        };
      },
    });

    if (waited) {
      await waited;
    }

    assertEquals(calls, [25]);
  } finally {
    runtime.EdgeRuntime = originalRuntime;
  }
});
