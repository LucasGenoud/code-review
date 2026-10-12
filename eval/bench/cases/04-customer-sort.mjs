export default {
  title: "Let customer search choose the sort column",
  issues: {
    "sort-injection": { kind: "bug", difficulty: "easy", note: "Request parameter concatenated into ORDER BY: SQL injection." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/db/CustomerRepository.java",
      find: String.raw`    public List<Customer> findByPrefix(String prefix) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement(
                        "SELECT " + COLUMNS + " FROM customers WHERE name LIKE ? ORDER BY name")) {
`,
      replace: String.raw`    public List<Customer> findByPrefix(String prefix, String orderBy) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement(
                        "SELECT " + COLUMNS + " FROM customers WHERE name LIKE ? ORDER BY " + orderBy)) {  «sort-injection»
`,
    },
  ],
  files: {
    "src/main/java/ch/ledger/api/CustomerHandler.java": String.raw`package ch.ledger.api;

import ch.ledger.db.CustomerRepository;
import ch.ledger.model.Customer;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;

/** Customer search for the invoice form's autocomplete. */
public final class CustomerHandler {
    private static final String DEFAULT_SORT = "name";

    private final CustomerRepository customers;

    public CustomerHandler(CustomerRepository customers) {
        this.customers = customers;
    }

    public InvoiceHandler.Response search(Map<String, String> query) throws SQLException {
        String prefix = query.getOrDefault("q", "");
        String sort = query.getOrDefault("sort", DEFAULT_SORT);  «sort-injection»
        List<Customer> found = customers.findByPrefix(prefix, sort);
        List<Map<String, Object>> rows = found.stream()
                .map(c -> Map.<String, Object>of("id", c.id(), "name", c.name()))
                .toList();
        return new InvoiceHandler.Response(InvoiceHandler.HTTP_OK, Map.<String, Object>of("customers", rows));
    }
}
`,
  },
};
