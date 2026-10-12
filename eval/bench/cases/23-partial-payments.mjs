export default {
  title: "Mark partially paid invoices",
  issues: {
    "partial-rejected": { kind: "bug", difficulty: "medium", note: "recordPayment only accepts SENT invoices, so a second payment on a PARTIALLY_PAID invoice is rejected." },
    "partial-transitions": {
      kind: "bug",
      difficulty: "hard",
      outsideDiff: true,
      note: "InvoiceService (not in the diff) has no TRANSITIONS entry for PARTIALLY_PAID (canTransition throws NullPointerException) and isOverdue ignores such invoices.",
    },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/model/InvoiceStatus.java",
      find: String.raw`    SENT,
`,
      replace: String.raw`    SENT,
    PARTIALLY_PAID,  «partial-transitions»
`,
    },
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`            if (remaining == 0) {
                invoices.setStatus(conn, invoiceId, InvoiceStatus.PAID);
            }
`,
      replace: String.raw`            InvoiceStatus next = remaining == 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;  «partial-rejected»
            invoices.setStatus(conn, invoiceId, next);
`,
    },
  ],
};
