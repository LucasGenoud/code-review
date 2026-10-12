package ch.ledger.db;

import ch.ledger.model.Customer;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Customer queries. */
public final class CustomerRepository {
    private static final String COLUMNS = "id, name, email, vat_exempt";

    private final Database db;

    public CustomerRepository(Database db) {
        this.db = db;
    }

    public Optional<Customer> find(long id) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement("SELECT " + COLUMNS + " FROM customers WHERE id = ?")) {
            st.setLong(1, id);
            try (ResultSet rs = st.executeQuery()) {
                return rs.next() ? Optional.of(read(rs)) : Optional.empty();
            }
        }
    }

    public List<Customer> findByPrefix(String prefix) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement(
                        "SELECT " + COLUMNS + " FROM customers WHERE name LIKE ? ORDER BY name")) {
            st.setString(1, prefix + "%");
            try (ResultSet rs = st.executeQuery()) {
                List<Customer> result = new ArrayList<>();
                while (rs.next()) {
                    result.add(read(rs));
                }
                return result;
            }
        }
    }

    private static Customer read(ResultSet rs) throws SQLException {
        return new Customer(rs.getLong("id"), rs.getString("name"), rs.getString("email"), rs.getBoolean("vat_exempt"));
    }
}
