export default {
  title: "Support discount codes",
  issues: {
    "discount-vat-base": { kind: "bug", difficulty: "hard", note: "VAT is computed on the subtotal before the discount." },
    "discount-string-eq": { kind: "bug", difficulty: "easy", note: "String compared with ==: an empty code from a request is not the NO_CODE instance." },
    "discount-null": { kind: "bug", difficulty: "medium", note: "Unknown code: Map.get returns null and applyRate throws NullPointerException." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    static final int PAYMENT_TERMS_DAYS = 30;
`,
      replace: String.raw`    static final int PAYMENT_TERMS_DAYS = 30;
    static final String NO_CODE = "";
    static final Map<String, BigDecimal> DISCOUNTS =
            Map.of("WELCOME10", new BigDecimal("0.10"), "LOYAL20", new BigDecimal("0.20"));
`,
    },
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    public static long total(Invoice invoice, Customer customer) {
        return subtotal(invoice) + vat(invoice, customer);
    }
`,
      replace: String.raw`    public static long total(Invoice invoice, Customer customer) {
        return total(invoice, customer, NO_CODE);
    }

    /** Total after the discount code the customer typed, if any. */
    public static long total(Invoice invoice, Customer customer, String code) {
        return subtotal(invoice) - discount(invoice, code) + vat(invoice, customer);  «discount-vat-base»
    }

    static long discount(Invoice invoice, String code) {
        if (code == NO_CODE) {  «discount-string-eq»
            return 0;
        }

        BigDecimal rate = DISCOUNTS.get(code.trim().toUpperCase());  «discount-null»
        return Money.applyRate(subtotal(invoice), rate);
    }
`,
    },
  ],
};
