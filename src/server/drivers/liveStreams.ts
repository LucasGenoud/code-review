// Answers being generated, by conversation key (e.g. "thread:3"). The model
// keeps going when the browser goes away; a reloaded page reconnects and
// gets the whole stream so far, then the rest.
//
//   model ──► drain loop ──► buffered chunks ──► reader 1 (the request that started it)
//                                     └────────► reader 2 (a reload reconnecting)
//
// In memory: single-process, single-user app. Lost on restart.

type Live = {
  chunks: Uint8Array[];
  readers: Set<ReadableStreamDefaultController<Uint8Array>>;
  abort: AbortController;
};

// Survives dev hot reloads.
const cache = globalThis as unknown as { liveStreams?: Map<string, Live> };
const lives = (cache.liveStreams ??= new Map());

// Starts a generation for `key`, stopping one already running there.
// The signal aborts the model call on stopLive().
export function beginLive(key: string): AbortSignal {
  lives.get(key)?.abort.abort();
  const live: Live = { chunks: [], readers: new Set(), abort: new AbortController() };
  lives.set(key, live);
  return live.abort.signal;
}

// Reads `body` to the end whoever listens, and returns a first reader.
export function publishLive(key: string, body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const live = lives.get(key);
  if (!live) {
    throw new Error(`beginLive(${key}) first`);
  }

  void drain(key, live, body);
  return reader(live);
}

// The running generation for `key`, replayed from its start; null if none.
export function subscribeLive(key: string): ReadableStream<Uint8Array> | null {
  const live = lives.get(key);
  return live ? reader(live) : null;
}

export function stopLive(key: string): void {
  lives.get(key)?.abort.abort();
}

async function drain(key: string, live: Live, body: ReadableStream<Uint8Array>): Promise<void> {
  const source = body.getReader();
  try {
    for (;;) {
      const { done, value } = await source.read();
      if (done) {
        break;
      }

      live.chunks.push(value);
      for (const r of live.readers) {
        r.enqueue(value);
      }
    }
  } finally {
    for (const r of live.readers) {
      r.close();
    }

    // A newer generation may have replaced this one.
    if (lives.get(key) === live) {
      lives.delete(key);
    }
  }
}

// A reader leaving (closed tab) doesn't stop the drain loop.
function reader(live: Live): ReadableStream<Uint8Array> {
  let self: ReadableStreamDefaultController<Uint8Array>;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      self = controller;
      for (const chunk of live.chunks) {
        controller.enqueue(chunk);
      }

      live.readers.add(controller);
    },
    cancel() {
      live.readers.delete(self);
    },
  });
}
