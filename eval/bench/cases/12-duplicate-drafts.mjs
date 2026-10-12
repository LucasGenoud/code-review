export default {
  title: "Drop drafts that duplicate a sent invoice",
  issues: {
    "boxed-eq": { kind: "bug", difficulty: "hard", note: "Long compared with ==: identity, so totals above 127 cents never match." },
    "cme": { kind: "bug", difficulty: "medium", note: "Removing from the list inside its for-each loop throws ConcurrentModificationException (and mutates the caller's list)." },
  },
  files: {
    "src/main/java/ch/ledger/service/DuplicateFinder.java": String.raw`package ch.ledger.service;

import ch.ledger.model.Invoice;
import ch.ledger.model.InvoiceStatus;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Finds invoices that were probably entered twice. */
public final class DuplicateFinder {
    private DuplicateFinder() {}

    /** Same customer, same issue date, same total. totals maps invoice id to total cents. */
    static boolean looksDuplicate(Invoice a, Invoice b, Map<Long, Long> totals) {
        Long totalA = totals.get(a.id());
        Long totalB = totals.get(b.id());
        return a.customerId() == b.customerId()
                && a.issued().equals(b.issued())
                && totalA != null
                && totalA == totalB;  «boxed-eq»
    }

    /** Removes drafts that duplicate a sent invoice. Returns the removed drafts. */
    public static List<Invoice> dropDuplicateDrafts(List<Invoice> invoices, Map<Long, Long> totals) {
        List<Invoice> removed = new ArrayList<>();
        for (Invoice draft : invoices) {
            if (draft.status() != InvoiceStatus.DRAFT) {
                continue;
            }

            for (Invoice other : invoices) {
                if (other.status() == InvoiceStatus.SENT && looksDuplicate(draft, other, totals)) {
                    invoices.remove(draft);  «cme»
                    removed.add(draft);
                    break;
                }
            }
        }
        return removed;
    }
}
`,
  },
};
