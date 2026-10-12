export default {
  title: "Express rates in percent and add early payment discount",
  issues: {
    "xfile-rate": { kind: "bug", difficulty: "hard", note: "applyRate now takes percent, but the new discount passes the fraction 0.02: 0.02 % instead of 2 %." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/money/Money.java",
      find: String.raw`    /** Returns cents * rate, rounded half up. rate is a fraction: 0.081 = 8.1 %. */
    public static long applyRate(long cents, BigDecimal rate) {
        return BigDecimal.valueOf(cents).multiply(rate).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }
`,
      replace: String.raw`    /** Returns cents * percent / 100, rounded half up. 8.1 means 8.1 %. */
    public static long applyRate(long cents, BigDecimal percent) {
        return BigDecimal.valueOf(cents)
                .multiply(percent)
                .movePointLeft(2)
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
    }
`,
    },
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    static final BigDecimal VAT_RATE = new BigDecimal("0.081");
`,
      replace: String.raw`    static final BigDecimal VAT_RATE = new BigDecimal("8.1");
`,
    },
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`import ch.ledger.model.InvoiceStatus;
`,
      replace: String.raw`import ch.ledger.model.InvoiceStatus;
import ch.ledger.money.Money;
import java.math.BigDecimal;
`,
    },
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`    private static final Logger LOG = Logger.getLogger(PaymentService.class.getName());
`,
      replace: String.raw`    private static final Logger LOG = Logger.getLogger(PaymentService.class.getName());
    private static final BigDecimal EARLY_PAYMENT_DISCOUNT = new BigDecimal("0.02");  «xfile-rate»
`,
    },
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`    /** Records a payment and returns the remaining balance in cents. */`,
      replace: String.raw`    /** Discount granted when paying within 10 days of issue. */
    public static long earlyPaymentDiscount(long openCents) {
        return Money.applyRate(openCents, EARLY_PAYMENT_DISCOUNT);  «xfile-rate»
    }

    /** Records a payment and returns the remaining balance in cents. */`,
    },
  ],
};
