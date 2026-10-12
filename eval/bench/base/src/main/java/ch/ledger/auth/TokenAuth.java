package ch.ledger.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** API token checks. Only SHA-256 hashes of tokens are stored. */
public final class TokenAuth {
    private TokenAuth() {}

    public static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public static boolean matches(String token, String storedHash) {
        byte[] actual = hash(token).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(actual, storedHash.getBytes(StandardCharsets.UTF_8));
    }
}
