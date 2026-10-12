export default {
  title: "Export invoices to a file with plain amounts",
  issues: {
    "csv-double": { kind: "bug", difficulty: "medium", note: "Amount as double: 1250 cents prints 12.5, and the README forbids floating point money." },
    "csv-leak": { kind: "rule", difficulty: "easy", note: "Writer not in try-with-resources: leaks the file handle when write throws." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/csv/CsvExporter.java",
      find: String.raw`import ch.ledger.money.Money;
`,
      replace: "",
    },
    {
      file: "src/main/java/ch/ledger/csv/CsvExporter.java",
      find: String.raw`import java.io.Writer;
`,
      replace: String.raw`import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
`,
    },
    {
      file: "src/main/java/ch/ledger/csv/CsvExporter.java",
      find: String.raw`                    Money.format(inv.paidCents())));
`,
      replace: String.raw`                    String.valueOf(inv.paidCents() / 100.0)));  «csv-double»
`,
    },
    {
      file: "src/main/java/ch/ledger/csv/CsvExporter.java",
      find: String.raw`        return invoices.size();
    }
}
`,
      replace: String.raw`        return invoices.size();
    }

    public static int writeFile(Path path, List<Invoice> invoices) throws IOException {
        Writer out = Files.newBufferedWriter(path);  «csv-leak»
        int count = write(out, invoices);
        out.close();
        return count;
    }
}
`,
    },
  ],
};
