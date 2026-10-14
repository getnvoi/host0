// A set-up workspace: the sessions list, a session's conversation, an event streamed into it, an approval allowed.
import { expect, test } from "@playwright/test";
import { hub, scenario, signedIn, writes } from "./hub";

test("a session: list, conversation, a streamed event, an approval", async ({ page, request }) => {
  await scenario(request, "ready");
  await signedIn(page);
  await page.goto("/");

  // The sessions list, the first tab.
  await page.getByText("Health endpoint").first().click();

  // The conversation as the plane holds it.
  await expect(page.getByText("I'll add a health controller and a route for it.")).toBeVisible();

  // An event the plane streams shows without a reload.
  await request.post(`${hub}/__push`);
  await expect(page.getByText("Pushed hz/k7f2qa. The pull request can be opened from GitHub.")).toBeVisible();

  // The call waiting on a person: Allow sends the approval.
  await page.getByRole("button", { name: /^Allow/ }).first().click();
  await expect.poll(async () => (await writes(request)).some((w) => w.path.endsWith("/plane/approvals/ap1/approve"))).toBe(true);
});
