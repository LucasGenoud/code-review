export default {
  title: "Add monthly revenue summary",
  issues: {
    "avg-zero": { kind: "bug", difficulty: "easy", note: "Division by zero for a year without paid invoices." },
    "avg-string-loop": { kind: "rule", difficulty: "easy", note: "String += in a loop instead of StringBuilder." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/service/ReportService.java",
      find: String.raw`import ch.ledger.db.Database;
`,
      replace: String.raw`import ch.ledger.db.Database;
import ch.ledger.money.Money;
`,
    },
    {
      file: "src/main/java/ch/ledger/service/ReportService.java",
      find: String.raw`        return count == 0 ? 0 : cents / count;
    }
}
`,
      replace: String.raw`        return count == 0 ? 0 : cents / count;
    }

    /** Average revenue per month that had paid invoices. */
    public static long averagePerMonth(List<MonthRevenue> months) {
        long cents = 0;
        for (MonthRevenue m : months) {
            cents += m.cents();
        }
        return cents / months.size();  «avg-zero»
    }

    /** One line per month, e.g. "2026-03: CHF 1200.00". */
    public static String summary(List<MonthRevenue> months) {
        String text = "";
        for (MonthRevenue m : months) {
            text += m.month() + ": " + Money.format(m.cents()) + "\n";  «avg-string-loop»
        }
        return text;
    }
}
`,
    },
  ],
};
