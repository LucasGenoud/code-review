# Ledger

Invoicing service in Java 21. Stores customers, invoices and payments in
SQLite through plain JDBC, and serves them through `api/InvoiceHandler`.

Conventions:
- Amounts are `long` cents everywhere. Never `double`.
- Rates are fractions: `new BigDecimal("0.081")` is 8.1 %.
- Repositories return `Optional` or empty lists, never `null`.
- Every SQL query is parameterized.
- Log with `java.util.logging`, never `System.out`.
