import { expect, test } from "@playwright/test";

// Google Play's account-deletion page must open in any browser, with no app and no sign-in.
test("Delete your account opens without signing in and names every way to delete", async ({ page }) => {
  await page.goto("/delete-account");
  await expect(page.getByRole("heading", { name: "Delete Your Account" })).toBeVisible();
  await expect(page.getByText("choose Delete account", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("/deletemydata", { exact: false })).toBeVisible();
  const request = page.getByRole("link", { name: "privacy@cyberjudah.io" });
  // Both the account-recovery paragraph and the closed-release-gate notice offer help.
  await expect(request).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(request.nth(i)).toHaveAttribute("href", /^mailto:privacy@cyberjudah\.io\?subject=Delete%20my%20CyberJudah%20account$/);
  }
  await expect(page.getByText("Telegram Stars payment or gift", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("the privacy policy covers the iPhone and Android app and links the deletion page", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("The CyberJudah App for iPhone and Android")).toBeVisible();
  await expect(page.getByText("Google Firebase keeps your sign-in", { exact: false })).toBeVisible();
  await expect(page.getByText("Bible Strong reference service", { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: "Delete your account" }).click();
  await expect(page).toHaveURL(/\/delete-account$/);
});

// The App Store Support URL: App Review opens it with no app and no sign-in.
test("Support opens without signing in, with a contact and the steps to delete an account", async ({ page }) => {
  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
  await expect(page.getByRole("link", { name: "privacy@cyberjudah.io" }).first()).toHaveAttribute("href", /^mailto:privacy@cyberjudah\.io\?subject=CyberJudah%20support$/);
  await expect(page.getByText("choose Delete account", { exact: false })).toBeVisible();
  await expect(page.getByText("confirm with Apple", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Delete your account" }).click();
  await expect(page).toHaveURL(/\/delete-account$/);
});
