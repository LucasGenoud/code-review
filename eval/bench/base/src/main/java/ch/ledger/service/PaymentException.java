package ch.ledger.service;

public final class PaymentException extends RuntimeException {
    public PaymentException(String message) {
        super(message);
    }
}
