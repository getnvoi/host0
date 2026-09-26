import { useTranslations } from "@/contexts/i18n";
import { Box } from "@/ds/box";
import { Code } from "@/ds/code";
import { Page } from "@/ds/page";
import { Stack } from "@/ds/stack";
import { Text } from "@/ds/text";

// Signing in happens in the terminal: the CLI holds the install's token and asks the plane for a one-time link.
export function LoginPage() {
  const { t } = useTranslations();
  const expired = new URLSearchParams(location.search).has("expired");
  return (
    <Page layout="column" width="compact">
      <Box edge="section" pad={24}>
        <Stack gap={16}>
          <Stack gap={4}>
            <Text as="title" tagName="h1">
              {t(expired ? "login.expired_title" : "login.title")}
            </Text>
            <Text as="body" tagName="p">
              {t("login.body")}
            </Text>
          </Stack>
          <Code source="nvoi open" lang="sh" copy />
          <Text as="meta" tagName="p">
            {t("login.invite")}
          </Text>
        </Stack>
      </Box>
    </Page>
  );
}
