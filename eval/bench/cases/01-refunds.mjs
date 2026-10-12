export default {
  title: "Add partial refunds",
  issues: {
    "refund-negative": { kind: "bug", difficulty: "medium", note: "No check that cents > 0: a negative refund raises the amount paid." },
    "refund-sign": { kind: "bug", difficulty: "medium", note: "savePayment adds cents to paid_cents; a refund must subtract them." },
    "refund-stdout": { kind: "rule", difficulty: "easy", note: "System.out instead of a logger." },
  },
  files: {
    "src/main/java/ch/ledger/service/RefundService.java": String.raw`package ch.ledger.service;

import ch.ledger.db.Database;
import ch.ledger.db.InvoiceRepository;
import ch.ledger.model.Invoice;
import ch.ledger.model.InvoiceStatus;
import java.sql.Connection;
import java.sql.SQLException;

/** Partial refunds of paid invoices. */
public final class RefundService {
    private final Database db;
    private final InvoiceRepository invoices;

    public RefundService(Database db, InvoiceRepository invoices) {
        this.db = db;
        this.invoices = invoices;
    }

    /** Refunds part of what was paid. Returns the amount still paid, in cents. */
    public long refund(long invoiceId, long cents) throws SQLException {
        try (Connection conn = db.open()) {
            conn.setAutoCommit(false);
            Invoice invoice = invoices.find(conn, invoiceId)
                    .orElseThrow(() -> new PaymentException("unknown invoice " + invoiceId));
            if (cents > invoice.paidCents()) {  «refund-negative»
                throw new PaymentException("refund exceeds amount paid");
            }

            System.out.println("refunding " + cents + " cents on invoice " + invoiceId);  «refund-stdout»
            invoices.savePayment(conn, invoiceId, cents);  «refund-sign»
            if (invoice.status() == InvoiceStatus.PAID) {
                invoices.setStatus(conn, invoiceId, InvoiceStatus.SENT);
            }

            conn.commit();
            return invoice.paidCents() - cents;
        }
    }
}
`,
  },
};
