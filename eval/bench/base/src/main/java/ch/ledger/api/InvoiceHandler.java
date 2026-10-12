package ch.ledger.api;

import ch.ledger.db.InvoiceRepository;
import ch.ledger.money.Money;
import ch.ledger.service.PaymentException;
import ch.ledger.service.PaymentService;
import java.sql.SQLException;
import java.util.Map;

/** HTTP handlers. Each takes parsed parameters and returns status and JSON body. */
public final class InvoiceHandler {
    public record Response(int status, Map<String, Object> body) {}

    static final int HTTP_OK = 200;
    static final int HTTP_BAD_REQUEST = 400;
    static final int HTTP_NOT_FOUND = 404;

    private final InvoiceRepository invoices;
    private final PaymentService payments;

    public InvoiceHandler(InvoiceRepository invoices, PaymentService payments) {
        this.invoices = invoices;
        this.payments = payments;
    }

    public Response getInvoice(long id) throws SQLException {
        return invoices.find(id)
                .map(inv -> new Response(HTTP_OK, Map.<String, Object>of(
                        "id", inv.id(),
                        "status", inv.status().name(),
                        "due", inv.due().toString(),
                        "paidCents", inv.paidCents())))
                .orElseGet(() -> error(HTTP_NOT_FOUND, "not found"));
    }

    public Response postPayment(long id, Map<String, String> body) throws SQLException {
        String amount = body.get("amount");
        if (amount == null) {
            return error(HTTP_BAD_REQUEST, "amount is required");
        }

        try {
            long remaining = payments.recordPayment(id, Money.toCents(amount));
            return new Response(HTTP_OK, Map.<String, Object>of("remainingCents", remaining));
        } catch (PaymentException | NumberFormatException | ArithmeticException e) {
            return error(HTTP_BAD_REQUEST, e.getMessage());
        }
    }

    private static Response error(int status, String message) {
        return new Response(status, Map.<String, Object>of("error", message));
    }
}
