package ch.ledger.util;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.Callable;

/** Retries flaky outbound calls with exponential backoff. */
public final class Retry {
    private Retry() {}

    /** Calls `call` up to `attempts` times, doubling the delay after each IOException. */
    public static <T> T withBackoff(Callable<T> call, int attempts, Duration baseDelay) throws Exception {
        if (attempts < 1) {
            throw new IllegalArgumentException("attempts must be at least 1");
        }

        for (int attempt = 0; ; attempt++) {
            try {
                return call.call();
            } catch (IOException e) {
                if (attempt == attempts - 1) {
                    throw e;
                }
                Thread.sleep(baseDelay.toMillis() << attempt);
            }
        }
    }
}
