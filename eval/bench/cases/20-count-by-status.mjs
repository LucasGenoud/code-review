export default {
  title: "Count invoices by status for the dashboard",
  issues: {
    "db-leak": { kind: "bug", difficulty: "easy", note: "Connection, statement and result set never closed." },
    "db-swallow": { kind: "bug", difficulty: "medium", note: "SQLException swallowed: the dashboard silently shows 0." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/db/InvoiceRepository.java",
      find: String.raw`    private static List<LineItem> items(`,
      replace: String.raw`    /** Number of invoices in a status. */
    public int countByStatus(InvoiceStatus status) {
        try {
            Connection conn = db.open();  «db-leak»
            PreparedStatement st = conn.prepareStatement("SELECT COUNT(*) FROM invoices WHERE status = ?");
            st.setString(1, status.name());
            ResultSet rs = st.executeQuery();
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            return 0;  «db-swallow»
        }
    }

    private static List<LineItem> items(`,
    },
  ],
};
