export default {
  title: "Cache customer lookups",
  issues: {
    "cache-stale": { kind: "bug", difficulty: "medium", note: "rename does not invalidate the cache: the old name is served for up to 5 minutes." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/db/CustomerRepository.java",
      find: String.raw`    private static Customer read(`,
      replace: String.raw`    public void rename(long id, String name) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement("UPDATE customers SET name = ? WHERE id = ?")) {
            st.setString(1, name);
            st.setLong(2, id);
            st.executeUpdate();
        }
    }

    private static Customer read(`,
    },
  ],
  files: {
    "src/main/java/ch/ledger/service/CustomerService.java": String.raw`package ch.ledger.service;

import ch.ledger.db.CustomerRepository;
import ch.ledger.model.Customer;
import ch.ledger.util.TtlCache;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Optional;

/** Customer lookups, cached because every invoice view needs one. */
public final class CustomerService {
    private static final Duration CACHE_TTL = Duration.ofMinutes(5);

    private final CustomerRepository customers;
    private final TtlCache<Long, Optional<Customer>> cache = new TtlCache<>(CACHE_TTL);

    public CustomerService(CustomerRepository customers) {
        this.customers = customers;
    }

    public Optional<Customer> find(long id) {
        return cache.get(id, key -> {
            try {
                return customers.find(key);
            } catch (SQLException e) {
                throw new IllegalStateException("customer lookup failed", e);
            }
        });
    }

    public void rename(long id, String name) throws SQLException {
        customers.rename(id, name);  «cache-stale»
    }
}
`,
  },
};
