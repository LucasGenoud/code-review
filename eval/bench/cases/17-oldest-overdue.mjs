export default {
  title: "Pick the longest overdue invoices",
  issues: {
    "oldest-order": { kind: "bug", difficulty: "medium", note: "reversed() sorts newest due date first; the doc asks for oldest first." },
    "oldest-limit": { kind: "bug", difficulty: "easy", note: "subList end is limit - 1: one invoice short, and -1 (exception) when none are overdue." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`import java.util.EnumSet;
`,
      replace: String.raw`import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
`,
    },
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    public static boolean canTransition(`,
      replace: String.raw`    /** The limit invoices that are overdue the longest, oldest first. */
    public static List<Invoice> oldestOverdue(List<Invoice> invoices, LocalDate today, int limit) {
        List<Invoice> overdue = new ArrayList<>();
        for (Invoice inv : invoices) {
            if (isOverdue(inv, today)) {
                overdue.add(inv);
            }
        }

        overdue.sort(Comparator.comparing(Invoice::due).reversed());  «oldest-order»
        return overdue.subList(0, Math.min(limit, overdue.size()) - 1);  «oldest-limit»
    }

    public static boolean canTransition(`,
    },
  ],
};
