export default {
  title: "Add late fees for overdue invoices",
  issues: {
    "fee-shared-map": { kind: "bug", difficulty: "medium", note: "Static HashMap: results from earlier calls leak into later ones, and it is not thread-safe." },
    "fee-started-month": { kind: "bug", difficulty: "medium", note: "Integer division counts full months; the doc says per started month, so 1-29 days late costs nothing." },
    "fee-optional-get": { kind: "bug", difficulty: "medium", note: "Optional.get() without a presence check: a missing customer throws NoSuchElementException." },
  },
  files: {
    "src/main/java/ch/ledger/service/LateFeeService.java": String.raw`package ch.ledger.service;

import ch.ledger.db.CustomerRepository;
import ch.ledger.model.Customer;
import ch.ledger.model.Invoice;
import ch.ledger.money.Money;
import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Late fees: 2 % of the open balance per started month past the due date. */
public final class LateFeeService {
    private static final BigDecimal MONTHLY_RATE = new BigDecimal("0.02");
    private static final int DAYS_PER_MONTH = 30;
    private static final Map<Long, Long> FEES = new HashMap<>();  «fee-shared-map»

    private final CustomerRepository customers;

    public LateFeeService(CustomerRepository customers) {
        this.customers = customers;
    }

    static long lateFee(Invoice invoice, long openCents, LocalDate today) {
        if (!InvoiceService.isOverdue(invoice, today)) {
            return 0;
        }

        long months = ChronoUnit.DAYS.between(invoice.due(), today) / DAYS_PER_MONTH;  «fee-started-month»
        return Money.applyRate(openCents, MONTHLY_RATE.multiply(BigDecimal.valueOf(months)));
    }

    /** Fee per invoice id, for the given invoices. */
    public Map<Long, Long> lateFees(List<Invoice> invoices, LocalDate today) throws SQLException {
        for (Invoice invoice : invoices) {
            Customer customer = customers.find(invoice.customerId()).get();  «fee-optional-get»
            FEES.put(invoice.id(), lateFee(invoice, InvoiceService.balance(invoice, customer), today));
        }
        return FEES;
    }
}
`,
  },
};
