export default {
  title: "Separate payment insert from invoice update",
  issues: {
    "payment-split": {
      kind: "bug",
      difficulty: "hard",
      outsideDiff: true,
      note: "PaymentService.recordPayment (not in the diff) only calls savePayment, so paid_cents is never updated and invoices never become PAID.",
    },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/db/InvoiceRepository.java",
      find: String.raw`    public void savePayment(Connection conn, long invoiceId, long cents) throws SQLException {
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
`,
      replace: String.raw`    /** Inserts the payment row. Call addPaid to update the invoice. */
    public void savePayment(Connection conn, long invoiceId, long cents) throws SQLException {  «payment-split»
        try (PreparedStatement insert = conn.prepareStatement("INSERT INTO payments (invoice_id, cents) VALUES (?, ?)")) {
            insert.setLong(1, invoiceId);
            insert.setLong(2, cents);
            insert.executeUpdate();
        }
    }

    public void addPaid(Connection conn, long invoiceId, long cents) throws SQLException {
        try (PreparedStatement update =
                conn.prepareStatement("UPDATE invoices SET paid_cents = paid_cents + ? WHERE id = ?")) {
            update.setLong(1, cents);
            update.setLong(2, invoiceId);
            update.executeUpdate();
        }
    }
`,
    },
  ],
};
