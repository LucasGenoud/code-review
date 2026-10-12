package ch.ledger.db;

import ch.ledger.model.Invoice;
import ch.ledger.model.InvoiceStatus;
import ch.ledger.model.LineItem;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Invoice queries. Methods taking a Connection join the caller's transaction. */
public final class InvoiceRepository {
    private final Database db;

    public InvoiceRepository(Database db) {
        this.db = db;
    }

    public Optional<Invoice> find(long id) throws SQLException {
        try (Connection conn = db.open()) {
            return find(conn, id);
        }
    }

    public Optional<Invoice> find(Connection conn, long id) throws SQLException {
        try (PreparedStatement st = conn.prepareStatement("SELECT * FROM invoices WHERE id = ?")) {
            st.setLong(1, id);
            try (ResultSet rs = st.executeQuery()) {
                if (!rs.next()) {
                    return Optional.empty();
                }

                return Optional.of(new Invoice(
                        rs.getLong("id"),
                        rs.getLong("customer_id"),
                        LocalDate.parse(rs.getString("issued")),
                        LocalDate.parse(rs.getString("due")),
                        InvoiceStatus.valueOf(rs.getString("status")),
                        items(conn, id),
                        rs.getLong("paid_cents")));
            }
        }
    }

    public List<Invoice> findByStatus(InvoiceStatus status) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement("SELECT id FROM invoices WHERE status = ? ORDER BY id")) {
            st.setString(1, status.name());
            List<Long> ids = new ArrayList<>();
            try (ResultSet rs = st.executeQuery()) {
                while (rs.next()) {
                    ids.add(rs.getLong(1));
                }
            }

            List<Invoice> result = new ArrayList<>();
            for (long id : ids) {
                find(conn, id).ifPresent(result::add);
            }
            return result;
        }
    }

    public void savePayment(Connection conn, long invoiceId, long cents) throws SQLException {
        try (PreparedStatement insert = conn.prepareStatement("INSERT INTO payments (invoice_id, cents) VALUES (?, ?)");
                PreparedStatement update =
                        conn.prepareStatement("UPDATE invoices SET paid_cents = paid_cents + ? WHERE id = ?")) {
            insert.setLong(1, invoiceId);
            insert.setLong(2, cents);
            insert.executeUpdate();
            update.setLong(1, cents);
            update.setLong(2, invoiceId);
            update.executeUpdate();
        }
    }

    public void setStatus(Connection conn, long invoiceId, InvoiceStatus status) throws SQLException {
        try (PreparedStatement st = conn.prepareStatement("UPDATE invoices SET status = ? WHERE id = ?")) {
            st.setString(1, status.name());
            st.setLong(2, invoiceId);
            st.executeUpdate();
        }
    }

    private static List<LineItem> items(Connection conn, long invoiceId) throws SQLException {
        try (PreparedStatement st = conn.prepareStatement(
                "SELECT description, quantity, unit_cents FROM line_items WHERE invoice_id = ? ORDER BY id")) {
            st.setLong(1, invoiceId);
            try (ResultSet rs = st.executeQuery()) {
                List<LineItem> items = new ArrayList<>();
                while (rs.next()) {
                    items.add(new LineItem(rs.getString(1), rs.getInt(2), rs.getLong(3)));
                }
                return items;
            }
        }
    }
}
