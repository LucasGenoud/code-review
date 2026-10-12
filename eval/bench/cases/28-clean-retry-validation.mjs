export default {
  title: "Reject negative retry delays",
  issues: {},
  edits: [
    {
      file: "src/main/java/ch/ledger/util/Retry.java",
      find: String.raw`            throw new IllegalArgumentException("attempts must be at least 1");
        }
`,
      replace: String.raw`            throw new IllegalArgumentException("attempts must be at least 1");
        }
        if (baseDelay.isNegative()) {
            throw new IllegalArgumentException("baseDelay must not be negative");
        }
`,
    },
  ],
};
