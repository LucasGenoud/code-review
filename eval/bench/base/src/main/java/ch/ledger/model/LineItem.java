package ch.ledger.model;

public record LineItem(String description, int quantity, long unitCents) {
    public long totalCents() {
        return quantity * unitCents;
    }
}
