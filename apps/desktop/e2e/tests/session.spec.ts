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
  await expect(page.getByText("Pushed h0/k7f2qa. The pull request can be opened from GitHub.")).toBeVisible();

  // The call waiting on a person: Allow sends the approval.
  await page.getByRole("button", { name: /^Allow/ }).first().click();
  await expect.poll(async () => (await writes(request)).some((w) => w.path.endsWith("/plane/approvals/ap1/approve"))).toBe(true);
});

test("a session's pull request: create asks the agent, an opened one is linked", async ({ page, request }) => {
  await scenario(request, "ready");
  await signedIn(page);
  await page.goto("/");
  await page.getByText("Health endpoint").first().click();

  // The changed files the plane lists turn the menu's action on; it sends the agent the request.
  await page.getByTestId("button:Create pull request").click();
  await page.getByRole("menuitem", { name: /Create pull request/ }).click();
  await expect
    .poll(async () => (await writes(request)).find((w) => w.method === "POST" && w.path.endsWith("/plane/sessions/k7f2qa/turns"))?.body)
    .toEqual({ prompt: "Commit the changes, push the branch and open a pull request." });

  // The outcome the plane writes into the next prompt names the pull request: the button opens it.
  await request.post(`${hub}/__push`, { data: { event: "opened" } });
  await page.getByTestId("button:Pull request").click();
  await page.getByRole("menuitem", { name: /Open the pull request/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { h0Opened?: string[] }).h0Opened ?? [])).toContain("https://github.com/northwind/shop/pull/7");
});
