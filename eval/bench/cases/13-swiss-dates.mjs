export default {
  title: "Show due dates in Swiss format",
  issues: {
    "sdf-shared": { kind: "bug", difficulty: "medium", note: "Static SimpleDateFormat shared across request threads: not thread-safe, garbles dates under load." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/api/InvoiceHandler.java",
      find: String.raw`                        "due", inv.due().toString(),
`,
      replace: String.raw`                        "due", inv.due().toString(),
                        "dueText", Dates.swiss(java.sql.Date.valueOf(inv.due())),
`,
    },
  ],
  files: {
    "src/main/java/ch/ledger/api/Dates.java": String.raw`package ch.ledger.api;

import java.text.SimpleDateFormat;
import java.util.Date;

/** Date rendering for API responses, e.g. "12.10.2026". */
final class Dates {
    private static final SimpleDateFormat SWISS = new SimpleDateFormat("dd.MM.yyyy");  «sdf-shared»

    private Dates() {}

    static String swiss(Date date) {
        return SWISS.format(date);
    }
}
`,
  },
};
