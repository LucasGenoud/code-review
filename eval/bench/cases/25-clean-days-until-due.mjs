export default {
  title: "Add days until due",
  issues: {},
  edits: [
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`import java.time.LocalDate;
`,
      replace: String.raw`import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
`,
    },
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    public static boolean isOverdue(`,
      replace: String.raw`    /** Days until the due date; negative once it has passed. */
    public static long daysUntilDue(Invoice invoice, LocalDate today) {
        return ChronoUnit.DAYS.between(today, invoice.due());
    }

    public static boolean isOverdue(`,
    },
  ],
};
