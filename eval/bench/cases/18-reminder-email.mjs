export default {
  title: "Build weekly reminder email",
  issues: {
    "rule-public-field": { kind: "rule", difficulty: "easy", note: "Public mutable field." },
    "rule-string-loop": { kind: "rule", difficulty: "easy", note: "String += in a loop instead of StringBuilder." },
    "rule-stdout": { kind: "rule", difficulty: "easy", note: "System.out instead of a logger." },
    "rule-raw-type": { kind: "rule", difficulty: "easy", note: "Raw List return type." },
    "rule-catch-throwable": { kind: "rule", difficulty: "easy", note: "Catches Throwable." },
    "rule-print-stack": { kind: "rule", difficulty: "easy", note: "printStackTrace instead of a logger; the error is swallowed." },
  },
  files: {
    "src/main/java/ch/ledger/service/ReminderService.java": String.raw`package ch.ledger.service;

import ch.ledger.model.Invoice;
import ch.ledger.money.Money;
import java.util.ArrayList;
import java.util.List;

/** Builds the weekly reminder email for overdue invoices. */
public class ReminderService {
    public String sender = "billing@ledger.example";  «rule-public-field»

    public String weeklyEmail(List<Invoice> overdue) {
        String body = "Overdue invoices:\n";
        for (Invoice inv : overdue) {
            body += "- #" + inv.id() + " due " + inv.due() + ", paid " + Money.format(inv.paidCents()) + "\n";  «rule-string-loop»
        }

        System.out.println("built reminder for " + overdue.size() + " invoices");  «rule-stdout»
        return body;
    }

    public List recipients(List<String> emails) {  «rule-raw-type»
        List<String> valid = new ArrayList<>();
        for (String email : emails) {
            try {
                valid.add(normalize(email));
            } catch (Throwable t) {  «rule-catch-throwable»
                t.printStackTrace();  «rule-print-stack»
            }
        }
        return valid;
    }

    private static String normalize(String email) {
        if (!email.contains("@")) {
            throw new IllegalArgumentException("not an email: " + email);
        }
        return email.trim().toLowerCase();
    }
}
`,
  },
};
