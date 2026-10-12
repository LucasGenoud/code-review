export default {
  title: "List overdue invoices for reminders",
  issues: {
    "null-return": { kind: "bug", difficulty: "medium", note: "Returns null instead of an empty list; countOverdue then throws NullPointerException when nothing is overdue." },
  },
  files: {
    "src/main/java/ch/ledger/service/OverdueService.java": String.raw`package ch.ledger.service;

import ch.ledger.db.InvoiceRepository;
import ch.ledger.model.Invoice;
import ch.ledger.model.InvoiceStatus;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Overdue invoices for the reminder job. */
public final class OverdueService {
    private final InvoiceRepository invoices;

    public OverdueService(InvoiceRepository invoices) {
        this.invoices = invoices;
    }

    public List<Invoice> overdue(LocalDate today) throws SQLException {
        List<Invoice> result = new ArrayList<>();
        for (Invoice inv : invoices.findByStatus(InvoiceStatus.SENT)) {
            if (InvoiceService.isOverdue(inv, today)) {
                result.add(inv);
            }
        }
        return result.isEmpty() ? null : result;  «null-return»
    }

    public int countOverdue(LocalDate today) throws SQLException {
        return overdue(today).size();  «null-return»
    }
}
`,
  },
};
