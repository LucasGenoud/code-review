package ch.ledger.model;

public record Customer(long id, String name, String email, boolean vatExempt) {}
