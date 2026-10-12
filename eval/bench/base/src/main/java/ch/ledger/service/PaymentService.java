package ch.ledger.service;

import ch.ledger.db.CustomerRepository;
import ch.ledger.db.Database;
import ch.ledger.db.InvoiceRepository;
import ch.ledger.model.Customer;
import ch.ledger.model.Invoice;
import ch.ledger.model.InvoiceStatus;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.logging.Logger;

/** Records payments against invoices. */
public final class PaymentService {
    private static final Logger LOG = Logger.getLogger(PaymentService.class.getName());

    private final Database db;
    private final InvoiceRepository invoices;
    private final CustomerRepository customers;

    public PaymentService(Database db, InvoiceRepository invoices, CustomerRepository customers) {
        this.db = db;
        this.invoices = invoices;
        this.customers = customers;
    }

    /** Records a payment and returns the remaining balance in cents. */
    public long recordPayment(long invoiceId, long cents) throws SQLException {
        if (cents <= 0) {
            throw new PaymentException("payment must be positive");
        }

        try (Connection conn = db.open()) {
            conn.setAutoCommit(false);
            Invoice invoice = invoices.find(conn, invoiceId)
                    .orElseThrow(() -> new PaymentException("unknown invoice " + invoiceId));
            if (invoice.status() != InvoiceStatus.SENT) {
                throw new PaymentException("invoice " + invoiceId + " is " + invoice.status());
            }

            Customer customer = customers.find(invoice.customerId())
                    .orElseThrow(() -> new PaymentException("unknown customer " + invoice.customerId()));
            long remaining = InvoiceService.balance(invoice, customer);
            if (cents > remaining) {
                throw new PaymentException("payment exceeds balance of " + remaining + " cents");
            }

            invoices.savePayment(conn, invoiceId, cents);
            remaining -= cents;
            if (remaining == 0) {
                invoices.setStatus(conn, invoiceId, InvoiceStatus.PAID);
            }

            conn.commit();
            LOG.info(() -> "invoice " + invoiceId + " paid " + cents);
            return remaining;
        }
    }
}
