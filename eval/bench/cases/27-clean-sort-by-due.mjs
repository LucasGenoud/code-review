export default {
  title: "Sort invoices by due date",
  issues: {},
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
      replace: String.raw`    /** Earliest due date first, ties by id. Leaves the input untouched. */
    public static List<Invoice> byDueDate(List<Invoice> invoices) {
        List<Invoice> sorted = new ArrayList<>(invoices);
        sorted.sort(Comparator.comparing(Invoice::due).thenComparingLong(Invoice::id));
        return sorted;
    }

    public static boolean canTransition(`,
    },
  ],
};
