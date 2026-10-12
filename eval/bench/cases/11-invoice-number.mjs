export default {
  title: "Add invoice numbers and a duplicate registry",
  issues: {
    "key-hashcode": { kind: "bug", difficulty: "medium", note: "equals without hashCode: equal numbers land in different HashSet buckets, so duplicates are accepted." },
  },
  files: {
    "src/main/java/ch/ledger/model/InvoiceNumber.java": String.raw`package ch.ledger.model;

/** Human-facing invoice number, e.g. "2026-0042". Unique per year. */
public final class InvoiceNumber {
    private final int year;
    private final int sequence;

    public InvoiceNumber(int year, int sequence) {
        this.year = year;
        this.sequence = sequence;
    }

    public static InvoiceNumber parse(String text) {
        String[] parts = text.split("-");
        if (parts.length != 2) {
            throw new IllegalArgumentException("expected YYYY-NNNN: " + text);
        }
        return new InvoiceNumber(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
    }

    @Override
    public boolean equals(Object o) {  «key-hashcode»
        return o instanceof InvoiceNumber other && year == other.year && sequence == other.sequence;
    }

    @Override
    public String toString() {
        return String.format("%d-%04d", year, sequence);
    }
}
`,
    "src/main/java/ch/ledger/service/NumberRegistry.java": String.raw`package ch.ledger.service;

import ch.ledger.model.InvoiceNumber;
import java.util.HashSet;
import java.util.Set;

/** Remembers issued invoice numbers and rejects duplicates. */
public final class NumberRegistry {
    private final Set<InvoiceNumber> used = new HashSet<>();

    /** True when the number was free and is now taken. */
    public synchronized boolean register(InvoiceNumber number) {
        return used.add(number);  «key-hashcode»
    }
}
`,
  },
};
