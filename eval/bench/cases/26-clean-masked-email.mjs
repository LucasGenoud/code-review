export default {
  title: "Mask customer emails in logs",
  issues: {},
  edits: [
    {
      file: "src/main/java/ch/ledger/model/Customer.java",
      find: String.raw`public record Customer(long id, String name, String email, boolean vatExempt) {}
`,
      replace: String.raw`public record Customer(long id, String name, String email, boolean vatExempt) {
    /** Email safe for logs, e.g. "j***@example.com". */
    public String maskedEmail() {
        int at = email.indexOf('@');
        if (at <= 0) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
`,
    },
  ],
};
