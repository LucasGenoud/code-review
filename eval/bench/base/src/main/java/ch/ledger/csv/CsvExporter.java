package ch.ledger.csv;

import ch.ledger.model.Invoice;
import ch.ledger.money.Money;
import java.io.IOException;
import java.io.Writer;
import java.util.List;

/** CSV export of invoices. */
public final class CsvExporter {
    private static final String HEADER = "id,customer,issued,due,status,items,paid";

    private CsvExporter() {}

    public static int write(Writer out, List<Invoice> invoices) throws IOException {
        out.write(HEADER + "\n");
        for (Invoice inv : invoices) {
            out.write(String.join(
                    ",",
                    String.valueOf(inv.id()),
                    String.valueOf(inv.customerId()),
                    inv.issued().toString(),
                    inv.due().toString(),
                    inv.status().name(),
                    String.valueOf(inv.items().size()),
                    Money.format(inv.paidCents())));
            out.write("\n");
        }
        return invoices.size();
    }
}
