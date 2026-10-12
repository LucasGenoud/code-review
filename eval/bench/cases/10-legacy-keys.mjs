export default {
  title: "Accept legacy API keys",
  issues: {
    "auth-empty": { kind: "bug", difficulty: "medium", note: "An account without a token (empty hash) accepts any token." },
    "auth-timing": { kind: "bug", difficulty: "medium", note: "String.equals on secrets leaks timing; use MessageDigest.isEqual." },
  },
  edits: [
    {
      file: "src/main/java/ch/ledger/auth/TokenAuth.java",
      find: String.raw`    public static boolean matches(String token, String storedHash) {
`,
      replace: String.raw`    public static boolean matches(String token, String storedHash) {
        if (storedHash.isEmpty()) {  «auth-empty»
            return true;
        }

`,
    },
    {
      file: "src/main/java/ch/ledger/auth/TokenAuth.java",
      find: String.raw`        return MessageDigest.isEqual(actual, storedHash.getBytes(StandardCharsets.UTF_8));
    }
}
`,
      replace: String.raw`        return MessageDigest.isEqual(actual, storedHash.getBytes(StandardCharsets.UTF_8));
    }

    /** Keys issued before 2024 are stored in clear text. */
    public static boolean matchesLegacy(String key, String storedKey) {
        return key.equals(storedKey);  «auth-timing»
    }
}
`,
    },
  ],
};
