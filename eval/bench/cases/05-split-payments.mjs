export default {
  title: "Spread one payment over several invoices",
  issues: {
    "split-zero-share": { kind: "bug", difficulty: "hard", note: "Each recordPayment commits alone: a zero share (cents < invoices) or a share above an invoice's balance throws after earlier shares were committed." },
    "split-raw-list": { kind: "rule", difficulty: "easy", note: "Raw List / ArrayList types." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`import ch.ledger.model.InvoiceStatus;
`,
      replace: String.raw`import ch.ledger.model.InvoiceStatus;
import ch.ledger.money.Money;
`,
    },
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`import java.sql.SQLException;
`,
      replace: String.raw`import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
`,
    },
    {
      file: "src/main/java/ch/ledger/service/PaymentService.java",
      find: String.raw`            return remaining;
        }
    }
}
`,
      replace: String.raw`            return remaining;
        }
    }

    /** Spreads one payment evenly over several invoices. Returns their balances. */
    public List<Long> recordSplit(List<Long> invoiceIds, long cents) throws SQLException {
        long[] shares = Money.splitEvenly(cents, invoiceIds.size());  «split-zero-share»
        List balances = new ArrayList();  «split-raw-list»
        for (int i = 0; i < shares.length; i++) {
            balances.add(recordPayment(invoiceIds.get(i), shares[i]));
        }
        return balances;
    }
}
`,
    },
  ],
};
