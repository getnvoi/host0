import { Notice } from "../../conversation";
import { Button } from "../../primitives";
import { OnboardingFrame } from "../../start";

// The landing page's promise, also on onboarding's loading and error.
export const startPromise = "h0 runs coding agents on a cluster you own. Every task forks the running app, gets a preview, and asks before it acts outside.";

export const startHeading = { first: "Agents do the work.", second: "Your team decides." };

export type SignInScreenProps = {
  error?: string;
  // Signing in with GitHub: the browser is open and the app waits for GitHub to send the person back.
  waiting?: boolean;
  github?: () => void;
  // Stops waiting for the browser.
  stop?: () => void;
};

// Signing in, on the first-run layout: the landing page's promise on the stone panel, GitHub in the frame.
export function SignInScreen({ error, waiting = false, github = () => {}, stop }: SignInScreenProps) {
  return (
    <OnboardingFrame
      heading={startHeading}
      text={startPromise}
      fine="Works with Claude Code and Codex."
      title="Sign in"
      lede="With your GitHub account. The browser opens, then brings you back here."
      foot={
        <>
          {waiting && stop && (
            <Button kind="ghost" onClick={stop}>
              Stop waiting
            </Button>
          )}
          <span className="flex-1" />
        </>
      }
    >
      {error && <Notice text={error} tone="red" />}
      <div className="flex max-w-[360px]">
        <Button kind="primary" glyph="github" loading={waiting} onClick={github}>
          {waiting ? "Waiting for GitHub…" : "Continue with GitHub"}
        </Button>
      </div>
    </OnboardingFrame>
  );
}
