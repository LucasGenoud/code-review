export default {
  title: "Add jitter to retry backoff",
  issues: {
    "retry-broad": { kind: "bug", difficulty: "medium", note: "Catches every Exception, so non-transient errors are retried too; the doc still says IOException." },
    "retry-last": { kind: "bug", difficulty: "medium", note: "attempt == attempts: one call more than requested." },
    "retry-interrupt": { kind: "bug", difficulty: "medium", note: "InterruptedException swallowed: the interrupt flag is lost and the retry loop keeps going." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/util/Retry.java",
      find: String.raw`import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.Callable;
`,
      replace: String.raw`import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.ThreadLocalRandom;
`,
    },
    {
      file: "src/main/java/ch/ledger/util/Retry.java",
      find: String.raw`            } catch (IOException e) {
                if (attempt == attempts - 1) {
                    throw e;
                }
                Thread.sleep(baseDelay.toMillis() << attempt);
            }
`,
      replace: String.raw`            } catch (Exception e) {  «retry-broad»
                if (attempt == attempts) {  «retry-last»
                    throw e;
                }

                long jitter = ThreadLocalRandom.current().nextLong(baseDelay.toMillis() + 1);
                try {
                    Thread.sleep((baseDelay.toMillis() << attempt) + jitter);
                } catch (InterruptedException ignored) {  «retry-interrupt»
                }
            }
`,
    },
  ],
};
