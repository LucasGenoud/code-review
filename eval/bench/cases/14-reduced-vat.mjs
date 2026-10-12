export default {
  title: "Add reduced VAT rate",
  issues: {
    "bd-double": { kind: "bug", difficulty: "medium", note: "new BigDecimal(0.026) takes the binary double: 0.02599999… instead of 0.026." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    static final BigDecimal VAT_RATE = new BigDecimal("0.081");
`,
      replace: String.raw`    static final BigDecimal VAT_RATE = new BigDecimal("0.081");
    static final BigDecimal REDUCED_VAT_RATE = new BigDecimal(0.026);  «bd-double»
`,
    },
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    public static long total(Invoice invoice, Customer customer) {`,
      replace: String.raw`    /** VAT at the reduced rate, for food and books. */
    public static long reducedVat(Invoice invoice, Customer customer) {
        if (customer.vatExempt()) {
            return 0;
        }
        return Money.applyRate(subtotal(invoice), REDUCED_VAT_RATE);
    }

    public static long total(Invoice invoice, Customer customer) {`,
    },
  ],
};
