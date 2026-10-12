export default {
  title: "Group thousands in formatted amounts",
  issues: {},
  edits: [
    {
      file: "src/main/java/ch/ledger/money/Money.java",
      find: String.raw`import java.math.RoundingMode;
`,
      replace: String.raw`import java.math.RoundingMode;
import java.util.Locale;
`,
    },
    {
      file: "src/main/java/ch/ledger/money/Money.java",
      find: String.raw`        return String.format("%s%s %d.%02d", sign, CURRENCY, abs / CENTS_PER_UNIT, abs % CENTS_PER_UNIT);
`,
      replace: String.raw`        // Swiss grouping: CHF 1'234.50. ROOT locale so the separator is always ",".
        String units = String.format(Locale.ROOT, "%,d", abs / CENTS_PER_UNIT).replace(",", "'");
        return String.format(Locale.ROOT, "%s%s %s.%02d", sign, CURRENCY, units, abs % CENTS_PER_UNIT);
`,
    },
  ],
};
