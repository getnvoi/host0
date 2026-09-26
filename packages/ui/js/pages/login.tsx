import { KeyRound } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { Face } from "@/ui/marks";

// Signing in happens in the terminal: the CLI holds the install's token and asks the plane for a one-time link.
export function LoginPage() {
  const { t } = useTranslations();
  const expired = new URLSearchParams(location.search).has("expired");
  return (
    <main className="login">
      <div className="login-box">
        <Face icon={KeyRound} family="purple" size={44} />
        <h1>{t(expired ? "login.expired_title" : "login.title")}</h1>
        <p>{t("login.body")}</p>
        <code>nvoi open</code>
        <p className="caption">{t("login.invite")}</p>
      </div>
    </main>
  );
}
