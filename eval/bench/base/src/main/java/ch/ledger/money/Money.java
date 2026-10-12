package ch.ledger.money;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Money helpers. All amounts are long cents. */
public final class Money {
    public static final String CURRENCY = "CHF";
    private static final int CENTS_PER_UNIT = 100;

    private Money() {}

    /** Parses a decimal string like "12.30" into cents. */
    public static long toCents(String amount) {
        return new BigDecimal(amount).setScale(2, RoundingMode.HALF_UP).movePointRight(2).longValueExact();
    }

    public static String format(long cents) {
        String sign = cents < 0 ? "-" : "";
        long abs = Math.abs(cents);
        return String.format("%s%s %d.%02d", sign, CURRENCY, abs / CENTS_PER_UNIT, abs % CENTS_PER_UNIT);
    }

    /** Returns cents * rate, rounded half up. rate is a fraction: 0.081 = 8.1 %. */
    public static long applyRate(long cents, BigDecimal rate) {
        return BigDecimal.valueOf(cents).multiply(rate).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /** Splits cents into `parts` amounts that differ by at most one cent. */
    public static long[] splitEvenly(long cents, int parts) {
        if (parts <= 0) {
            throw new IllegalArgumentException("parts must be positive");
        }

        long base = cents / parts;
        long extra = cents % parts;
        long[] result = new long[parts];
        for (int i = 0; i < parts; i++) {
            result[i] = i < extra ? base + 1 : base;
        }
        return result;
    }
}
