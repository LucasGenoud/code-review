package ch.ledger.util;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.LongSupplier;

/** Small thread-safe cache whose entries expire after a fixed time. */
public final class TtlCache<K, V> {
    private record Entry<V>(long expiresAt, V value) {}

    private final long ttlMillis;
    private final LongSupplier clock;
    private final Map<K, Entry<V>> entries = new ConcurrentHashMap<>();

    public TtlCache(Duration ttl) {
        this(ttl, System::currentTimeMillis);
    }

    public TtlCache(Duration ttl, LongSupplier clock) {
        this.ttlMillis = ttl.toMillis();
        this.clock = clock;
    }

    public V get(K key, Function<K, V> load) {
        long now = clock.getAsLong();
        Entry<V> hit = entries.get(key);
        if (hit != null && hit.expiresAt() > now) {
            return hit.value();
        }

        V value = load.apply(key);
        entries.put(key, new Entry<>(now + ttlMillis, value));
        return value;
    }

    public void invalidate(K key) {
        entries.remove(key);
    }
}
