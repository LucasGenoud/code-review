package ch.ledger.service;

import ch.ledger.db.Database;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/** Revenue reports. */
public final class ReportService {
    public record MonthRevenue(String month, int invoices, long cents) {}

    private static final String MONTHLY_REVENUE = """
            SELECT substr(issued, 1, 7) AS month, COUNT(*) AS n, SUM(paid_cents) AS cents
            FROM invoices
            WHERE status = 'PAID' AND substr(issued, 1, 4) = ?
            GROUP BY month
            ORDER BY month
            """;

    private final Database db;

    public ReportService(Database db) {
        this.db = db;
    }

    public List<MonthRevenue> monthlyRevenue(int year) throws SQLException {
        try (Connection conn = db.open();
                PreparedStatement st = conn.prepareStatement(MONTHLY_REVENUE)) {
            st.setString(1, String.valueOf(year));
            try (ResultSet rs = st.executeQuery()) {
                List<MonthRevenue> result = new ArrayList<>();
                while (rs.next()) {
                    result.add(new MonthRevenue(rs.getString("month"), rs.getInt("n"), rs.getLong("cents")));
                }
                return result;
            }
        }
    }

    public static long averageInvoice(List<MonthRevenue> months) {
        int count = 0;
        long cents = 0;
        for (MonthRevenue m : months) {
            count += m.invoices();
            cents += m.cents();
        }
        return count == 0 ? 0 : cents / count;
    }
}
