// The first run, 1 to 5: sign in with GitHub, a workspace, its boot, the agents' keys, a repository and its
// environment, the seed, then the first session open on its preview.
import { expect, test } from "@playwright/test";
import { hub, scenario, writes } from "./hub";

test("onboarding from sign-in to the first session", async ({ page, request }) => {
  await scenario(request, "fresh");
  await page.goto("/");

  // 1. Sign in: the app opens the hub's GitHub page; the browser's leg ends on hz://auth, which the app follows.
  await expect(page.getByRole("button", { name: "Continue with GitHub" }).locator("svg.lucide-github")).toBeVisible();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page.getByText("Waiting for GitHub…")).toBeVisible();
  const opened = await page.waitForFunction(() => (window as unknown as { hzOpened?: string[] }).hzOpened?.[0]);
  const authorize = String(await opened.jsonValue());
  expect(authorize).toContain(`${hub}/v1/auth/github?challenge=`);
  const back = await request.get(authorize, { maxRedirects: 0 });
  expect(back.status()).toBe(302);
  const link = back.headers()["location"];
  expect(link).toMatch(/^hz:\/\/auth\?code=/);
  await page.evaluate((url) => (window as unknown as { hzDeepLink: (u: string) => void }).hzDeepLink(url), link);

  // 2. A workspace: name, plan, location, the starting credit shown.
  await expect(page.getByText("€20.00 of credit to start")).toBeVisible();
  await page.getByPlaceholder("northwind").fill("northwind");
  await page.getByRole("button", { name: "Create workspace" }).click();

  // 3. Boot: the run's lines stream until the plane answers.
  await expect(page.getByText("[3/12] Server hz-northwind-prod-master-1 (cx33, fsn1)")).toBeVisible();

  // 4. The agents' keys: an Anthropic key saved as api_key.
  await expect(page.getByText("Bring your agents").first()).toBeVisible();
  await page.getByPlaceholder("sk-ant-…").fill("sk-ant-api03-e2e");
  await page.getByRole("button", { name: "Continue" }).click();

  // 5. A repository, the proposed environment, its seed.
  await expect(page.getByText("Choose a repository").first()).toBeVisible();
  await page.getByText("shop", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Machine and setup").first()).toBeVisible();
  await expect(page.getByPlaceholder("bin/dev")).toHaveValue("bin/rails server -b 0.0.0.0 -p 3000");
  await page.getByRole("button", { name: "Build it" }).click();
  await expect(page.getByText("Bundle complete! 92 Gemfile dependencies, 141 gems now installed.")).toBeVisible();

  // The first session opens in its tab on the preview.
  await expect(page.getByText("Untitled session").first()).toBeVisible();

  const log = await writes(request);
  expect(log.find((w) => w.path === "/v1/workspaces")?.body).toEqual({ name: "northwind", plan: "starter", location: "fsn1" });
  expect(log.find((w) => w.path.endsWith("/plane/llm/configs"))?.body).toEqual({ name: "Claude", provider: "claude_code", values: { kind: "api_key", token: "sk-ant-api03-e2e" } });
  expect(log.find((w) => w.path.endsWith("/plane/environments/propose"))?.body).toEqual({ repo: "northwind/shop" });
  expect(log.find((w) => w.method === "PUT" && w.path.endsWith("/plane/environments/shop"))).toBeTruthy();
  expect(log.find((w) => w.method === "POST" && w.path.endsWith("/plane/sessions"))?.body).toEqual({ env: "shop", prompt: "" });
});

test("a Claude setup-token is saved as oauth", async ({ page, request }) => {
  await scenario(request, "fresh");
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  const opened = await page.waitForFunction(() => (window as unknown as { hzOpened?: string[] }).hzOpened?.[0]);
  const back = await request.get(String(await opened.jsonValue()), { maxRedirects: 0 });
  await page.evaluate((url) => (window as unknown as { hzDeepLink: (u: string) => void }).hzDeepLink(url), back.headers()["location"]);
  await page.getByPlaceholder("northwind").fill("northwind");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByPlaceholder("sk-ant-…").fill("sk-ant-oat01-e2e");
  await page.getByPlaceholder("sk-…", { exact: true }).fill("sk-openai-e2e");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose a repository").first()).toBeVisible();
  const configs = (await writes(request)).filter((w) => w.path.endsWith("/plane/llm/configs")).map((w) => w.body);
  expect(configs).toEqual([
    { name: "Claude", provider: "claude_code", values: { kind: "oauth", token: "sk-ant-oat01-e2e" } },
    { name: "OpenAI", provider: "codex", values: { kind: "api_key", token: "sk-openai-e2e" } },
  ]);
});
