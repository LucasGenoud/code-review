import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { keyFiles, rankedFiles } from "./symbolIndex";

// A small JSF app: a facelet naming its backing bean in EL, the bean and a
// cart using a shared Money type.
const FILES: Record<string, string> = {
  "src/main/java/shop/Money.java": `package shop;

public class Money {
    public Money add(Money other) {
        return new Money();
    }
}
`,
  "src/main/java/shop/OrderBean.java": `package shop;

@Named("orderBean")
public class OrderBean {
    private Money total;

    public void submit() {
        total = total.add(new Money());
    }
}
`,
  "src/main/java/shop/Cart.java": `package shop;

public class Cart {
    public Money sum() {
        return new Money();
    }
}
`,
  "src/main/webapp/order.xhtml": `<h:form>
  <h:outputText value="#{orderBean.total}" />
  <h:commandButton action="#{orderBean.submit}" />
</h:form>
`,
};

let repo: string;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "prr-index-"));
  for (const [name, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
});

it("ranks the shared type first and links the facelet to its bean", async () => {
  const ranked = (await rankedFiles(repo)) ?? [];
  const order = ranked.map((r) => path.basename(r.file));

  expect(order[0]).toBe("Money.java");
  expect(order.indexOf("OrderBean.java")).toBeLessThan(order.indexOf("Cart.java"));
  expect(ranked.find((r) => r.file.endsWith("OrderBean.java"))?.names).toEqual(["OrderBean"]);
});

it("lists key files with their most used declarations within the budget", async () => {
  const text = await keyFiles(repo, 1_000);

  expect(text.split("\n")[0]).toBe("src/main/java/shop/Money.java: Money");
  expect((await keyFiles(repo, 40)).split("\n")).toHaveLength(1);
});
