export default {
  title: "Add quantity price tiers",
  issues: {
    "overflow": { kind: "bug", difficulty: "medium", note: "int multiplication overflows above ~21 million cents (e.g. 100000 pieces at CHF 500) before widening to long." },
  },
  files: {
    "src/main/java/ch/ledger/model/PriceTier.java": String.raw`package ch.ledger.model;

import java.util.List;

/** Unit price from a minimum quantity on, e.g. 100+ pieces at CHF 4.50. */
public record PriceTier(int minQuantity, int unitCents) {

    /** Total for quantity pieces at the best tier reached. Tiers sorted by minQuantity. */
    public static long total(List<PriceTier> tiers, int quantity) {
        if (tiers.isEmpty()) {
            throw new IllegalArgumentException("no price tiers");
        }

        PriceTier best = tiers.get(0);
        for (PriceTier tier : tiers) {
            if (quantity >= tier.minQuantity()) {
                best = tier;
            }
        }
        int total = quantity * best.unitCents();  «overflow»
        return total;
    }
}
`,
  },
};
