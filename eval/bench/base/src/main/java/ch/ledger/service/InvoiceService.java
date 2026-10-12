package ch.ledger.service;

import ch.ledger.model.Customer;
import ch.ledger.model.Invoice;
import ch.ledger.model.InvoiceStatus;
import ch.ledger.model.LineItem;
import ch.ledger.money.Money;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/** Invoice totals and lifecycle. */
public final class InvoiceService {
    static final BigDecimal VAT_RATE = new BigDecimal("0.081");
    static final int PAYMENT_TERMS_DAYS = 30;

    private static final Map<InvoiceStatus, Set<InvoiceStatus>> TRANSITIONS = Map.of(
            InvoiceStatus.DRAFT, EnumSet.of(InvoiceStatus.SENT, InvoiceStatus.VOID),
            InvoiceStatus.SENT, EnumSet.of(InvoiceStatus.PAID, InvoiceStatus.VOID),
            InvoiceStatus.PAID, EnumSet.noneOf(InvoiceStatus.class),
            InvoiceStatus.VOID, EnumSet.noneOf(InvoiceStatus.class));

    private InvoiceService() {}

    public static long subtotal(Invoice invoice) {
        long sum = 0;
        for (LineItem item : invoice.items()) {
            sum += item.totalCents();
        }
        return sum;
    }

    public static long vat(Invoice invoice, Customer customer) {
        if (customer.vatExempt()) {
            return 0;
        }
        return Money.applyRate(subtotal(invoice), VAT_RATE);
    }

    public static long total(Invoice invoice, Customer customer) {
        return subtotal(invoice) + vat(invoice, customer);
    }

    public static long balance(Invoice invoice, Customer customer) {
        return total(invoice, customer) - invoice.paidCents();
    }

    public static LocalDate dueDate(LocalDate issued) {
        return issued.plusDays(PAYMENT_TERMS_DAYS);
    }

    public static boolean isOverdue(Invoice invoice, LocalDate today) {
        return invoice.status() == InvoiceStatus.SENT && today.isAfter(invoice.due());
    }

    public static boolean canTransition(InvoiceStatus from, InvoiceStatus to) {
        return TRANSITIONS.get(from).contains(to);
    }
}
