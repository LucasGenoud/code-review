package ch.ledger.model;

import java.time.LocalDate;
import java.util.List;

public final class Invoice {
    private final long id;
    private final long customerId;
    private final LocalDate issued;
    private final LocalDate due;
    private final InvoiceStatus status;
    private final List<LineItem> items;
    private final long paidCents;

    public Invoice(
            long id,
            long customerId,
            LocalDate issued,
            LocalDate due,
            InvoiceStatus status,
            List<LineItem> items,
            long paidCents) {
        this.id = id;
        this.customerId = customerId;
        this.issued = issued;
        this.due = due;
        this.status = status;
        this.items = List.copyOf(items);
        this.paidCents = paidCents;
    }

    public long id() {
        return id;
    }

    public long customerId() {
        return customerId;
    }

    public LocalDate issued() {
        return issued;
    }

    public LocalDate due() {
        return due;
    }

    public InvoiceStatus status() {
        return status;
    }

    public List<LineItem> items() {
        return items;
    }

    public long paidCents() {
        return paidCents;
    }
}
