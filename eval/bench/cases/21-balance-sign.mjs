export default {
  title: "Report balance as customer credit",
  issues: {
    "balance-sign": {
      kind: "bug",
      difficulty: "hard",
      outsideDiff: true,
      note: "Sign flipped, but PaymentService.recordPayment (not in the diff) still reads balance as amount owed: every payment now exceeds the 'balance' and is rejected.",
    },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/service/InvoiceService.java",
      find: String.raw`    public static long balance(Invoice invoice, Customer customer) {
        return total(invoice, customer) - invoice.paidCents();
    }
`,
      replace: String.raw`    /** Customer's credit on this invoice: negative while they still owe money. */
    public static long balance(Invoice invoice, Customer customer) {
        return invoice.paidCents() - total(invoice, customer);  «balance-sign»
    }
`,
    },
  ],
};
