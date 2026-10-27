import { describe, expect, it } from "vitest";
import { beginLive, publishLive, stopLive, subscribeLive } from "./liveStreams";

const encoder = new TextEncoder();

// A source the test feeds by hand; push(null) ends it.
function manualSource() {
  let push!: (text: string | null) => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text) => {
        if (text === null) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(text));
      };
    },
  });

  return { stream, push };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

describe("live streams", () => {
  it("keeps reading after the first reader leaves, and replays to a late reader", async () => {
    beginLive("t1");
    const source = manualSource();
    const first = publishLive("t1", source.stream);

    source.push("a");
    await first.getReader().cancel();
    source.push("b");

    const late = subscribeLive("t1");
    expect(late).not.toBeNull();
    source.push("c");
    source.push(null);

    expect(await readAll(late!)).toBe("abc");
    await Promise.resolve();
    expect(subscribeLive("t1")).toBeNull();
  });

  it("stops the generation on request", () => {
    const signal = beginLive("t2");
    publishLive("t2", manualSource().stream);

    stopLive("t2");

    expect(signal.aborted).toBe(true);
  });
});
